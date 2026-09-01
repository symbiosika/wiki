import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import {
  createKnowledgeText,
  updateKnowledgeText,
} from "@framework/lib/knowledge/knowledge-texts";
import { uploadKnowledgeTextImage } from "@framework/lib/knowledge/knowledge-text-files";
import defineWikiRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
let user1Token: string;
let user2Token: string; // member of org2, NOT org1
let pageId: string;
let imageFilename: string; // <uuid>.<ext> as embedded in the page

// 1x1 transparent PNG
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

const deleteTestPages = () =>
  getDb()
    .delete(knowledgeText)
    .where(eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id));

describe("Wiki page image endpoint", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    user1Token = tokens.user1Token;
    user2Token = tokens.user2Token;

    app = new Hono();
    defineWikiRoutes(app);

    await deleteTestPages();

    // page owned by org1 user1
    const page = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      title: "Image endpoint page",
      text: "",
      createdBy: TEST_ORG1_USER_1.id,
      userId: TEST_ORG1_USER_1.id,
    });
    pageId = page.id;

    // upload an image and embed it in the page content
    const upload = await uploadKnowledgeTextImage(
      pageId,
      new File([PNG_BYTES], "pixel.png", { type: "image/png" }),
      { tenantId: TEST_ORGANISATION_1.id, userId: TEST_ORG1_USER_1.id }
    );
    imageFilename = upload.path.split("/").pop()!;

    await updateKnowledgeText(
      pageId,
      { text: `Look at this:\n\n${upload.markdown}\n` },
      { tenantId: TEST_ORGANISATION_1.id, userId: TEST_ORG1_USER_1.id }
    );
  });

  afterAll(() => {
    // pages only — deleting the uploaded file row here races with the next
    // test file over the single-connection PGlite socket; the framework's
    // reference tracking + cleanup cron handles orphaned files anyway.
    // `.catch` rather than `.then`: when that race does bite, the rejection
    // arrives after the file is done and would land as an unhandled rejection
    // between test files, which Bun counts as an error and turns into exit
    // code 1 — blamed on whichever file happened to be running.
    deleteTestPages().catch((error) =>
      console.warn("afterAll cleanup failed:", error)
    );
  });

  test("page member can fetch a referenced image", async () => {
    // raw request: the response is binary, testFetcher would decode it as text
    const response = await app.request(
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${pageId}/images/${imageFilename}`,
      { headers: { Authorization: `Bearer ${user1Token}` } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(PNG_BYTES.length);
  });

  test("unreferenced file id is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${pageId}/images/00000000-0000-4000-8000-000000000000.png`,
      user1Token
    );
    expect(response.status).toBe(404);
  });

  test("malformed filename is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${pageId}/images/..%2Fsecret.png`,
      user1Token
    );
    expect([400, 404]).toContain(response.status);
  });

  test("non-member of the tenant is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${pageId}/images/${imageFilename}`,
      user2Token
    );
    expect([401, 403]).toContain(response.status);
  });

  test("unauthenticated request is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${pageId}/images/${imageFilename}`,
      undefined
    );
    expect(response.status).toBe(401);
  });
});
