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
import type { ToolResult } from "../api";

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
};

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
      return handler(parsedArgs, ctx);
    },
  };
}
