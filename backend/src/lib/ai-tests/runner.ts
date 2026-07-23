/**
 * AI test-suite execution.
 *
 * Runs execute on the framework's durable job queue (survive restarts, never
 * block the triggering request). A run walks the suite's active questions
 * SEQUENTIALLY — small lists, easier on rate limits, trivial live-progress —
 * and for each one: runs the agent, judges the answer, scores it, and writes a
 * result row. A failure on one question never aborts the run (try/catch per
 * question). Progress is persisted incrementally so the UI can poll a live run.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { createJob } from "@framework/lib/jobs";
import log from "@framework/lib/log";
import {
  aiTestSuites,
  aiTestRuns,
  aiTestResults,
  type AiTestRunSelect,
  type AiTestJudgeReport,
  type AiTestRunAggregates,
} from "../../db/schema";
import {
  getSuite,
  getActiveQuestions,
  type AiTestContext,
} from "./index";
import { runAgentForQuestion } from "./agent";
import { judgeAnswer } from "./judge";
import { scoreQuestion, computeAggregates, type AggregateItem } from "./reward";

/** Framework job-queue type for an async test run. */
export const AI_TEST_JOB_TYPE = "ai-test-run";

const nowIso = () => new Date().toISOString();

/** In-process guard so a run is never executed twice concurrently. */
const executing = new Set<string>();

/**
 * Create a run row and enqueue its async execution. If a run for this suite is
 * already in progress, that run is returned instead (no duplicate is started).
 */
export const enqueueRun = async (
  ctx: AiTestContext,
  suiteId: string,
): Promise<AiTestRunSelect | null> => {
  if (!ctx.userId) {
    throw new Error("A run must be started by a user (startedBy is required)");
  }
  const db = getDb();
  const suite = await getSuite(ctx, suiteId);
  if (!suite) return null;

  const existing = await db
    .select()
    .from(aiTestRuns)
    .where(eq(aiTestRuns.suiteId, suiteId));
  const running = existing.find((r) => r.status === "running");
  if (running) return running;

  const questions = await getActiveQuestions(suiteId);
  const runRows = await db
    .insert(aiTestRuns)
    .values({
      suiteId,
      organisationId: ctx.organisationId,
      status: "running",
      startedBy: ctx.userId,
      judgeModelId: suite.judgeModelId ?? null,
      total: questions.length,
    })
    .returning();
  const run = runRows[0]!;

  await createJob(AI_TEST_JOB_TYPE, { runId: run.id }, ctx.organisationId);
  return run;
};

/** Cancel a run (cooperative — the executor stops before the next question). */
export const cancelRun = async (
  suiteId: string,
  runId: string,
): Promise<AiTestRunSelect | null> => {
  const db = getDb();
  const rows = await db
    .select()
    .from(aiTestRuns)
    .where(and(eq(aiTestRuns.id, runId), eq(aiTestRuns.suiteId, suiteId)))
    .limit(1);
  const run = rows[0];
  if (!run) return null;
  if (run.status !== "running") return run;
  const updated = await db
    .update(aiTestRuns)
    .set({ status: "cancelled", finishedAt: nowIso() })
    .where(eq(aiTestRuns.id, runId))
    .returning();
  return updated[0] ?? null;
};

const readRunStatus = async (runId: string): Promise<string | null> => {
  const rows = await getDb()
    .select({ status: aiTestRuns.status })
    .from(aiTestRuns)
    .where(eq(aiTestRuns.id, runId))
    .limit(1);
  return rows[0]?.status ?? null;
};

/**
 * Execute a run to completion. Safe to call directly (tests) or from the job
 * queue handler. Idempotent-guarded against concurrent double execution.
 */
export const executeRun = async (runId: string): Promise<void> => {
  if (executing.has(runId)) return;
  executing.add(runId);
  const db = getDb();
  try {
    const runRows = await db
      .select()
      .from(aiTestRuns)
      .where(eq(aiTestRuns.id, runId))
      .limit(1);
    const run = runRows[0];
    if (!run) return;
    if (run.status !== "running") return; // cancelled before start or finished

    const suiteRows = await db
      .select()
      .from(aiTestSuites)
      .where(eq(aiTestSuites.id, run.suiteId))
      .limit(1);
    const suite = suiteRows[0];
    if (!suite) {
      await finishRun(runId, "error", null, "Suite no longer exists");
      return;
    }

    const questions = await getActiveQuestions(run.suiteId);
    const aggregateItems: AggregateItem[] = [];
    let completed = 0;
    let failed = 0;
    let passed = 0;
    let warned = 0;
    let hardGateFails = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const question of questions) {
      // cooperative cancel: stop before starting the next question
      if ((await readRunStatus(runId)) === "cancelled") break;

      const startedAt = Date.now();
      try {
        const agentResult = await runAgentForQuestion({
          tenantId: run.organisationId,
          userId: run.startedBy,
          question: question.question,
          stepLimit: suite.stepLimit,
        });

        const judge = await judgeAnswer({
          question: question.question,
          questionType: question.type,
          answer: agentResult.answer,
          toolOutputs: agentResult.fullToolOutputs,
          expectedFacts: question.expectedFacts ?? [],
          judgeModelId: suite.judgeModelId,
        });

        const durationMs = Date.now() - startedAt;
        const questionTokens =
          agentResult.usage.totalTokens + judge.usage.totalTokens;

        const score = scoreQuestion({
          steps: agentResult.trajectory.steps,
          questionType: question.type,
          expectedPageIds: question.expectedPageIds ?? [],
          relevance: judge.relevance,
          claims: judge.claims,
          citedPageTitles: judge.citedPageTitles,
          factsCovered: judge.factsCovered,
          saysWikiHasNoAnswer: judge.saysWikiHasNoAnswer,
          substantiveAnswer: agentResult.answer.trim().length > 0,
          durationMs,
          totalTokens: questionTokens,
        });

        const judgeReport: AiTestJudgeReport = {
          relevance: judge.relevance,
          relevanceReasoning: judge.relevanceReasoning,
          saysWikiHasNoAnswer: judge.saysWikiHasNoAnswer,
          citedPageTitles: judge.citedPageTitles,
          factsCovered: judge.factsCovered,
          claims: judge.claims,
          flags: {
            generalKnowledgeSuspected: score.generalKnowledgeSuspected,
            noAnswerCase: score.noAnswerCase,
            hardGateReasons: score.hardGateReasons,
          },
        };

        await db.insert(aiTestResults).values({
          runId,
          organisationId: run.organisationId,
          questionId: question.id,
          questionText: question.question,
          questionType: question.type,
          expectedPageIds: question.expectedPageIds ?? [],
          expectedFacts: question.expectedFacts ?? [],
          answer: agentResult.answer,
          trajectory: agentResult.trajectory,
          scores: score.scores,
          judgeReport,
          verdict: score.verdict,
          toolUsageScore: score.scores.toolUsage,
          groundednessScore: score.scores.groundedness,
          relevanceScore: score.scores.relevance,
          referenceScore: score.scores.reference ?? null,
          totalScore: score.scores.total,
          durationMs,
          promptTokens:
            agentResult.usage.promptTokens + judge.usage.promptTokens,
          completionTokens:
            agentResult.usage.completionTokens + judge.usage.completionTokens,
          totalTokens: questionTokens,
        });

        completed++;
        if (score.verdict === "pass") passed++;
        else if (score.verdict === "warn") warned++;
        if (score.hardGateReasons.length > 0) hardGateFails++;
        promptTokens +=
          agentResult.usage.promptTokens + judge.usage.promptTokens;
        completionTokens +=
          agentResult.usage.completionTokens + judge.usage.completionTokens;
        totalTokens += questionTokens;

        aggregateItems.push({
          questionType: question.type,
          verdict: score.verdict,
          toolUsage: score.scores.toolUsage,
          groundedness: score.scores.groundedness,
          relevance: score.scores.relevance,
          total: score.scores.total,
          hardGate: score.hardGateReasons.length > 0,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        log.error(`AI test question ${question.id} failed: ${message}`);
        await db.insert(aiTestResults).values({
          runId,
          organisationId: run.organisationId,
          questionId: question.id,
          questionText: question.question,
          questionType: question.type,
          expectedPageIds: question.expectedPageIds ?? [],
          expectedFacts: question.expectedFacts ?? [],
          durationMs: Date.now() - startedAt,
          error: message,
        });
        completed++;
        failed++;
      }

      // persist progress incrementally so the UI can watch a long run
      await db
        .update(aiTestRuns)
        .set({
          completed,
          failed,
          passed,
          warned,
          hardGateFails,
          promptTokens,
          completionTokens,
          totalTokens,
        })
        .where(eq(aiTestRuns.id, runId));
    }

    const aggregates = computeAggregates(aggregateItems);
    const cancelled = (await readRunStatus(runId)) === "cancelled";
    const status = cancelled
      ? "cancelled"
      : failed === 0
        ? "success"
        : failed === questions.length && questions.length > 0
          ? "error"
          : "partial";

    await finishRun(runId, status, aggregates, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`AI test run ${runId} failed: ${message}`);
    await finishRun(runId, "error", null, message).catch(() => {});
  } finally {
    executing.delete(runId);
  }
};

/** Write the terminal state of a run and stamp it onto its suite. */
const finishRun = async (
  runId: string,
  status: "success" | "partial" | "error" | "cancelled",
  aggregates: AiTestRunAggregates | null,
  error: string | null,
): Promise<void> => {
  const db = getDb();
  const finishedAt = nowIso();
  const rows = await db
    .update(aiTestRuns)
    .set({ status, aggregates, error, finishedAt })
    .where(eq(aiTestRuns.id, runId))
    .returning();
  const run = rows[0];
  if (run) {
    await db
      .update(aiTestSuites)
      .set({
        lastRunId: runId,
        lastRunAt: finishedAt,
        lastRunStatus: status,
        updatedAt: finishedAt,
      })
      .where(eq(aiTestSuites.id, run.suiteId));
  }
};

/** Framework job-queue handler. */
export const aiTestJobHandler = {
  type: AI_TEST_JOB_TYPE,
  handler: {
    execute: async (metadata: { runId?: string }) => {
      if (metadata?.runId) await executeRun(metadata.runId);
    },
  },
};
