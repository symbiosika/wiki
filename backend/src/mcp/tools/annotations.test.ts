/**
 * Guards the MCP tool annotations: every tool must declare behaviour hints,
 * every write tool must declare the right ones, and everything else must be
 * marked read-only. A new tool without annotations fails this test.
 */

import { describe, test, expect } from "bun:test";
import { identityTools } from "./identity";
import { discoveryTools } from "./discovery";
import { readTools } from "./read";
import { writeTools } from "./write";
import { collectionTools } from "./collections";
import { appUiTools } from "./app-ui";

/** The only tools that change the wiki, with their expected hints. */
const WRITE_TOOLS: Record<string, { destructive: boolean; idempotent: boolean }> = {
  create_page: { destructive: false, idempotent: false },
  append_to_page: { destructive: false, idempotent: false },
  update_page: { destructive: true, idempotent: true },
  edit_page_content: { destructive: true, idempotent: false },
  delete_page: { destructive: true, idempotent: true },
  create_collection_record: { destructive: false, idempotent: false },
  update_collection_record: { destructive: true, idempotent: true },
  delete_collection_record: { destructive: true, idempotent: true },
};

const tools = [
  ...identityTools,
  ...discoveryTools,
  ...readTools,
  ...writeTools,
  ...collectionTools,
  ...appUiTools,
];

describe("tool annotations", () => {
  test("all tools are registered with annotations", () => {
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });

  test("the wiki is a closed world for every tool", () => {
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  test("write tools carry the expected destructive / idempotent hints", () => {
    for (const [name, expected] of Object.entries(WRITE_TOOLS)) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const annotations = tool!.annotations!;
      expect(annotations.readOnlyHint, name).toBe(false);
      expect(annotations.destructiveHint, name).toBe(expected.destructive);
      expect(annotations.idempotentHint, name).toBe(expected.idempotent);
    }
  });

  test("every other tool is annotated read-only", () => {
    for (const tool of tools) {
      if (tool.name in WRITE_TOOLS) continue;
      const annotations = tool.annotations!;
      expect(annotations.readOnlyHint, tool.name).toBe(true);
      // hints that only make sense for writing tools stay unset
      expect(annotations.destructiveHint, tool.name).toBeUndefined();
      expect(annotations.idempotentHint, tool.name).toBeUndefined();
    }
  });
});
