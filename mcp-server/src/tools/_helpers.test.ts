/**
 * Unit tests for the tool wrapper (no network): argument normalization and the
 * page-link enrichment every tool result goes through.
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import { defineTool } from "./_helpers.ts";
import { ok, type ToolResult } from "../app-api.ts";
import { APP_BASE_URL } from "../config.ts";
import type { AuthInfo } from "@modelcontextprotocol/server";

const auth = (tenant?: string): AuthInfo =>
  ({ token: "t", clientId: "c", scopes: [], extra: { sub: "u", tenant } }) as AuthInfo;

/** Minimal stand-in for the MCP server: keeps the registered callback. */
const fakeMcp = () => {
  const tools: Record<string, (...args: any[]) => Promise<ToolResult>> = {};
  return {
    mcp: {
      registerTool: (name: string, _config: unknown, cb: any) => {
        tools[name] = cb;
      },
    },
    call: (name: string, args: unknown, authInfo?: AuthInfo) =>
      tools[name]!(args, { http: { authInfo } }),
  };
};

describe("defineTool()", () => {
  test("adds page urls to every tool result", async () => {
    const { mcp, call } = fakeMcp();
    defineTool(
      mcp,
      { name: "t", title: "T", description: "d", inputSchema: {} as any },
      async (args) => ok({ id: args.pageId, title: "Urlaub" }),
    );

    const result = await call("t", { pageId: "p1" }, auth("t-1"));
    const expected = `${APP_BASE_URL}/tenant/t-1/wiki/p1`;
    expect((result.structuredContent as any).url).toBe(expected);
    expect(JSON.parse((result.content[0] as any).text).url).toBe(expected);
  });

  test("passes the result through when no organisation is bound", async () => {
    const { mcp, call } = fakeMcp();
    defineTool(
      mcp,
      { name: "t", title: "T", description: "d", inputSchema: {} as any },
      async () => ok({ id: "p1", title: "Urlaub" }),
    );

    const result = await call("t", {}, auth(undefined));
    expect((result.structuredContent as any).url).toBeUndefined();
  });

  test("normalizes missing arguments to an empty object", async () => {
    const { mcp, call } = fakeMcp();
    let seen: unknown;
    defineTool(
      mcp,
      { name: "t", title: "T", description: "d", inputSchema: {} as any },
      async (args) => {
        seen = args;
        return ok("done");
      },
    );

    await call("t", undefined, auth("t-1"));
    expect(seen).toEqual({});
  });
});
