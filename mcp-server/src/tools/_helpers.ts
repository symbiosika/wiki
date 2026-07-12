/**
 * Small wrapper around `mcp.registerTool` so every tool has the same handler
 * signature: `(args, authInfo) => ToolResult`. The auth context comes from the
 * transport via `ctx.http.authInfo` (validated in `authenticate()`).
 *
 * SDK detail: without `inputSchema` the server calls the callback with `(ctx)`,
 * WITH `inputSchema` it calls with `(args, ctx)`. We normalize that here.
 */

import type { AuthInfo } from "@modelcontextprotocol/server";
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
};

export function defineTool(
  mcp: any,
  def: ToolDef,
  handler: ToolHandler,
): void {
  const config: Record<string, unknown> = {
    title: def.title,
    description: def.description,
  };

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
