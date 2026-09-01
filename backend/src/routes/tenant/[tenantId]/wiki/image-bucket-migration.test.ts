import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { getDb } from "@framework/lib/db/db-connection";
import { files } from "@framework/lib/db/schema/files";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { saveFileToDb } from "@framework/lib/storage/db";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import defineWikiRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
let adminToken: string; // owner of org1
let outsiderToken: string; // member of org2, not org1

const TENANT = TEST_ORGANISATION_1.id;
const ROUTE = `/tenant/${TENANT}/wiki/images/migrate-bucket`;

// 1x1 transparent PNG
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

const createdPages: string[] = [];
const createdFiles: string[] = [];

describe("Wiki image bucket migration endpoint", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    adminToken = tokens.user1Token;
    outsiderToken = tokens.user2Token;

    app = new Hono();
    defineWikiRoutes(app);

    const saved = await saveFileToDb(
      new File([PNG_BYTES], "img-0.jpeg", { type: "image/png" }),
      "images",
      TENANT
    );
    createdFiles.push(saved.id);

    const page = await createKnowledgeText({
      tenantId: TENANT,
      title: "Imported datasheet",
      text: `![img-0.jpeg](${saved.path})`,
      createdBy: TEST_ORG1_USER_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
    });
    createdPages.push(page.id);
  });

  afterAll(() => {
    Promise.all([
      createdPages.length > 0
        ? getDb()
            .delete(knowledgeText)
            .where(inArray(knowledgeText.id, createdPages))
        : Promise.resolve(),
      createdFiles.length > 0
        ? getDb().delete(files).where(inArray(files.id, createdFiles))
        : Promise.resolve(),
    ]).catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("admin can preview the migration without changing anything", async () => {
    const response = await testFetcher.post(app, ROUTE, adminToken, {
      dryRun: true,
    });

    expect(response.status).toBe(200);
    expect(response.jsonResponse.success).toBe(true);
    expect(response.jsonResponse.data.dryRun).toBe(true);
    expect(response.jsonResponse.data.movedFiles).toBeGreaterThanOrEqual(1);
  });

  test("admin can run the migration", async () => {
    const response = await testFetcher.post(app, ROUTE, adminToken, {});

    expect(response.status).toBe(200);
    expect(response.jsonResponse.data.dryRun).toBe(false);
    expect(response.jsonResponse.data.movedFiles).toBeGreaterThanOrEqual(1);

    // second call is a no-op — the endpoint is safe to press twice
    const again = await testFetcher.post(app, ROUTE, adminToken, {});
    expect(again.jsonResponse.data.movedFiles).toBe(0);
  });

  test("a member of another organisation is rejected", async () => {
    const response = await testFetcher.post(app, ROUTE, outsiderToken, {});
    expect([401, 403]).toContain(response.status);
  });

  test("unauthenticated request is rejected", async () => {
    const response = await testFetcher.post(app, ROUTE, undefined, {});
    expect(response.status).toBe(401);
  });
});
