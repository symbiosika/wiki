/**
 * End-to-end test of the embedded wiki MCP server: the framework mounts it,
 * a session JWT authenticates, and the tools talk to the REAL knowledge
 * routes in-process via `ctx.fetchApi` — DB included.
 *
 * The wire surface asserted here (server name/version, tool names, JSON
 * schemas, MCP-Apps linkage) is the compatibility contract with the former
 * standalone ../../mcp-server process: clients must not be able to tell the
 * difference.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { initTests, TEST_ORGANISATION_1 } from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { defineMcpRoutes } from "@framework/lib/mcp";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import defineKnowledgeTextsRoutes from "@framework/routes/tenant/[tenantId]/knowledge/texts";
import defineWikiRoutes from "../routes/tenant/[tenantId]/wiki";

let app: Hono;
let user1Token: string;

const org1 = TEST_ORGANISATION_1.id;

/** Every tool the standalone MCP server exposed, by name. */
const EXPECTED_TOOLS = [
  // identity
  "whoami",
  "list_organisations",
  // discovery
  "get_wiki_overview",
  "get_wiki_tree",
  "search_wiki",
  "resolve_page",
  "list_recent_changes",
  "list_pages",
  "get_wiki_config",
  // read
  "get_page",
  "get_page_metadata",
  "get_pages",
  "get_page_outline",
  "read_page_section",
  "read_page_content",
  "get_page_subtree",
  "get_page_chunk_context",
  "get_page_links",
  "get_page_backlinks",
  "get_related_pages",
  "get_page_history",
  "get_page_version",
  // write
  "create_page",
  "update_page",
  "append_to_page",
  "edit_page_content",
  "delete_page",
  // app UI
  "view_page",
  "view_image",
  "view_page_images",
  "get_page_image",
];

const rpc = async (body: unknown, token: string | null = null) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: text ? JSON.parse(text) : undefined,
  };
};

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const { json } = await rpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
    user1Token,
  );
  return json.result;
};

const deleteWikiTestPages = () =>
  getDb().delete(knowledgeText).where(eq(knowledgeText.tenantId, org1));

describe("Embedded MCP server (symbiosika-wiki)", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    user1Token = tokens.user1Token;

    // Session JWTs carry no tenant binding — the tools then use the
    // single-org fallback. Must be set before ./index is imported (the
    // definition wires the env-reading helpers), hence the dynamic import.
    process.env.WIKI_TENANT_ID = org1;
    const { wikiMcpServer } = await import("./index");

    app = new Hono();
    defineMcpRoutes(app as any, [wikiMcpServer]);
    // The tools call the tenant API under its production prefix.
    const api = new Hono() as unknown as SymbiosikaFrameworkHonoApp;
    defineKnowledgeTextsRoutes(api, "");
    defineWikiRoutes(api, "");
    app.route("/api/v1", api as unknown as Hono);

    await deleteWikiTestPages();
  });

  afterAll(async () => {
    delete process.env.WIKI_TENANT_ID;
    await deleteWikiTestPages().catch(() => {});
  });

  test("unauthenticated requests get a 401 with a resource-metadata pointer", async () => {
    const { status, headers } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(status).toBe(401);
    expect(headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
  });

  test("initialize reports the same identity as the standalone server", async () => {
    const { status, json } = await rpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      },
      user1Token,
    );
    expect(status).toBe(200);
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect(json.result.serverInfo.name).toBe("symbiosika-wiki-mcp");
    expect(json.result.serverInfo.version).toBe("0.3.0");
    expect(json.result.instructions).toContain("Company Wiki");
    expect(json.result.capabilities.resources).toBeDefined();
  });

  test("tools/list exposes exactly the standalone server's tool set", async () => {
    const { json } = await rpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      user1Token,
    );
    const names = json.result.tools.map((t: any) => t.name);
    expect(names.sort()).toEqual([...EXPECTED_TOOLS].sort());

    // zod schemas survive as the same JSON Schema the old SDK emitted.
    const search = json.result.tools.find((t: any) => t.name === "search_wiki");
    expect(search.inputSchema.type).toBe("object");
    expect(search.inputSchema.required).toEqual(["query"]);
    expect(search.inputSchema.properties.mode.enum).toEqual([
      "hybrid",
      "fulltext",
      "semantic",
    ]);
    expect(search.inputSchema.properties.query.minLength).toBe(1);

    // Tools without arguments advertise an empty object schema.
    const treeTool = json.result.tools.find(
      (t: any) => t.name === "get_wiki_tree",
    );
    expect(treeTool.inputSchema).toEqual({ type: "object", properties: {} });

    // MCP-Apps linkage survives on the wire (modern + legacy key).
    const viewPage = json.result.tools.find((t: any) => t.name === "view_page");
    expect(viewPage._meta.ui.resourceUri).toBe(
      "ui://symbiosika-wiki/page-view.html",
    );
    expect(viewPage._meta["ui/resourceUri"]).toBe(
      "ui://symbiosika-wiki/page-view.html",
    );
  });

  test("create → read → edit → delete a page through the real routes", async () => {
    const created = await callTool("create_page", {
      title: "MCP e2e page",
      content: "# Hello\n\nFirst version.",
    });
    expect(created.isError).toBeUndefined();
    const pageId = created.structuredContent.id as string;
    expect(pageId).toBeString();

    const read = await callTool("get_page", { pageId });
    expect(read.isError).toBeUndefined();
    expect(read.structuredContent.title).toBe("MCP e2e page");
    expect(read.structuredContent.content).toContain("First version.");

    const edited = await callTool("edit_page_content", {
      pageId,
      oldString: "First version.",
      newString: "Second version.",
    });
    expect(edited.isError).toBeUndefined();

    const reread = await callTool("get_page", { pageId });
    expect(reread.structuredContent.content).toContain("Second version.");
    expect(reread.structuredContent.content).not.toContain("First version.");

    const deleted = await callTool("delete_page", { pageId });
    expect(deleted.isError).toBeUndefined();

    const gone = await callTool("get_page", { pageId });
    expect(gone.isError).toBe(true);
  });

  test("get_wiki_tree resolves through the app's own wiki routes", async () => {
    const result = await callTool("get_wiki_tree");
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.personal).toBeDefined();
    expect(result.structuredContent.organisation).toBeDefined();
  });

  test("invalid arguments produce the old SDK's validation error", async () => {
    const result = await callTool("get_page", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "Input validation error: Invalid arguments for tool get_page",
    );
    expect(result.content[0].text).toContain("pageId");
  });

  test("resources/read bundles the page view on demand", async () => {
    const { json } = await rpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "ui://symbiosika-wiki/page-view.html" },
      },
      user1Token,
    );
    const contents = json.result.contents[0];
    expect(contents.mimeType).toBe("text/html;profile=mcp-app");
    expect(contents.text).toContain("callServerTool");
    expect(contents.text.length).toBeGreaterThan(10_000);
  }, 60_000);

  test("the protected-resource metadata points clients at this app", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.resource).toContain("/mcp");
    expect(body.scopes_supported).toContain("knowledge:read");
    expect(body.scopes_supported).toContain("user:read");
    expect(body.bearer_methods_supported).toEqual(["header"]);
  });
});
