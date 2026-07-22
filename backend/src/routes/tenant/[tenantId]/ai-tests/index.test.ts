import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  createDatabaseClient,
  waitForDbConnection,
} from "@framework/lib/db/db-connection";

// The agent + judge read AI_TESTS_DEV_STUB at import time, so the whole run
// stays deterministic and needs no OPENROUTER_API_KEY. Set it before the
// dynamic imports in beforeAll.
process.env.AI_TESTS_DEV_STUB = "true";

let app: SymbiosikaFrameworkHonoApp;
let token: string;
let processDueJobsOnce: () => Promise<void>;

const org = TEST_ORGANISATION_1.id;
const suitesPath = `/tenant/${org}/ai-tests/suites`;

describe("AI test suite routes", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    token = (await initTests()).user1Token;

    const routes = (await import("./index")).default;
    const { aiTestJobHandler } = await import(
      "../../../../lib/ai-tests/runner"
    );
    const jobs = await import("@framework/lib/jobs");
    jobs.defineJob(aiTestJobHandler.type, aiTestJobHandler.handler);
    processDueJobsOnce = jobs.processDueJobsOnce;

    app = new Hono();
    routes(app);
  });

  test("rejects an invalid create body", async () => {
    const res = await testFetcher.post(app, suitesPath, token, {});
    expect(res.status).toBe(400);
  });

  test("cross-tenant access is rejected", async () => {
    const res = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_2.id}/ai-tests/suites`,
      token,
    );
    expect(res.status).toBe(403);
  });

  test("full flow: suite → questions → run → results", async () => {
    // create suite
    const created = await testFetcher.post(app, suitesPath, token, {
      name: "Support questions",
      description: "Regression suite",
    });
    expect(created.status).toBe(200);
    const suiteId = created.jsonResponse.id as string;
    expect(suiteId).toBeTruthy();

    // appears in the list
    const list = await testFetcher.get(app, suitesPath, token);
    expect(list.jsonResponse.some((s: any) => s.id === suiteId)).toBe(true);

    // set two questions (one answerable, one not-in-wiki)
    const setRes = await testFetcher.put(
      app,
      `${suitesPath}/${suiteId}/questions`,
      token,
      {
        questions: [
          { question: "How many vacation days do we get?", type: "answerable" },
          {
            question: "What is the airspeed velocity of a swallow?",
            type: "not-in-wiki",
          },
        ],
      },
    );
    expect(setRes.status).toBe(200);
    expect(setRes.jsonResponse.length).toBe(2);
    const firstQuestionId = setRes.jsonResponse[0].id as string;

    // re-saving with the returned id preserves it (time-series survives edits)
    const reSet = await testFetcher.put(
      app,
      `${suitesPath}/${suiteId}/questions`,
      token,
      {
        questions: [
          {
            id: firstQuestionId,
            question: "How many vacation days do we get now?",
            type: "answerable",
          },
        ],
      },
    );
    expect(reSet.status).toBe(200);
    expect(reSet.jsonResponse.length).toBe(1);
    expect(reSet.jsonResponse[0].id).toBe(firstQuestionId);

    // restore both questions for the run
    await testFetcher.put(app, `${suitesPath}/${suiteId}/questions`, token, {
      questions: [
        { question: "How many vacation days do we get?", type: "answerable" },
        {
          question: "What is the airspeed velocity of a swallow?",
          type: "not-in-wiki",
        },
      ],
    });

    // start a run → 202 + running row
    const run = await testFetcher.post(
      app,
      `${suitesPath}/${suiteId}/run`,
      token,
      {},
    );
    expect(run.status).toBe(202);
    expect(run.jsonResponse.status).toBe("running");
    expect(run.jsonResponse.total).toBe(2);
    const runId = run.jsonResponse.id as string;

    // starting again while one is running returns the SAME run (no duplicate)
    const dupe = await testFetcher.post(
      app,
      `${suitesPath}/${suiteId}/run`,
      token,
      {},
    );
    expect(dupe.jsonResponse.id).toBe(runId);

    // drain the durable job queue → the run executes
    await processDueJobsOnce();

    // run detail: terminal status + one result per question
    const detail = await testFetcher.get(
      app,
      `${suitesPath}/${suiteId}/runs/${runId}`,
      token,
    );
    expect(detail.status).toBe(200);
    expect(detail.jsonResponse.run.status).toBe("success");
    expect(detail.jsonResponse.results.length).toBe(2);

    const byType: Record<string, any> = {};
    for (const r of detail.jsonResponse.results) byType[r.questionType] = r;

    // answerable question passes with the stub agent + judge
    expect(byType.answerable.verdict).toBe("pass");
    expect(byType.answerable.trajectory.steps.length).toBeGreaterThan(0);
    expect(byType.answerable.scores.total).toBeGreaterThan(0.7);

    // not-in-wiki question fails via the hard gate (stub gives a real answer)
    expect(byType["not-in-wiki"].verdict).toBe("fail");
    expect(
      byType["not-in-wiki"].judgeReport.flags.hardGateReasons,
    ).toContain("answered-not-in-wiki");

    // aggregates reflect one hard-gate fail
    expect(detail.jsonResponse.run.aggregates.hardGateFails).toBe(1);
    expect(detail.jsonResponse.run.aggregates.byType.answerable.passRate).toBe(
      1,
    );

    // delete the suite
    const del = await testFetcher.delete(
      app,
      `${suitesPath}/${suiteId}`,
      token,
    );
    expect(del.status).toBe(200);
    const gone = await testFetcher.get(app, `${suitesPath}/${suiteId}`, token);
    expect(gone.status).toBe(404);
  });

  test("bulk import adds one question per line", async () => {
    const created = await testFetcher.post(app, suitesPath, token, {
      name: "Bulk suite",
    });
    const suiteId = created.jsonResponse.id as string;

    const bulk = await testFetcher.post(
      app,
      `${suitesPath}/${suiteId}/questions/bulk`,
      token,
      { text: "Question one?\n\n  Question two?  \nQuestion three?" },
    );
    expect(bulk.status).toBe(200);
    expect(bulk.jsonResponse.length).toBe(3);

    await testFetcher.delete(app, `${suitesPath}/${suiteId}`, token);
  });

  test("a run can be cancelled before it executes", async () => {
    const created = await testFetcher.post(app, suitesPath, token, {
      name: "Cancellable suite",
    });
    const suiteId = created.jsonResponse.id as string;
    await testFetcher.post(
      app,
      `${suitesPath}/${suiteId}/questions/bulk`,
      token,
      { text: "One?\nTwo?" },
    );

    const run = await testFetcher.post(
      app,
      `${suitesPath}/${suiteId}/run`,
      token,
      {},
    );
    const runId = run.jsonResponse.id as string;

    const cancel = await testFetcher.post(
      app,
      `${suitesPath}/${suiteId}/runs/${runId}/cancel`,
      token,
      {},
    );
    expect(cancel.status).toBe(200);
    expect(cancel.jsonResponse.status).toBe("cancelled");

    // draining now must NOT flip it back to running/success
    await processDueJobsOnce();
    const detail = await testFetcher.get(
      app,
      `${suitesPath}/${suiteId}/runs/${runId}`,
      token,
    );
    expect(detail.jsonResponse.run.status).toBe("cancelled");

    await testFetcher.delete(app, `${suitesPath}/${suiteId}`, token);
  });
});
