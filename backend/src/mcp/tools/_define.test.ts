/**
 * Unit tests for the tool bridge (no network): argument handling and the
 * page-link enrichment every tool result goes through.
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import { z } from "zod";
import type { McpRequestContext } from "@framework/types";
import type { McpTokenKind } from "@framework/lib/mcp/types";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { defineTool, READ_ONLY } from "./_define";
import { ok, type ToolResult } from "../api";

const BASE = _GLOBAL_SERVER_CONFIG.baseUrl;

const ctx = (
  tenantId?: string,
  tokenKind: McpTokenKind = "session",
): McpRequestContext => ({
  usersId: "u",
  scopes: [],
  tokenKind,
  tenantId,
  fetchApi: async () => new Response("{}"),
});

describe("defineTool()", () => {
  test("adds page urls to every tool result", async () => {
    const tool = defineTool(
      {
        name: "t",
        title: "T",
        description: "d",
        inputSchema: z.object({ pageId: z.string() }),
        annotations: READ_ONLY,
      },
      async (args) => ok({ id: args.pageId, title: "Urlaub" }),
    );

    const result = (await tool.handler!({ pageId: "p1" }, ctx("t-1"))) as ToolResult;
    const expected = `${BASE}/tenant/t-1/wiki/p1`;
    expect((result.structuredContent as any).url).toBe(expected);
    expect(JSON.parse((result.content[0] as any).text).url).toBe(expected);
  });

  test("opaqueIds keeps non-page ids unlinked", async () => {
    const tool = defineTool(
      {
        name: "t",
        title: "T",
        description: "d",
        annotations: READ_ONLY,
        opaqueIds: true,
      },
      async () => ok({ id: "r1", title: "Anna" }),
    );

    const result = (await tool.handler!({}, ctx("t-1"))) as ToolResult;
    expect((result.structuredContent as any).url).toBeUndefined();
  });

  test("passes the result through when no organisation is bound", async () => {
    const tool = defineTool(
      { name: "t", title: "T", description: "d", annotations: READ_ONLY },
      async () => ok({ id: "p1", title: "Urlaub" }),
    );

    const result = (await tool.handler!({}, ctx(undefined, "oauth"))) as ToolResult;
    expect((result.structuredContent as any).url).toBeUndefined();
  });

  test("still validates the arguments before running the handler", async () => {
    const tool = defineTool(
      {
        name: "t",
        title: "T",
        description: "d",
        inputSchema: z.object({ pageId: z.string() }),
        annotations: READ_ONLY,
      },
      async () => ok("never reached"),
    );

    expect(tool.handler!({ pageId: 42 }, ctx("t-1"))).rejects.toThrow(
      /Input validation error/,
    );
  });
});
