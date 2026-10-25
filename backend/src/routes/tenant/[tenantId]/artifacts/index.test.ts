import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { and, eq, like } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { artifactVersions } from "../../../../db/schema";
import { MAX_KEPT_VERSIONS } from "../../../../lib/artifacts/store";
import { buildWikiTree } from "../../../../lib/wiki/tree";
import defineArtifactContentRoutes from "../../../public/artifact-content";
import defineArtifactRoutes from "./index";

const TENANT = TEST_ORGANISATION_1.id;
const TITLE_PREFIX = "Artifact test ";

let app: SymbiosikaFrameworkHonoApp;
let user1Token: string;
let user2Token: string; // member of org2, NOT org1
let adminToken: string; // member of org1, but not the owner of user1's personal page
let orgPageId: string;
let personalPageId: string;

const enc = new TextEncoder();

const deleteTestPages = () =>
  getDb()
    .delete(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, TENANT),
        like(knowledgeText.title, `${TITLE_PREFIX}%`)
      )
    );

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const uploadFile = (
  pageId: string,
  file: File,
  token = user1Token
) => {
  const form = new FormData();
  form.append("file", file);
  return app.request(`/tenant/${TENANT}/wiki/${pageId}/artifact`, {
    method: "POST",
    body: form,
    headers: auth(token),
  });
};

const uploadJson = (pageId: string, files: { path: string; content: string }[]) =>
  app.request(`/tenant/${TENANT}/wiki/${pageId}/artifact`, {
    method: "POST",
    body: JSON.stringify({ files }),
    headers: { ...auth(user1Token), "Content-Type": "application/json" },
  });

const getInfo = (pageId: string, token = user1Token) =>
  app.request(`/tenant/${TENANT}/wiki/${pageId}/artifact`, {
    headers: auth(token),
  });

const BUNDLE = zipSync({
  "dashboard/index.html": enc.encode(
    '<!doctype html><link rel="stylesheet" href="css/style.css"><script src="app.js"></script><h1>KPI</h1>'
  ),
  "dashboard/app.js": enc.encode("document.title = 'KPI'"),
  "dashboard/css/style.css": enc.encode("h1{color:red}"),
  "dashboard/data/Umsatz 2026.json": enc.encode('{"q1":1}'),
});

describe("Artifact endpoints", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    user1Token = tokens.user1Token;
    user2Token = tokens.user2Token;
    adminToken = tokens.adminToken;

    app = new Hono();
    defineArtifactRoutes(app);
    defineArtifactContentRoutes(app);

    await deleteTestPages();
    const orgPage = await createKnowledgeText({
      tenantId: TENANT,
      title: `${TITLE_PREFIX}organisation`,
      text: "",
      createdBy: TEST_ORG1_USER_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
    });
    orgPageId = orgPage.id;
    const personalPage = await createKnowledgeText({
      tenantId: TENANT,
      title: `${TITLE_PREFIX}personal`,
      text: "",
      createdBy: TEST_ORG1_USER_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: false,
    });
    personalPageId = personalPage.id;
  });

  afterAll(() => {
    // pages only (versions and files cascade), never an unhandled rejection
    deleteTestPages().catch((error) =>
      console.warn("afterAll cleanup failed:", error)
    );
  });

  test("a page without an artifact answers null", async () => {
    const response = await getInfo(orgPageId);
    expect(response.status).toBe(200);
    expect((await response.json() as any).data).toBeNull();
  });

  test("a ZIP upload becomes version 1 and is served sandboxed with relative paths", async () => {
    const response = await uploadFile(
      orgPageId,
      new File([BUNDLE], "dashboard.zip", { type: "application/zip" })
    );
    expect(response.status).toBe(200);
    const info = (await response.json() as any).data;
    expect(info.current.version).toBe(1);
    expect(info.current.entryPath).toBe("index.html");
    expect(info.current.fileCount).toBe(4);
    expect(info.current.sourceName).toBe("dashboard.zip");
    expect(info.contentPath).toMatch(/^\/artifact-content\/[^/]+\/index\.html$/);

    const entry = await app.request(info.contentPath);
    expect(entry.status).toBe(200);
    expect(entry.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const csp = entry.headers.get("content-security-policy")!;
    expect(csp).toStartWith("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(entry.headers.get("referrer-policy")).toBe("no-referrer");
    expect(entry.headers.get("x-content-type-options")).toBe("nosniff");
    expect(entry.headers.get("access-control-allow-origin")).toBe("*");
    expect(await entry.text()).toContain("<h1>KPI</h1>");

    // relative references resolve under the token prefix
    const root = info.contentPath.replace(/index\.html$/, "");
    const css = await app.request(`${root}css/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await css.text()).toBe("h1{color:red}");

    const data = await app.request(`${root}data/Umsatz%202026.json`);
    expect(data.status).toBe(200);
    expect(await data.json() as any).toEqual({ q1: 1 });

    // the bare root serves the entry page, the token without slash redirects
    expect((await app.request(root)).status).toBe(200);
    const bare = await app.request(root.slice(0, -1));
    expect(bare.status).toBe(302);
    expect(bare.headers.get("location")).toBe(root);

    expect((await app.request(`${root}missing.js`)).status).toBe(404);
    expect((await app.request(`${root}..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });

  test("a forged or unknown token gives a plain 404", async () => {
    const info = (await (await getInfo(orgPageId)).json() as any).data;
    const [, , token] = info.contentPath.split("/");
    const [versionId, exp] = token.split(".");
    expect(
      (await app.request(`/artifact-content/${versionId}.${exp}.forged/index.html`)).status
    ).toBe(404);
    expect((await app.request(`/artifact-content/nonsense/index.html`)).status).toBe(404);
  });

  test("a single HTML file and JSON uploads add versions; old versions are pruned", async () => {
    const html = await uploadFile(
      orgPageId,
      new File([enc.encode("<p>single</p>")], "page.html", { type: "text/html" })
    );
    expect(html.status).toBe(200);
    expect((await html.json() as any).data.current.version).toBe(2);

    for (let i = 0; i < MAX_KEPT_VERSIONS; i++) {
      const response = await uploadJson(orgPageId, [
        { path: "index.html", content: `<p>v${i}</p><img src="/abs.png">` },
      ]);
      expect(response.status).toBe(200);
    }
    const info = (await (await getInfo(orgPageId)).json() as any).data;
    expect(info.current.version).toBe(2 + MAX_KEPT_VERSIONS);
    expect(info.current.warnings[0]).toContain("absolute path");
    expect(info.versions).toHaveLength(MAX_KEPT_VERSIONS);
    expect(info.versions[MAX_KEPT_VERSIONS - 1].version).toBe(3);

    const stored = await getDb()
      .select({ id: artifactVersions.id })
      .from(artifactVersions)
      .where(eq(artifactVersions.pageId, orgPageId));
    expect(stored).toHaveLength(MAX_KEPT_VERSIONS);
  });

  test("invalid uploads are refused with a reason", async () => {
    const noIndex = await uploadJson(orgPageId, [{ path: "app.js", content: "1" }]);
    expect(noIndex.status).toBe(400);
    expect((await noIndex.json() as any).error).toContain("index.html");

    const traversal = await uploadJson(orgPageId, [{ path: "../index.html", content: "x" }]);
    expect(traversal.status).toBe(400);

    const notZip = await uploadFile(
      orgPageId,
      new File([enc.encode("hello")], "notes.txt", { type: "text/plain" })
    );
    expect(notZip.status).toBe(400);
  });

  test("the current version downloads as a ZIP", async () => {
    const response = await app.request(
      `/tenant/${TENANT}/wiki/${orgPageId}/artifact/download`,
      { headers: auth(user1Token) }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["index.html"]);
  });

  test("the sidebar tree marks artifact pages", async () => {
    const tree = await buildWikiTree(TENANT, TEST_ORG1_USER_1.id);
    const orgNode = tree.organisation.find((node) => node.id === orgPageId);
    expect(orgNode?.artifact).toBe(true);
    const personalNode = tree.personal.find((node) => node.id === personalPageId);
    expect(personalNode?.artifact).toBe(false);
  });

  test("access follows the page", async () => {
    // another organisation: not even a member
    expect((await getInfo(orgPageId, user2Token)).status).toBe(403);

    // a member of the organisation who cannot see user1's personal page
    const upload = await uploadFile(
      personalPageId,
      new File([enc.encode("<p>x</p>")], "x.html"),
      adminToken
    );
    expect(upload.status).toBe(404);
    expect((await getInfo(personalPageId, adminToken)).status).toBe(404);

    // the owner can
    const own = await uploadFile(
      personalPageId,
      new File([enc.encode("<p>mine</p>")], "mine.html")
    );
    expect(own.status).toBe(200);
  });

  test("removing the artifact keeps the page and stops the content", async () => {
    const info = (await (await getInfo(personalPageId)).json() as any).data;
    const removed = await app.request(
      `/tenant/${TENANT}/wiki/${personalPageId}/artifact`,
      { method: "DELETE", headers: auth(user1Token) }
    );
    expect(removed.status).toBe(200);
    expect((await (await getInfo(personalPageId)).json() as any).data).toBeNull();
    // the still-valid token no longer finds anything
    expect((await app.request(info.contentPath)).status).toBe(404);

    const again = await app.request(
      `/tenant/${TENANT}/wiki/${personalPageId}/artifact`,
      { method: "DELETE", headers: auth(user1Token) }
    );
    expect(again.status).toBe(404);
  });
});
