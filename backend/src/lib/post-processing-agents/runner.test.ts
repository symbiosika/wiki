import { describe, test, expect, beforeAll } from "bun:test";

// The runner reads POSTPROCESSING_DEV_STUB at import time, so set it first.
process.env.POSTPROCESSING_DEV_STUB = "true";

let runPostProcessingAgent: typeof import("./runner").runPostProcessingAgent;

describe("runPostProcessingAgent (dev stub)", () => {
  beforeAll(async () => {
    ({ runPostProcessingAgent } = await import("./runner"));
  });

  test("prepends a marker deterministically without calling an LLM", async () => {
    const res = await runPostProcessingAgent({
      text: "hello world",
      title: "Doc",
      instructions: "clean this up",
    });
    expect(res.aborted).toBe(false);
    expect(res.text).toContain("hello world");
    expect(res.text).toContain("dev stub");
    expect(res.editCount).toBe(1);
    expect(res.title).toBe("Doc");
  });

  test("is idempotent — does not stack markers", async () => {
    const once = await runPostProcessingAgent({
      text: "content",
      instructions: "x",
    });
    const twice = await runPostProcessingAgent({
      text: once.text,
      instructions: "x",
    });
    expect(twice.text).toBe(once.text);
  });
});
