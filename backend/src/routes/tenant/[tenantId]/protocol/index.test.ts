/**
 * Route tests. The AI/STT calls run through the dev stub (PROTOCOL_DEV_STUB),
 * so this suite must be run with that env set:
 *   PROTOCOL_DEV_STUB=true bun test src/routes/tenant/[tenantId]/protocol/index.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import defineProtocolRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
let token: string;

const cleanup = () =>
  getDb()
    .delete(knowledgeText)
    .where(eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id));

describe("Protocol Routes", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    token = tokens.user1Token;
    app = new Hono();
    defineProtocolRoutes(app);
    await cleanup();
  });

  // Fire and forget cleanup (Bun limitation — see the backend-testing skill).
  // `.catch` rather than `.then`: a rejection after the file is done would
  // otherwise land as an unhandled rejection between test files, which Bun
  // counts as an error and turns into exit code 1.
  afterAll(() => {
    cleanup().catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("unauthenticated create is rejected", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/protocol`,
      undefined,
      { transcript: "x" },
    );
    expect(res.status).toBe(401);
  });

  test("cross-tenant create is rejected", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_2.id}/protocol`,
      token,
      { transcript: "x" },
    );
    expect(res.status).toBe(403);
  });

  test("transcribe without audio returns 400", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/protocol/transcribe`,
      token,
      {},
    );
    expect(res.status).toBe(400);
  });

  test("create protocol files a dated page (dev stub)", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/protocol`,
      token,
      { transcript: "Heute mit Acme gesprochen. Bestellung plus 20 Prozent." },
    );
    expect(res.status).toBe(200);
    expect(res.jsonResponse?.success).toBe(true);
    expect(res.jsonResponse?.entryId).toBeDefined();
    expect(String(res.jsonResponse?.title)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · /);

    // the page was filed under a personal "Tagesprotokolle" folder
    const rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id));
    expect(rows.some((r) => r.title === "Tagesprotokolle")).toBe(true);
  });

  test("process protocol merges into the Wissensbasis (dev stub)", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/protocol/process`,
      token,
      { protocol: "Acme erhöht die Bestellung um 20 Prozent." },
    );
    expect(res.status).toBe(200);
    expect(res.jsonResponse?.success).toBe(true);
    expect(res.jsonResponse?.processedFacts).toBeGreaterThan(0);

    const rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id));
    expect(rows.some((r) => r.title === "Wissensbasis")).toBe(true);
    expect(rows.some((r) => r.title === "90_sonstiges")).toBe(true);
  });
});
