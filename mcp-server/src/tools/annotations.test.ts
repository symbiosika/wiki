/**
 * Guards the MCP tool annotations: every tool must declare behaviour hints,
 * every write tool must declare the right ones, and everything else must be
 * marked read-only. A new tool without annotations fails this test.
 */

import { describe, test, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { registerAllTools } from "./index.ts";

/** The only tools that change the wiki, with their expected hints. */
const WRITE_TOOLS: Record<string, { destructive: boolean; idempotent: boolean }> = {
  create_page: { destructive: false, idempotent: false },
  append_to_page: { destructive: false, idempotent: false },
  update_page: { destructive: true, idempotent: true },
  edit_page_content: { destructive: true, idempotent: false },
  delete_page: { destructive: true, idempotent: true },
};

const mcp = new McpServer({ name: "t", version: "0" }, {});
registerAllTools(mcp);
const registered = (mcp as any)._registeredTools as Record<
  string,
  { annotations?: ToolAnnotations }
>;
const names = Object.keys(registered);

describe("tool annotations", () => {
  test("all tools are registered with annotations", () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(registered[name]!.annotations, name).toBeDefined();
    }
  });

  test("the wiki is a closed world for every tool", () => {
    for (const name of names) {
      expect(registered[name]!.annotations?.openWorldHint, name).toBe(false);
    }
  });

  test("write tools carry the expected destructive / idempotent hints", () => {
    for (const [name, expected] of Object.entries(WRITE_TOOLS)) {
      const annotations = registered[name]?.annotations;
      expect(annotations, name).toBeDefined();
      expect(annotations!.readOnlyHint, name).toBe(false);
      expect(annotations!.destructiveHint, name).toBe(expected.destructive);
      expect(annotations!.idempotentHint, name).toBe(expected.idempotent);
    }
  });

  test("every other tool is annotated read-only", () => {
    for (const name of names) {
      if (name in WRITE_TOOLS) continue;
      const annotations = registered[name]!.annotations!;
      expect(annotations.readOnlyHint, name).toBe(true);
      // hints that only make sense for writing tools stay unset
      expect(annotations.destructiveHint, name).toBeUndefined();
      expect(annotations.idempotentHint, name).toBeUndefined();
    }
  });
});
