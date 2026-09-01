/**
 * Bridge between the wiki's zod-described tools and the framework's
 * `McpToolDefinition`.
 *
 * The tools were written for the standalone MCP server, whose SDK put zod
 * schemas on the wire via the Standard-Schema JSON-Schema hook and validated
 * arguments with the same hook. Both behaviours are reproduced here 1:1 so
 * the embedded server is indistinguishable from the old process for clients:
 *
 *   - `inputSchema` goes on the wire as the exact JSON Schema the old SDK
 *     produced (`~standard.jsonSchema.input({ target: "draft-2020-12" })`,
 *     wrapped to guarantee `type: "object"`). The framework passes plain
 *     JSON-Schema objects through untouched.
 *   - Arguments are validated with `~standard.validate` before the handler
 *     runs; a failure produces the old SDK's error text ("Input validation
 *     error: Invalid arguments for tool …").
 */

import type { ZodType } from "zod";
import type { McpRequestContext, McpToolDefinition } from "@framework/types";
import { resolveTenantId, type ToolResult } from "../api";
import { withPageUrls } from "../page-url";

export type ToolHandler = (
  args: any,
  ctx: McpRequestContext,
) => Promise<ToolResult>;

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  /** zod object schema of the input (omit = no arguments). */
  inputSchema?: ZodType;
  /** Extra tool metadata (e.g. MCP Apps `ui` linkage). */
  _meta?: Record<string, unknown>;
  /**
   * MCP tool annotations — behaviour hints (`readOnlyHint`,
   * `destructiveHint`, `idempotentHint`, `openWorldHint`) clients use to
   * decide what to show, retry or confirm before they call. Use `READ_ONLY` /
   * `writeAnnotations()` below instead of hand-written objects.
   */
  annotations?: Record<string, unknown>;
  /**
   * Set on tools whose rows are keyed by something that is NOT a page id
   * (collection records, whose columns may even be called "title"). The page
   * links added to every result then follow only explicit `pageId` fields —
   * see `../page-url.ts`.
   */
  opaqueIds?: boolean;
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
export const READ_ONLY: Record<string, unknown> = {
  readOnlyHint: true,
  openWorldHint: false,
};

/**
 * Behaviour hints for a writing tool.
 *
 * @param destructive whether the call may overwrite or remove existing
 *   content/metadata (`false` = purely additive, nothing existing is lost).
 * @param idempotent whether repeating the call with the same arguments leaves
 *   the wiki in the same state (no duplicate pages/records, no doubled text).
 */
export function writeAnnotations(opts: {
  destructive: boolean;
  idempotent: boolean;
}): Record<string, unknown> {
  return {
    readOnlyHint: false,
    destructiveHint: opts.destructive,
    idempotentHint: opts.idempotent,
    openWorldHint: false,
  };
}

/** The wire JSON Schema for a zod schema, exactly as the old SDK built it. */
const wireSchema = (schema: ZodType): Record<string, unknown> => {
  const std = (schema as any)["~standard"];
  const result = std.jsonSchema.input({ target: "draft-2020-12" });
  if (result.type !== undefined && result.type !== "object") {
    throw new Error(
      `MCP tool schemas must describe objects (got type: ${JSON.stringify(result.type)}).`,
    );
  }
  return { type: "object", ...result };
};

const formatIssue = (issue: {
  path?: readonly unknown[];
  message: string;
}): string => {
  if (!issue.path?.length) return issue.message;
  const path = issue.path
    .map((p) => String(typeof p === "object" && p !== null ? (p as any).key : p))
    .join(".");
  return `${path}: ${issue.message}`;
};

export function defineTool(def: ToolDef, handler: ToolHandler): McpToolDefinition {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    ...(def.annotations ? { annotations: def.annotations } : {}),
    ...(def._meta ? { _meta: def._meta } : {}),
    ...(def.inputSchema ? { inputSchema: wireSchema(def.inputSchema) } : {}),
    handler: async (args, ctx) => {
      let parsedArgs = args ?? {};
      if (def.inputSchema) {
        const result = await (def.inputSchema as any)["~standard"].validate(
          parsedArgs,
        );
        if (result.issues && result.issues.length > 0) {
          const detail = result.issues.map(formatIssue).join(", ");
          throw new Error(
            `Input validation error: Invalid arguments for tool ${def.name}: ${detail}`,
          );
        }
        parsedArgs = result.value;
      }
      const toolResult = await handler(parsedArgs, ctx);
      // Every page in the result also carries its link in the wiki.
      let tenantId: string | undefined;
      try {
        tenantId = resolveTenantId(ctx);
      } catch {
        tenantId = undefined; // no organisation bound: nothing to link to
      }
      return withPageUrls(toolResult, tenantId, {
        idsArePageIds: !def.opaqueIds,
      });
    },
  };
}
