import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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
  getDb,
} from "@framework/lib/db/db-connection";
import { eq } from "drizzle-orm";
import { postProcessingAgents } from "../../../../db/schema";
import definePostProcessingAgentRoutes from "./index";

// The runner reads POSTPROCESSING_DEV_STUB at import time, so no key is needed.
process.env.POSTPROCESSING_DEV_STUB = "true";

let app: SymbiosikaFrameworkHonoApp;
let token: string;
let token2: string;

const org = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;
const base = `/tenant/${org}/post-processing-agents`;

describe("Post-processing agent routes", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    const t = await initTests();
    token = t.user1Token;
    token2 = t.user2Token;
    app = new Hono();
    definePostProcessingAgentRoutes(app);

    await getDb()
      .delete(postProcessingAgents)
      .where(eq(postProcessingAgents.tenantId, org));
    await getDb()
      .delete(postProcessingAgents)
      .where(eq(postProcessingAgents.tenantId, org2));
  });

  afterAll(() => {
    getDb()
      .delete(postProcessingAgents)
      .where(eq(postProcessingAgents.tenantId, org))
      .then(() => {});
    getDb()
      .delete(postProcessingAgents)
      .where(eq(postProcessingAgents.tenantId, org2))
      .then(() => {});
  });

  test("rejects an empty prompt", async () => {
    const res = await testFetcher.post(app, base, token, {
      name: "Bad",
      prompt: "",
    });
    expect(res.status).toBe(400);
  });

  test("rejects maxSteps out of range", async () => {
    const res = await testFetcher.post(app, base, token, {
      name: "Bad steps",
      prompt: "do things",
      maxSteps: 999,
    });
    expect(res.status).toBe(400);
  });

  test("cross-tenant listing is rejected", async () => {
    const res = await testFetcher.get(
      app,
      `/tenant/${org2}/post-processing-agents`,
      token,
    );
    expect(res.status).toBe(403);
  });

  test("full CRUD round-trip + test-run", async () => {
    // create
    const created = await testFetcher.post(app, base, token, {
      name: "Datasheet cleanup",
      description: "Rework a noisy datasheet into clean markdown",
      prompt: "You get a datasheet parsed from PDF. Rework it into clean markdown.",
      maxSteps: 20,
    });
    expect(created.status).toBe(200);
    const id = created.jsonResponse.id as string;
    expect(id).toBeTruthy();
    expect(created.jsonResponse.enabled).toBe(true);

    // list
    const list = await testFetcher.get(app, base, token);
    expect(list.status).toBe(200);
    expect(list.jsonResponse.some((a: any) => a.id === id)).toBe(true);

    // get one
    const one = await testFetcher.get(app, `${base}/${id}`, token);
    expect(one.status).toBe(200);
    expect(one.jsonResponse.name).toBe("Datasheet cleanup");

    // update
    const updated = await testFetcher.put(app, `${base}/${id}`, token, {
      name: "Datasheet cleanup v2",
      enabled: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.jsonResponse.name).toBe("Datasheet cleanup v2");
    expect(updated.jsonResponse.enabled).toBe(false);

    // test-run (dev stub → deterministic, no LLM)
    const run = await testFetcher.post(app, `${base}/${id}/test-run`, token, {
      text: "raw datasheet text",
      title: "Widget",
    });
    expect(run.status).toBe(200);
    expect(run.jsonResponse.aborted).toBe(false);
    expect(run.jsonResponse.text).toContain("raw datasheet text");
    expect(typeof run.jsonResponse.summary).toBe("string");

    // delete
    const del = await testFetcher.delete(app, `${base}/${id}`, token);
    expect(del.status).toBe(200);
    const gone = await testFetcher.get(app, `${base}/${id}`, token);
    expect(gone.status).toBe(404);
  });

  test("an agent of tenant A is invisible / 404 for tenant B", async () => {
    // create in org1
    const created = await testFetcher.post(app, base, token, {
      name: "Private A",
      prompt: "secret prompt",
    });
    expect(created.status).toBe(200);
    const id = created.jsonResponse.id as string;

    // org2 member cannot fetch it via its own tenant path
    const foreignGet = await testFetcher.get(
      app,
      `/tenant/${org2}/post-processing-agents/${id}`,
      token2,
    );
    expect(foreignGet.status).toBe(404);

    // org2 member cannot test-run it via its own tenant path
    const foreignRun = await testFetcher.post(
      app,
      `/tenant/${org2}/post-processing-agents/${id}/test-run`,
      token2,
      { text: "x" },
    );
    expect(foreignRun.status).toBe(404);

    // it does not appear in org2's list
    const foreignList = await testFetcher.get(
      app,
      `/tenant/${org2}/post-processing-agents`,
      token2,
    );
    expect(foreignList.status).toBe(200);
    expect(foreignList.jsonResponse.some((a: any) => a.id === id)).toBe(false);
  });
});
