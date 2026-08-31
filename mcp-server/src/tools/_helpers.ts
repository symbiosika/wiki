/**
 * Small wrapper around `mcp.registerTool` so every tool has the same handler
 * signature: `(args, authInfo) => ToolResult`. The auth context comes from the
 * transport via `ctx.http.authInfo` (validated in `authenticate()`).
 *
 * SDK detail: without `inputSchema` the server calls the callback with `(ctx)`,
 * WITH `inputSchema` it calls with `(args, ctx)`. We normalize that here.
 *
 * This is also the one place where EVERY tool result gets its page links: the
 * result is passed through `withPageUrls()`, which adds the wiki URL next to
 * every page identity in it (see `../page-url.ts`).
 */

import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ZodTypeAny } from "zod";
import { resolveTenantId, type ToolResult } from "../app-api.ts";
import { withPageUrls } from "../page-url.ts";

export type ToolHandler = (
  args: any,
  authInfo: AuthInfo | undefined,
) => Promise<ToolResult>;

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  /** zod object schema of the input (omit = no arguments). */
  inputSchema?: ZodTypeAny;
  /** Extra tool metadata (e.g. MCP Apps `ui` linkage). */
  _meta?: Record<string, unknown>;
};

/** Run a tool handler and enrich its result with page URLs. */
async function runTool(
  handler: ToolHandler,
  args: any,
  authInfo: AuthInfo | undefined,
): Promise<ToolResult> {
  const result = await handler(args ?? {}, authInfo);
  let tenantId: string | undefined;
  try {
    tenantId = resolveTenantId(authInfo);
  } catch {
    tenantId = undefined; // no organisation bound: nothing to link to
  }
  return withPageUrls(result, tenantId);
}

export function defineTool(
  mcp: any,
  def: ToolDef,
  handler: ToolHandler,
): void {
  const config: Record<string, unknown> = {
    title: def.title,
    description: def.description,
  };
  if (def._meta) config._meta = def._meta;

  if (def.inputSchema) {
    config.inputSchema = def.inputSchema;
    mcp.registerTool(def.name, config, async (args: any, ctx: any) =>
      runTool(handler, args, ctx?.http?.authInfo),
    );
  } else {
    mcp.registerTool(def.name, config, async (ctx: any) =>
      runTool(handler, {}, ctx?.http?.authInfo),
    );
  }
}
