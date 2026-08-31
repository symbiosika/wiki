/**
 * Small wrapper around `mcp.registerTool` so every tool has the same handler
 * signature: `(args, authInfo) => ToolResult`. The auth context comes from the
 * transport via `ctx.http.authInfo` (validated in `authenticate()`).
 *
 * SDK detail: without `inputSchema` the server calls the callback with `(ctx)`,
 * WITH `inputSchema` it calls with `(args, ctx)`. We normalize that here.
 */

import type { AuthInfo, ToolAnnotations } from "@modelcontextprotocol/server";
import type { ZodTypeAny } from "zod";
import type { ToolResult } from "../app-api.ts";

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
  /**
   * MCP tool annotations — behaviour hints (`readOnlyHint`,
   * `destructiveHint`, `idempotentHint`, `openWorldHint`) clients use to
   * decide what to show, retry or confirm. Use `READ_ONLY` /
   * `writeAnnotations()` below instead of hand-written objects.
   */
  annotations?: ToolAnnotations;
};

/**
 * Behaviour hints for a tool that only reads: it never changes anything in
 * the wiki, so hosts may run it without a confirmation prompt and re-run it
 * freely.
 *
 * `openWorldHint: false` for every tool of this server: the wiki is a closed,
 * bounded domain (the pages of one organisation), not an open-ended external
 * world like a web search.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

/**
 * Behaviour hints for a writing tool.
 *
 * @param destructive whether the call may overwrite or remove existing
 *   content/metadata (`false` = purely additive, nothing existing is lost).
 * @param idempotent whether repeating the call with the same arguments leaves
 *   the wiki in the same state (no duplicate pages, no doubled text).
 */
export function writeAnnotations(opts: {
  destructive: boolean;
  idempotent: boolean;
}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: opts.destructive,
    idempotentHint: opts.idempotent,
    openWorldHint: false,
  };
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
  if (def.annotations) config.annotations = def.annotations;

  if (def.inputSchema) {
    config.inputSchema = def.inputSchema;
    mcp.registerTool(def.name, config, async (args: any, ctx: any) =>
      handler(args ?? {}, ctx?.http?.authInfo),
    );
  } else {
    mcp.registerTool(def.name, config, async (ctx: any) =>
      handler({}, ctx?.http?.authInfo),
    );
  }
}
