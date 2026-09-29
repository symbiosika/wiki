/**
 * End-to-end test of the AI-test MCP tools: an agent builds a suite, fills it
 * with questions, runs it twice and evaluates the runs — through the embedded
 * MCP server and the REAL /ai-tests routes, DB and job queue included.
 *
 * The chat agent and the judge run on their deterministic dev stub
 * (AI_TESTS_DEV_STUB), so no model API key is needed.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { initTests, TEST_ORGANISATION_1 } from "@framework/test/init.test";
import { defineMcpRoutes } from "@framework/lib/mcp";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";

// read by the agent + judge at import time — set before the dynamic imports
process.env.AI_TESTS_DEV_STUB = "true";

let app: Hono;
let token: string;
let processDueJobsOnce: () => Promise<void>;

const org1 = TEST_ORGANISATION_1.id;

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return ((await res.json()) as any).result;
};

describe("AI-test MCP tools", () => {
  beforeAll(async () => {
    token = (await initTests()).user1Token;
    process.env.WIKI_TENANT_ID = org1;

    const { wikiMcpServer } = await import("../index");
    const defineAiTestRoutes = (
      await import("../../routes/tenant/[tenantId]/ai-tests")
    ).default;
    const { aiTestJobHandler } = await import("../../lib/ai-tests/runner");
    const jobs = await import("@framework/lib/jobs");
    jobs.defineJob(aiTestJobHandler.type, aiTestJobHandler.handler);
    processDueJobsOnce = jobs.processDueJobsOnce;

    app = new Hono();
    defineMcpRoutes(app as any, [wikiMcpServer]);
    const api = new Hono() as unknown as SymbiosikaFrameworkHonoApp;
    defineAiTestRoutes(api, "");
    app.route("/api/v1", api as unknown as Hono);
  });

  afterAll(() => {
    delete process.env.WIKI_TENANT_ID;
  });

  test("an agent drives a suite from creation to evaluation", async () => {
    // --- build the suite ---------------------------------------------------
    const created = await callTool("create_ai_test_suite", {
      name: "MCP regression suite",
      description: "Driven by an agent",
      stepLimit: 8,
    });
    expect(created.isError).toBeUndefined();
    const suiteId = created.structuredContent.id as string;
    expect(created.structuredContent.stepLimit).toBe(8);

    const listed = await callTool("list_ai_test_suites");
    expect(
      listed.structuredContent.items.some((s: any) => s.id === suiteId),
    ).toBe(true);

    const added = await callTool("add_ai_test_questions", {
      suiteId,
      questions: [
        {
          question: "How many vacation days do we get?",
          type: "answerable",
          expectedFacts: ["30 days"],
        },
        {
          question: "What is the airspeed velocity of a swallow?",
          type: "not-in-wiki",
        },
      ],
    });
    expect(added.isError).toBeUndefined();
    expect(added.structuredContent.added).toBe(2);
    expect(added.structuredContent.total).toBe(2);

    // a second batch is APPENDED; the first questions keep ids and facts
    const more = await callTool("add_ai_test_questions", {
      suiteId,
      questions: [{ question: "Who approves travel expenses?" }],
    });
    expect(more.structuredContent.total).toBe(3);

    const suite = await callTool("get_ai_test_suite", { suiteId });
    const questions = suite.structuredContent.questions as any[];
    expect(questions.map((q) => q.question)).toEqual([
      "How many vacation days do we get?",
      "What is the airspeed velocity of a swallow?",
      "Who approves travel expenses?",
    ]);
    expect(questions[0].expectedFacts).toEqual(["30 days"]);
    expect(questions[0].id).toBe(added.structuredContent.questions[0].id);

    // pause one question, delete another
    const paused = await callTool("update_ai_test_question", {
      suiteId,
      questionId: questions[2].id,
      active: false,
    });
    expect(paused.isError).toBeUndefined();
    expect(paused.structuredContent.active).toBe(false);
    expect(paused.structuredContent.question).toBe(
      "Who approves travel expenses?",
    );

    const unknownDelete = await callTool("delete_ai_test_questions", {
      suiteId,
      questionIds: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(unknownDelete.isError).toBe(true);

    // --- first run: wait for it while the job queue executes it ------------
    const started = await callTool("start_ai_test_run", { suiteId });
    expect(started.isError).toBeUndefined();
    expect(started.structuredContent.status).toBe("running");
    expect(started.structuredContent.progress).toBe("0/2"); // paused one skipped
    const firstRunId = started.structuredContent.id as string;

    // the queue drains while the call is already waiting (between two polls
    // — the embedded test DB does not like overlapping queries)
    const drained = new Promise<void>((resolve, reject) =>
      setTimeout(() => processDueJobsOnce().then(resolve, reject), 500),
    );
    const waited = await callTool("get_ai_test_run", {
      suiteId,
      waitSeconds: 20,
    });
    await drained;
    expect(waited.isError).toBeUndefined();
    const run = waited.structuredContent;
    expect(run.run.id).toBe(firstRunId);
    expect(run.run.status).toBe("success");
    expect(run.run.progress).toBe("2/2");
    expect(run.run.verdicts).toEqual({ pass: 1, warn: 0, fail: 1, error: 0 });
    expect(run.run.aggregates.passRate).toBe(0.5);
    expect(run.resultCount).toBe(2);

    // the failing not-in-wiki question explains itself
    expect(run.weakest[0].question).toBe(
      "What is the airspeed velocity of a swallow?",
    );
    const failing = await callTool("get_ai_test_run", {
      suiteId,
      runId: firstRunId,
      verdicts: ["fail"],
    });
    expect(failing.structuredContent.resultCount).toBe(1);
    const failed = failing.structuredContent.results[0];
    expect(failed.verdict).toBe("fail");
    expect(failed.hardGateReasons).toContain("answered-not-in-wiki");
    expect(failed.trajectory).toBeUndefined(); // only with detail=full

    const full = await callTool("get_ai_test_run", {
      suiteId,
      runId: firstRunId,
      questionId: questions[0].id,
      detail: "full",
      includeAnswers: false,
    });
    const detail = full.structuredContent.results[0];
    expect(detail.verdict).toBe("pass");
    expect(detail.trajectory.length).toBeGreaterThan(0);
    expect(detail.answer).toBeUndefined();

    // --- second run + comparison -----------------------------------------
    // drop the not-in-wiki question: the next run has only the passing one
    await callTool("delete_ai_test_questions", {
      suiteId,
      questionIds: [questions[1].id],
    });
    const second = await callTool("start_ai_test_run", { suiteId });
    const secondRunId = second.structuredContent.id as string;
    await processDueJobsOnce();

    const history = await callTool("list_ai_test_runs", { suiteId });
    expect(history.structuredContent.items.map((r: any) => r.id)).toEqual([
      secondRunId,
      firstRunId,
    ]);

    const compared = await callTool("compare_ai_test_runs", { suiteId });
    expect(compared.isError).toBeUndefined();
    const cmp = compared.structuredContent;
    expect(cmp.run.id).toBe(secondRunId);
    expect(cmp.baseline.id).toBe(firstRunId);
    expect(cmp.delta.passRate).toBe(0.5);
    expect(cmp.unchanged).toBe(1);
    expect(cmp.regressions).toEqual([]);
    expect(cmp.onlyInBaseline).toEqual([
      "What is the airspeed velocity of a swallow?",
    ]);

    // --- control: cancel + delete -----------------------------------------
    const third = await callTool("start_ai_test_run", { suiteId });
    const thirdRunId = third.structuredContent.id as string;
    const still = await callTool("get_ai_test_run", {
      suiteId,
      runId: thirdRunId,
    });
    expect(still.structuredContent.run.status).toBe("running");
    expect(still.structuredContent.hint).toContain("Still running");

    const cancelled = await callTool("cancel_ai_test_run", {
      suiteId,
      runId: thirdRunId,
    });
    expect(cancelled.structuredContent.status).toBe("cancelled");
    await processDueJobsOnce(); // the queued job sees the cancel and stops

    const removed = await callTool("delete_ai_test_run", {
      suiteId,
      runId: thirdRunId,
    });
    expect(removed.isError).toBeUndefined();

    const deleted = await callTool("delete_ai_test_suite", { suiteId });
    expect(deleted.isError).toBeUndefined();
    const gone = await callTool("get_ai_test_suite", { suiteId });
    expect(gone.isError).toBe(true);
  }, 60_000);
});
