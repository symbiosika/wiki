import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { files } from "@framework/lib/db/schema/files";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { syncKnowledgeTextBlocks } from "@framework/lib/knowledge/knowledge-text-blocks";
import { setKnowledgeTextPublicMode } from "@framework/lib/knowledge/knowledge-text-public";
import { MAX_PAGE_FILE_SIZE_BYTES } from "../../../../lib/wiki/page-files";
import definePublicWikiRoutes from "../../../public/wiki";
import defineWikiRoutes from "./index";

const TENANT = TEST_ORGANISATION_1.id;
const context = { tenantId: TENANT, userId: TEST_ORG1_USER_1.id };

let app: SymbiosikaFrameworkHonoApp;
let user1Token: string;
let user2Token: string; // member of org2, NOT org1
let pageId: string;

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% test file\n");

const deleteTestPages = () =>
  getDb().delete(knowledgeText).where(eq(knowledgeText.tenantId, TENANT));

const upload = (file: File, token = user1Token, page = pageId) => {
  const form = new FormData();
  form.append("file", file);
  return app.request(`/tenant/${TENANT}/wiki/${page}/files`, {
    method: "POST",
    body: form,
    headers: { Authorization: `Bearer ${token}` },
  });
};

/** Put a download block for `path` onto the page, as the editor saves it. */
const embed = (path: string, name: string) =>
  syncKnowledgeTextBlocks(
    pageId,
    [
      { type: "markdown", content: "# Downloads" },
      {
        type: "html",
        content: `<div data-type="wiki-download" data-name="${name}"><a href="${path}">${name}</a></div>`,
      },
    ],
    context
  );

describe("Wiki page file (download block) endpoints", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    user1Token = tokens.user1Token;
    user2Token = tokens.user2Token;

    app = new Hono();
    defineWikiRoutes(app);
    definePublicWikiRoutes(app);

    await deleteTestPages();
    const page = await createKnowledgeText({
      tenantId: TENANT,
      title: "Download block page",
      text: "",
      createdBy: TEST_ORG1_USER_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
    });
    pageId = page.id;
  });

  afterAll(() => {
    // see images.test.ts: pages only, and never an unhandled rejection
    deleteTestPages().catch((error) =>
      console.warn("afterAll cleanup failed:", error)
    );
  });

  test("uploads any file type, stamped with the unreferenced-upload expiry", async () => {
    const response = await upload(
      new File([PDF_BYTES], "Preisliste 2026.pdf", { type: "application/pdf" })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fileId: string;
      path: string;
      name: string;
      size: number;
      mimeType: string;
    };
    expect(body.name).toBe("Preisliste 2026.pdf");
    expect(body.size).toBe(PDF_BYTES.byteLength);
    expect(body.mimeType).toBe("application/pdf");
    expect(body.path).toMatch(
      new RegExp(`/files/db/knowledge/${body.fileId}\\.pdf$`)
    );

    const [row] = await getDb()
      .select({ expiresAt: files.expiresAt })
      .from(files)
      .where(eq(files.id, body.fileId));
    expect(row?.expiresAt).toBeTruthy();
  });

  test("a referenced file becomes permanent and downloads as an attachment", async () => {
    const response = await upload(
      new File([PDF_BYTES], "Preisliste 2026.pdf", { type: "application/pdf" })
    );
    const { fileId, path } = (await response.json()) as {
      fileId: string;
      path: string;
    };
    await embed(path, "Preisliste 2026.pdf");

    const [row] = await getDb()
      .select({ expiresAt: files.expiresAt })
      .from(files)
      .where(eq(files.id, fileId));
    expect(row?.expiresAt).toBeNull();

    const filename = path.split("/").pop()!;
    const download = await app.request(
      `/tenant/${TENANT}/wiki/${pageId}/files/${filename}`,
      { headers: { Authorization: `Bearer ${user1Token}` } }
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    const disposition = download.headers.get("content-disposition") ?? "";
    expect(disposition).toStartWith("attachment;");
    expect(disposition).toContain("filename*=UTF-8''Preisliste%202026.pdf");
    expect(new Uint8Array(await download.arrayBuffer()).length).toBe(
      PDF_BYTES.byteLength
    );
  });

  test("an html file is stored and served as an inert download", async () => {
    const response = await upload(
      new File(["<script>alert(1)</script>"], "evil.html", {
        type: "text/html",
      })
    );
    expect(response.status).toBe(200);
    const { path, mimeType } = (await response.json()) as {
      path: string;
      mimeType: string;
    };
    expect(mimeType).toBe("application/octet-stream");
    await embed(path, "evil.html");

    const download = await app.request(
      `/tenant/${TENANT}/wiki/${pageId}/files/${path.split("/").pop()}`,
      { headers: { Authorization: `Bearer ${user1Token}` } }
    );
    expect(download.headers.get("content-type")).toBe(
      "application/octet-stream"
    );
  });

  test("a file above the limit is rejected with 413", async () => {
    const tooBig = new File(
      [new Uint8Array(MAX_PAGE_FILE_SIZE_BYTES + 1)],
      "big.bin",
      { type: "application/octet-stream" }
    );
    const response = await upload(tooBig);
    expect(response.status).toBe(413);
  });

  test("an empty file is rejected", async () => {
    const response = await upload(new File([], "empty.txt"));
    expect(response.status).toBe(400);
  });

  test("a non-member cannot upload", async () => {
    const response = await upload(
      new File([PDF_BYTES], "x.pdf", { type: "application/pdf" }),
      user2Token
    );
    expect([401, 403]).toContain(response.status);
  });

  test("a file the page does not reference cannot be downloaded", async () => {
    const response = await app.request(
      `/tenant/${TENANT}/wiki/${pageId}/files/00000000-0000-4000-8000-000000000000.pdf`,
      { headers: { Authorization: `Bearer ${user1Token}` } }
    );
    expect(response.status).toBe(404);
  });

  test("the public route serves a download only once the page is published", async () => {
    const response = await upload(
      new File([PDF_BYTES], "public.pdf", { type: "application/pdf" })
    );
    const { path } = (await response.json()) as { path: string };
    await embed(path, "public.pdf");
    const url = `/public/wiki/${TENANT}/pages/${pageId}/files/${path.split("/").pop()}`;

    expect((await app.request(url)).status).toBe(404);

    await setKnowledgeTextPublicMode(pageId, "public", context);
    const published = await app.request(url);
    expect(published.status).toBe(200);
    expect(published.headers.get("content-disposition")).toStartWith(
      "attachment;"
    );
  });
});
