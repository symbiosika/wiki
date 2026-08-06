/**
 * Document-assistant route tests. The agent runs through the dev stub
 * (PROTOCOL_DEV_STUB), so run this suite with that env set:
 *   PROTOCOL_DEV_STUB=true bun test src/routes/tenant/[tenantId]/document-assistant/index.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import {
  syncKnowledgeTextBlocks,
  getKnowledgeTextBlocks,
} from "@framework/lib/knowledge/knowledge-text-blocks";
import { readKnowledgeTextContent } from "@framework/lib/knowledge/knowledge-text-edit";
import defineDocumentAssistantRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
let token: string;
let userId: string;

const cleanup = () =>
  getDb()
    .delete(knowledgeText)
    .where(eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id));

const createBlockPage = async (): Promise<string> => {
  const page = await createKnowledgeText({
    tenantId: TEST_ORGANISATION_1.id,
    userId,
    title: "Testseite",
    text: "# Testseite\n\nHallo Welt",
    contentMode: "blocks",
  });
  const ctx = { tenantId: TEST_ORGANISATION_1.id, userId };
  await syncKnowledgeTextBlocks(
    page.id,
    [{ type: "markdown", content: "# Testseite\n\nHallo Welt" }],
    ctx,
  );
  return page.id;
};

describe("Document Assistant Routes", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    token = tokens.user1Token;
    userId = TEST_ORG1_USER_1.id;
    app = new Hono();
    defineDocumentAssistantRoutes(app);
    await cleanup();
  });

  // Fire and forget cleanup (Bun limitation — see the backend-testing skill).
  // `.catch` rather than `.then`: a rejection after the file is done would
  // otherwise land as an unhandled rejection between test files, which Bun
  // counts as an error and turns into exit code 1.
  afterAll(() => {
    cleanup().catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("unauthenticated request is rejected", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/document-assistant`,
      undefined,
      { entryId: "00000000-0000-0000-0000-000000000000", instruction: "x" },
    );
    expect(res.status).toBe(401);
  });

  test("cross-tenant request is rejected", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_2.id}/document-assistant`,
      token,
      { entryId: "00000000-0000-0000-0000-000000000000", instruction: "x" },
    );
    expect(res.status).toBe(403);
  });

  test("missing instruction is rejected", async () => {
    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/document-assistant`,
      token,
      { entryId: "00000000-0000-0000-0000-000000000000" },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("works the instruction into the page (dev stub)", async () => {
    const entryId = await createBlockPage();

    const res = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/document-assistant`,
      token,
      { entryId, instruction: "Neue Notiz vom Assistenten" },
    );

    expect(res.status).toBe(200);
    expect(res.jsonResponse?.success).toBe(true);
    expect(res.jsonResponse?.appliedEdits).toBeGreaterThan(0);

    // the change landed in the document and the original content is preserved
    const view = await readKnowledgeTextContent(entryId, {
      tenantId: TEST_ORGANISATION_1.id,
      userId,
    });
    expect(view.content).toContain("Neue Notiz vom Assistenten");
    expect(view.content).toContain("Hallo Welt");

    // it was added as a real block, so the block editor will show it
    const blocks = await getKnowledgeTextBlocks(entryId, {
      tenantId: TEST_ORGANISATION_1.id,
      userId,
    });
    expect(blocks.length).toBeGreaterThan(1);
  });
});
