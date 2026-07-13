import { test, expect } from "bun:test";
import { formatWithLineNumbers } from "./document-agent";

test("formatWithLineNumbers prefixes 1-based, right-padded line numbers", () => {
  const out = formatWithLineNumbers("a\nb\nc");
  expect(out).toBe("   1| a\n   2| b\n   3| c");
});

test("formatWithLineNumbers honours a fromLine offset", () => {
  const out = formatWithLineNumbers("x\ny", 10);
  expect(out).toBe("  10| x\n  11| y");
});
