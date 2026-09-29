/**
 * AI-test tools: build evaluation suites, run them and read the results.
 *
 * An AI test suite is a list of questions the wiki's own chat agent is
 * examined with. A run asks the agent every active question, lets a judge
 * model grade each answer and stores a scored result per question — the same
 * machinery as the "AI tests" screen of the app. With these tools an agent can
 * drive the whole loop for the user:
 *
 *   1. `list_ai_test_suites` / `create_ai_test_suite`
 *   2. `add_ai_test_questions` (optionally with expected pages and facts,
 *      e.g. drafted from pages read via `search_wiki` / `get_page`)
 *   3. `start_ai_test_run` → `get_ai_test_run` with `waitSeconds` until the
 *      run is finished
 *   4. evaluate: `get_ai_test_run` (filter on `verdicts`), and
 *      `compare_ai_test_runs` against the previous run for regressions
 *
 * Everything goes through the app's `/ai-tests` routes, so tenant scoping and
 * the route checks are the app's own. Suite, question, run and result ids are
 * not page ids (`opaqueIds`), and the results are reshaped to what an
 * evaluation needs: scores, verdicts, the judge's reasons and — only on
 * request — the full trajectory.
 */

import { z } from "zod";
import type { McpRequestContext, McpToolDefinition } from "@framework/types";
import { defineTool, READ_ONLY, writeAnnotations } from "./_define";
import { callApi, fail, ok, requestApi, tenantPath } from "../api";

const QUESTION_TYPES = [
  "answerable",
  "synthesis",
  "not-in-wiki",
  "ambiguous",
] as const;

const VERDICTS = ["pass", "warn", "fail", "error"] as const;
type Verdict = (typeof VERDICTS)[number];

/** Longest wait a single `get_ai_test_run` call may block for. */
const MAX_WAIT_SECONDS = 50;
const POLL_INTERVAL_MS = 2000;

const aiTestsPath = (ctx: McpRequestContext, suffix = "") =>
  tenantPath(ctx, `/ai-tests/suites${suffix}`);

// ---- shaping ----------------------------------------------------------------

const round = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.round(n * 1000) / 1000
    : undefined;

const clip = (text: unknown, max: number): string | undefined => {
  if (typeof text !== "string") return undefined;
  return text.length > max ? `${text.slice(0, max)}… [clipped]` : text;
};

/** Empty arrays and false flags only cost context — drop them. */
const nonEmpty = <T>(list: T[] | undefined | null): T[] | undefined =>
  list && list.length > 0 ? list : undefined;

function slimSuite(s: any) {
  if (!s || typeof s !== "object") return s;
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? undefined,
    judgeModelId: s.judgeModelId ?? undefined,
    stepLimit: s.stepLimit ?? undefined,
    lastRunId: s.lastRunId ?? undefined,
    lastRunAt: s.lastRunAt ?? undefined,
    lastRunStatus: s.lastRunStatus ?? undefined,
    updatedAt: s.updatedAt,
  };
}

function slimQuestion(q: any) {
  return {
    id: q.id,
    question: q.question,
    type: q.type,
    expectedPageIds: nonEmpty(q.expectedPageIds),
    expectedFacts: nonEmpty(q.expectedFacts),
    // only the exception is worth a field
    active: q.active === false ? false : undefined,
  };
}

/** A stored question as the id-preserving PUT expects it back. */
const questionInput = (q: any) => ({
  id: q.id,
  question: q.question,
  type: q.type,
  expectedPageIds: q.expectedPageIds ?? [],
  expectedFacts: q.expectedFacts ?? [],
  active: q.active ?? true,
});

function slimRun(r: any) {
  if (!r || typeof r !== "object") return r;
  const completed = r.completed ?? 0;
  const errored = r.failed ?? 0;
  const passed = r.passed ?? 0;
  const warned = r.warned ?? 0;
  const durationSec =
    r.startedAt && r.finishedAt
      ? Math.round(
          (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) /
            1000,
        )
      : undefined;
  const agg = r.aggregates;
  return {
    id: r.id,
    status: r.status,
    progress: `${completed}/${r.total ?? 0}`,
    // `failed` in the table counts questions that errored; a `fail` verdict
    // is what is left of the completed ones
    verdicts: {
      pass: passed,
      warn: warned,
      fail: Math.max(0, completed - passed - warned - errored),
      error: errored,
    },
    hardGateFails: r.hardGateFails ?? 0,
    aggregates: agg
      ? {
          passRate: round(agg.passRate),
          meanTotal: round(agg.meanTotal),
          meanToolUsage: round(agg.meanToolUsage),
          meanGroundedness: round(agg.meanGroundedness),
          meanRelevance: round(agg.meanRelevance),
          byType: Object.fromEntries(
            Object.entries(agg.byType ?? {}).map(([type, v]: [string, any]) => [
              type,
              {
                count: v.count,
                passRate: round(v.passRate),
                meanTotal: round(v.meanTotal),
              },
            ]),
          ),
        }
      : undefined,
    totalTokens: r.totalTokens ?? 0,
    judgeModelId: r.judgeModelId ?? undefined,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? undefined,
    durationSec,
    error: r.error ?? undefined,
  };
}

const verdictOf = (res: any): Verdict =>
  res.error ? "error" : ((res.verdict as Verdict) ?? "error");

type ResultShape = {
  detail: "summary" | "full";
  includeAnswers: boolean;
  maxAnswerChars: number;
};

function slimResult(res: any, shape: ResultShape) {
  const report = res.judgeReport ?? {};
  const flags = report.flags ?? {};
  const metrics = res.scores?.metrics ?? {};
  const claims: any[] = report.claims ?? [];
  const full = shape.detail === "full";
  return {
    resultId: res.id,
    questionId: res.questionId ?? undefined,
    question: res.questionText,
    type: res.questionType,
    verdict: verdictOf(res),
    scores: res.error
      ? undefined
      : {
          total: round(res.totalScore),
          toolUsage: round(res.toolUsageScore),
          groundedness: round(res.groundednessScore),
          relevance: round(res.relevanceScore),
          reference: round(res.referenceScore),
          pageRecall: round(metrics.pageRecall),
        },
    hardGateReasons: nonEmpty(flags.hardGateReasons),
    generalKnowledgeSuspected: flags.generalKnowledgeSuspected || undefined,
    saysWikiHasNoAnswer: report.saysWikiHasNoAnswer || undefined,
    relevanceReasoning: report.relevanceReasoning ?? undefined,
    // the claims the judge could NOT back with tool output are the "why"
    problemClaims: full
      ? undefined
      : nonEmpty(claims.filter((c) => c.verdict !== "supported")),
    claims: full ? nonEmpty(claims) : undefined,
    factsMissed: full
      ? undefined
      : nonEmpty(
          (report.factsCovered ?? [])
            .filter((f: any) => !f.covered)
            .map((f: any) => f.fact),
        ),
    factsCovered: full ? nonEmpty(report.factsCovered) : undefined,
    citedPageTitles: nonEmpty(report.citedPageTitles),
    expectedPageIds: full ? nonEmpty(res.expectedPageIds) : undefined,
    expectedFacts: full ? nonEmpty(res.expectedFacts) : undefined,
    answer: shape.includeAnswers
      ? clip(res.answer, shape.maxAnswerChars)
      : undefined,
    metrics: full
      ? {
          steps: metrics.steps,
          searchCount: metrics.searchCount,
          readCount: metrics.readCount,
          failedToolCalls: metrics.failedToolCalls,
          duplicateToolCalls: metrics.duplicateToolCalls,
          durationMs: res.durationMs ?? metrics.durationMs,
          totalTokens: res.totalTokens,
        }
      : undefined,
    trajectory: full
      ? (res.trajectory?.steps ?? []).map((step: any) => ({
          tool: step.toolName,
          input: step.input,
          ok: step.ok,
          output: clip(
            typeof step.output === "string"
              ? step.output
              : JSON.stringify(step.output),
            400,
          ),
        }))
      : undefined,
    error: res.error ?? undefined,
  };
}

/** Lowest-scoring questions first — the starting point of every review. */
function weakest(results: any[], limit = 5) {
  return results
    .map((res) => ({
      questionId: res.questionId ?? undefined,
      question: res.questionText,
      verdict: verdictOf(res),
      total: res.error ? undefined : round(res.totalScore),
    }))
    .filter((r) => r.verdict !== "pass")
    .sort((a, b) => (a.total ?? -1) - (b.total ?? -1))
    .slice(0, limit);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- shared fetches ---------------------------------------------------------

type SuiteDetail = { suite: any; questions: any[]; runs: any[] };

const loadSuite = (ctx: McpRequestContext, suiteId: string) =>
  requestApi(ctx, aiTestsPath(ctx, `/${suiteId}`)) as Promise<
    { ok: true; data: SuiteDetail } | { ok: false; message: string }
  >;

const loadRun = (ctx: McpRequestContext, suiteId: string, runId: string) =>
  requestApi(ctx, aiTestsPath(ctx, `/${suiteId}/runs/${runId}`)) as Promise<
    | { ok: true; data: { run: any; results: any[] } }
    | { ok: false; message: string }
  >;

/** Replace the question list and return it in the tool's shape. */
async function saveQuestions(
  ctx: McpRequestContext,
  suiteId: string,
  questions: unknown[],
) {
  return requestApi(ctx, aiTestsPath(ctx, `/${suiteId}/questions`), {
    method: "PUT",
    json: { questions },
  });
}

// ---- schemas ----------------------------------------------------------------

const suiteId = z.string().describe("The suite id (from list_ai_test_suites).");
const questionType = z
  .enum(QUESTION_TYPES)
  .describe(
    "answerable = one page holds the answer; synthesis = the answer needs " +
      "several pages; not-in-wiki = the wiki has NO answer and the agent must " +
      "say so instead of inventing one; ambiguous = the question needs a " +
      "clarifying reply.",
  );
const expectedPageIds = z
  .array(z.string())
  .describe(
    "Page ids the agent should read to answer (checked as page recall). " +
      "Take them from search_wiki / get_page, never guess.",
  );
const expectedFacts = z
  .array(z.string().max(500))
  .describe("2–5 must-have facts a good answer contains (graded by the judge).");

const suiteSettings = {
  description: z.string().nullable().optional().describe("What the suite covers."),
  judgeModelId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional model override for the judge (never for the agent under " +
        "test). null = the default judge model.",
    ),
  stepLimit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .optional()
    .describe("Optional tool-step budget for the agent under test (1–50)."),
};

const resultShape = {
  detail: z
    .enum(["summary", "full"])
    .optional()
    .describe(
      "summary (default): scores, verdict, the judge's reasons, unbacked " +
        "claims and missed facts. full: additionally every claim, the " +
        "metrics and the agent's tool trajectory — use it to debug single " +
        "questions (combine with questionId).",
    ),
  verdicts: z
    .array(z.enum(VERDICTS))
    .optional()
    .describe('Only results with these verdicts, e.g. ["fail","warn","error"].'),
  questionId: z.string().optional().describe("Only the result of this question."),
  includeAnswers: z
    .boolean()
    .optional()
    .describe("Include the agent's answers (default true)."),
  maxAnswerChars: z
    .number()
    .int()
    .min(100)
    .max(20_000)
    .optional()
    .describe("Clip each answer to this length (default 1500)."),
};

// ---- tools ------------------------------------------------------------------

export const aiTestTools: McpToolDefinition[] = [
  defineTool(
    {
      name: "list_ai_test_suites",
      title: "List AI test suites",
      description:
        "Lists the organisation's AI test suites — question sets the wiki's " +
        "chat agent is evaluated with — with the status of each suite's last " +
        "run. Start here before creating a new suite for the same purpose.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
      opaqueIds: true,
    },
    async (_args, ctx) =>
      callApi(ctx, aiTestsPath(ctx), {
        transform: (data) =>
          Array.isArray(data) ? data.map(slimSuite) : data,
      }),
  ),

  defineTool(
    {
      name: "get_ai_test_suite",
      title: "Get an AI test suite",
      description:
        "Returns a suite with its settings, all its questions (id, text, " +
        "type, expected pages/facts, inactive flag) and its recent runs. Read " +
        "this before changing questions so you know their ids.",
      inputSchema: z.object({ suiteId }),
      annotations: READ_ONLY,
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, aiTestsPath(ctx, `/${args.suiteId}`), {
        transform: (data: any) => ({
          suite: slimSuite(data?.suite),
          questions: (data?.questions ?? []).map(slimQuestion),
          runs: (data?.runs ?? []).slice(0, 10).map(slimRun),
        }),
      }),
  ),

  defineTool(
    {
      name: "create_ai_test_suite",
      title: "Create an AI test suite",
      description:
        "Creates an empty suite. Add questions with add_ai_test_questions, " +
        "then start it with start_ai_test_run.",
      inputSchema: z.object({
        name: z.string().min(1).max(200).describe("Name of the suite."),
        ...suiteSettings,
      }),
      annotations: writeAnnotations({ destructive: false, idempotent: false }),
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, aiTestsPath(ctx), {
        method: "POST",
        json: args,
        transform: slimSuite,
      }),
  ),

  defineTool(
    {
      name: "update_ai_test_suite",
      title: "Update an AI test suite",
      description:
        "Changes a suite's name, description, judge model or step limit. " +
        "Only the fields you pass change.",
      inputSchema: z.object({
        suiteId,
        name: z.string().min(1).max(200).optional().describe("New name."),
        ...suiteSettings,
      }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async ({ suiteId, ...changes }, ctx) =>
      callApi(ctx, aiTestsPath(ctx, `/${suiteId}`), {
        method: "PUT",
        json: changes,
        transform: slimSuite,
      }),
  ),

  defineTool(
    {
      name: "delete_ai_test_suite",
      title: "Delete an AI test suite",
      description:
        "Permanently deletes a suite together with ALL its questions, runs " +
        "and results. There is no undo — confirm with the user first.",
      inputSchema: z.object({ suiteId }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, aiTestsPath(ctx, `/${args.suiteId}`), { method: "DELETE" }),
  ),

  defineTool(
    {
      name: "add_ai_test_questions",
      title: "Add questions to an AI test suite",
      description:
        "Appends questions to a suite (max. 200 per suite). Each question can " +
        "carry reference data that makes the grading sharper: " +
        "`expectedPageIds` (the pages holding the answer) and " +
        "`expectedFacts` (2–5 must-have facts). Mix the types — include " +
        "`not-in-wiki` questions to test that the agent admits when the wiki " +
        "has no answer. Existing questions are kept unchanged.",
      inputSchema: z.object({
        suiteId,
        questions: z
          .array(
            z.object({
              question: z.string().min(1).max(2000).describe("The question."),
              type: questionType.optional(),
              expectedPageIds: expectedPageIds.optional(),
              expectedFacts: expectedFacts.optional(),
              active: z
                .boolean()
                .optional()
                .describe("false = kept but skipped by runs (default true)."),
            }),
          )
          .min(1)
          .max(200),
      }),
      annotations: writeAnnotations({ destructive: false, idempotent: false }),
      opaqueIds: true,
    },
    async (args, ctx) => {
      const current = await loadSuite(ctx, args.suiteId);
      if (!current.ok) return fail(current.message);
      const existing = current.data.questions ?? [];
      const saved = await saveQuestions(ctx, args.suiteId, [
        ...existing.map(questionInput),
        ...args.questions,
      ]);
      if (!saved.ok) return fail(saved.message);
      const questions = (saved.data as any[]).map(slimQuestion);
      return ok({
        added: args.questions.length,
        total: questions.length,
        questions: questions.slice(existing.length),
      });
    },
  ),

  defineTool(
    {
      name: "update_ai_test_question",
      title: "Update an AI test question",
      description:
        "Changes one question of a suite: its text, type, expected pages, " +
        "expected facts or whether it is active. Only the fields you pass " +
        "change. The question keeps its id, so its score history across runs " +
        "stays connected.",
      inputSchema: z.object({
        suiteId,
        questionId: z.string().describe("The question id (from get_ai_test_suite)."),
        question: z.string().min(1).max(2000).optional().describe("New text."),
        type: questionType.optional(),
        expectedPageIds: expectedPageIds.optional(),
        expectedFacts: expectedFacts.optional(),
        active: z.boolean().optional().describe("false = skipped by runs."),
      }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async ({ suiteId, questionId, ...changes }, ctx) => {
      const current = await loadSuite(ctx, suiteId);
      if (!current.ok) return fail(current.message);
      const questions = current.data.questions ?? [];
      if (!questions.some((q) => q.id === questionId)) {
        return fail(`Question ${questionId} is not part of suite ${suiteId}.`);
      }
      const saved = await saveQuestions(
        ctx,
        suiteId,
        questions.map((q) =>
          q.id === questionId
            ? { ...questionInput(q), ...changes }
            : questionInput(q),
        ),
      );
      if (!saved.ok) return fail(saved.message);
      const updated = (saved.data as any[]).find((q) => q.id === questionId);
      return ok(slimQuestion(updated));
    },
  ),

  defineTool(
    {
      name: "delete_ai_test_questions",
      title: "Delete AI test questions",
      description:
        "Removes questions from a suite. Past run results keep a snapshot of " +
        "the question text, so run history stays readable. To only pause a " +
        "question, prefer update_ai_test_question with active=false.",
      inputSchema: z.object({
        suiteId,
        questionIds: z
          .array(z.string())
          .min(1)
          .describe("Ids of the questions to remove."),
      }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async (args, ctx) => {
      const current = await loadSuite(ctx, args.suiteId);
      if (!current.ok) return fail(current.message);
      const questions = current.data.questions ?? [];
      const known = new Set(questions.map((q) => q.id));
      const unknown = args.questionIds.filter((id: string) => !known.has(id));
      if (unknown.length > 0) {
        return fail(
          `Not part of suite ${args.suiteId}: ${unknown.join(", ")}. Nothing was deleted.`,
        );
      }
      const drop = new Set(args.questionIds);
      const saved = await saveQuestions(
        ctx,
        args.suiteId,
        questions.filter((q) => !drop.has(q.id)).map(questionInput),
      );
      if (!saved.ok) return fail(saved.message);
      return ok({
        deleted: drop.size,
        remaining: (saved.data as any[]).length,
      });
    },
  ),

  defineTool(
    {
      name: "start_ai_test_run",
      title: "Start an AI test run",
      description:
        "Starts a run of a suite: every ACTIVE question is put to the wiki's " +
        "chat agent (with the permissions of the signed-in user), graded by " +
        "the judge and scored. Runs execute in the background and take " +
        "roughly 10–60 s per question — follow them with get_ai_test_run " +
        "(pass waitSeconds to wait for the result). If the suite already has " +
        "a running run, that run is returned instead of starting a second " +
        "one. Every run costs model tokens.",
      inputSchema: z.object({ suiteId }),
      annotations: writeAnnotations({ destructive: false, idempotent: false }),
      opaqueIds: true,
    },
    async (args, ctx) => {
      const started = await requestApi(
        ctx,
        aiTestsPath(ctx, `/${args.suiteId}/run`),
        { method: "POST" },
      );
      if (!started.ok) return fail(started.message);
      const run = slimRun(started.data);
      return ok({
        ...run,
        hint:
          (started.data as any)?.total === 0
            ? "The suite has no active questions — the run finishes empty. Add questions first."
            : "Running in the background. Call get_ai_test_run with this runId and waitSeconds to follow it.",
      });
    },
  ),

  defineTool(
    {
      name: "list_ai_test_runs",
      title: "List the runs of an AI test suite",
      description:
        "Run history of a suite, newest first (up to 20): status, progress, " +
        "verdict counts, pass rate and mean scores per run. Use it to see the " +
        "trend over time; open one with get_ai_test_run.",
      inputSchema: z.object({ suiteId }),
      annotations: READ_ONLY,
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, aiTestsPath(ctx, `/${args.suiteId}/runs`), {
        transform: (data) => (Array.isArray(data) ? data.map(slimRun) : data),
      }),
  ),

  defineTool(
    {
      name: "get_ai_test_run",
      title: "Get an AI test run with its results",
      description:
        "Status, aggregates and per-question results of a run — the tool to " +
        "EVALUATE a run. Omit runId for the suite's latest run. With " +
        `waitSeconds (max ${MAX_WAIT_SECONDS}) the call waits until the run ` +
        "has finished (or the time is up) — call it again while status is " +
        "still `running`. Each result carries the verdict (pass ≥ 0.75, warn " +
        "≥ 0.5, else fail; error = the question crashed), the total score " +
        "(0.25·toolUsage + 0.45·groundedness + 0.30·relevance, blended with " +
        "reference data when present), hard-gate reasons that forced a fail, " +
        "the judge's reasoning, claims the tool output did not back, and " +
        "missed expected facts. `weakest` lists the lowest-scoring questions " +
        "first. Filter with verdicts / questionId, and use detail=full to see " +
        "the agent's tool trajectory for debugging.",
      inputSchema: z.object({
        suiteId,
        runId: z
          .string()
          .optional()
          .describe("The run id; omit for the suite's latest run."),
        waitSeconds: z
          .number()
          .int()
          .min(0)
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe("Wait up to this long for a running run to finish."),
        ...resultShape,
      }),
      annotations: READ_ONLY,
      opaqueIds: true,
    },
    async (args, ctx) => {
      let runId: string | undefined = args.runId;
      if (!runId) {
        const runs = await requestApi(
          ctx,
          aiTestsPath(ctx, `/${args.suiteId}/runs`),
        );
        if (!runs.ok) return fail(runs.message);
        runId = (runs.data as any[])[0]?.id;
        if (!runId) {
          return fail(
            `Suite ${args.suiteId} has no runs yet — start one with start_ai_test_run.`,
          );
        }
      }

      const deadline = Date.now() + (args.waitSeconds ?? 0) * 1000;
      let loaded = await loadRun(ctx, args.suiteId, runId);
      while (
        loaded.ok &&
        loaded.data.run?.status === "running" &&
        Date.now() + POLL_INTERVAL_MS <= deadline
      ) {
        await sleep(POLL_INTERVAL_MS);
        loaded = await loadRun(ctx, args.suiteId, runId);
      }
      if (!loaded.ok) return fail(loaded.message);

      const { run, results } = loaded.data;
      const shape: ResultShape = {
        detail: args.detail ?? "summary",
        includeAnswers: args.includeAnswers ?? true,
        maxAnswerChars: args.maxAnswerChars ?? 1500,
      };
      const selected = results.filter(
        (res) =>
          (!args.verdicts || args.verdicts.includes(verdictOf(res))) &&
          (!args.questionId || res.questionId === args.questionId),
      );
      return ok({
        run: slimRun(run),
        ...(run.status === "running"
          ? {
              hint: "Still running — call get_ai_test_run again (with waitSeconds) for the final result.",
            }
          : {}),
        weakest: weakest(results),
        resultCount: selected.length,
        results: selected.map((res) => slimResult(res, shape)),
      });
    },
  ),

  defineTool(
    {
      name: "compare_ai_test_runs",
      title: "Compare two AI test runs",
      description:
        "Compares a run with a baseline run of the same suite, question by " +
        "question — the tool to spot regressions after the wiki or the agent " +
        "changed. Omit baselineRunId to compare with the finished run before " +
        "it; omit runId as well to compare the latest run with its " +
        "predecessor. Returns the aggregate deltas plus `regressions` " +
        "(verdict got worse, or the total dropped by at least minDelta) and " +
        "`improvements`, each with both scores.",
      inputSchema: z.object({
        suiteId,
        runId: z.string().optional().describe("The run to judge; default latest."),
        baselineRunId: z
          .string()
          .optional()
          .describe("The run to compare against; default the one before."),
        minDelta: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Smallest score change that counts (default 0.1)."),
      }),
      annotations: READ_ONLY,
      opaqueIds: true,
    },
    async (args, ctx) => {
      const runs = await requestApi(
        ctx,
        aiTestsPath(ctx, `/${args.suiteId}/runs`),
      );
      if (!runs.ok) return fail(runs.message);
      const history = runs.data as any[]; // newest first
      const runId = args.runId ?? history[0]?.id;
      if (!runId) return fail(`Suite ${args.suiteId} has no runs yet.`);
      let baselineRunId: string | undefined = args.baselineRunId;
      if (!baselineRunId) {
        const idx = history.findIndex((r) => r.id === runId);
        baselineRunId = history
          .slice(idx + 1)
          .find((r) => r.status !== "running")?.id;
        if (!baselineRunId) {
          return fail(
            "There is no earlier finished run to compare with — pass baselineRunId.",
          );
        }
      }

      const current = await loadRun(ctx, args.suiteId, runId);
      if (!current.ok) return fail(current.message);
      const baseline = await loadRun(ctx, args.suiteId, baselineRunId);
      if (!baseline.ok) return fail(baseline.message);

      const rank: Record<Verdict, number> = { pass: 3, warn: 2, fail: 1, error: 0 };
      const minDelta = args.minDelta ?? 0.1;
      // questions are matched by id; the text snapshot covers deleted ones
      const keyOf = (res: any) => res.questionId ?? `text:${res.questionText}`;
      const before = new Map(baseline.data.results.map((r) => [keyOf(r), r]));
      const regressions: any[] = [];
      const improvements: any[] = [];
      const onlyInRun: string[] = [];
      let unchanged = 0;

      for (const res of current.data.results) {
        const old = before.get(keyOf(res));
        if (!old) {
          onlyInRun.push(res.questionText);
          continue;
        }
        before.delete(keyOf(res));
        const now = verdictOf(res);
        const was = verdictOf(old);
        const delta =
          typeof res.totalScore === "number" &&
          typeof old.totalScore === "number"
            ? res.totalScore - old.totalScore
            : undefined;
        const row = {
          questionId: res.questionId ?? undefined,
          question: res.questionText,
          verdict: `${was} → ${now}`,
          total: `${round(old.totalScore) ?? "–"} → ${round(res.totalScore) ?? "–"}`,
          delta: round(delta),
          hardGateReasons: nonEmpty(res.judgeReport?.flags?.hardGateReasons),
        };
        if (rank[now] < rank[was] || (delta !== undefined && delta <= -minDelta)) {
          regressions.push(row);
        } else if (
          rank[now] > rank[was] ||
          (delta !== undefined && delta >= minDelta)
        ) {
          improvements.push(row);
        } else {
          unchanged++;
        }
      }

      const a = slimRun(current.data.run);
      const b = slimRun(baseline.data.run);
      const diff = (key: string) => {
        const x = (a.aggregates as any)?.[key];
        const y = (b.aggregates as any)?.[key];
        return typeof x === "number" && typeof y === "number"
          ? round(x - y)
          : undefined;
      };
      return ok({
        run: { id: a.id, status: a.status, startedAt: a.startedAt, verdicts: a.verdicts, aggregates: a.aggregates },
        baseline: { id: b.id, status: b.status, startedAt: b.startedAt, verdicts: b.verdicts, aggregates: b.aggregates },
        delta: {
          passRate: diff("passRate"),
          meanTotal: diff("meanTotal"),
          meanToolUsage: diff("meanToolUsage"),
          meanGroundedness: diff("meanGroundedness"),
          meanRelevance: diff("meanRelevance"),
        },
        regressions: regressions.sort((x, y) => (x.delta ?? -1) - (y.delta ?? -1)),
        improvements: improvements.sort((x, y) => (y.delta ?? 1) - (x.delta ?? 1)),
        unchanged,
        onlyInRun: nonEmpty(onlyInRun),
        onlyInBaseline: nonEmpty([...before.values()].map((r) => r.questionText)),
      });
    },
  ),

  defineTool(
    {
      name: "cancel_ai_test_run",
      title: "Cancel an AI test run",
      description:
        "Stops a running run before its next question. Results already " +
        "written stay. A run that is no longer running is returned unchanged.",
      inputSchema: z.object({
        suiteId,
        runId: z.string().describe("The run id."),
      }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, aiTestsPath(ctx, `/${args.suiteId}/runs/${args.runId}/cancel`), {
        method: "POST",
        transform: slimRun,
      }),
  ),

  defineTool(
    {
      name: "delete_ai_test_run",
      title: "Delete an AI test run",
      description:
        "Permanently deletes a run and its results (e.g. a botched or " +
        "cancelled run that would skew the history). No undo — confirm with " +
        "the user first.",
      inputSchema: z.object({
        suiteId,
        runId: z.string().describe("The run id."),
      }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, aiTestsPath(ctx, `/${args.suiteId}/runs/${args.runId}`), {
        method: "DELETE",
      }),
  ),
];
