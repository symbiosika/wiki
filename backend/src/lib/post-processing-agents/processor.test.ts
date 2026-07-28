import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// The runner reads POSTPROCESSING_DEV_STUB at import time.
process.env.POSTPROCESSING_DEV_STUB = "true";

import {
  createDatabaseClient,
  waitForDbConnection,
  getDb,
} from "@framework/lib/db/db-connection";
import {
  applyPostProcessors,
  registerPostProcessorResolver,
} from "@framework/index";
import { eq } from "drizzle-orm";
import { initTests, TEST_ORGANISATION_1, TEST_ORGANISATION_2 } from "@framework/test/init.test";
import { postProcessingAgents } from "../../db/schema";
import { createAgent } from "./store";
import { agentPostProcessorResolver, agentProcessorName } from "./processor";

const org = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;

let agentId: string;

const input = (tenantId: string, text = "hello world") => ({
  text,
  title: "Doc",
  source: { type: "file" as const, includesImages: false },
  context: { tenantId },
});

describe("agent post-processor bridge", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    await initTests();
    await getDb()
      .delete(postProcessingAgents)
      .where(eq(postProcessingAgents.tenantId, org));

    const agent = await createAgent(
      { tenantId: org },
      { name: "Bridge test", prompt: "clean it up" },
    );
    agentId = agent.id;
    registerPostProcessorResolver(agentPostProcessorResolver);
  });

  afterAll(() => {
    getDb()
      .delete(postProcessingAgents)
      .where(eq(postProcessingAgents.tenantId, org))
      .then(() => {});
  });

  test("runs the agent and records postProcessing meta", async () => {
    const result = await applyPostProcessors(input(org), [
      agentProcessorName(agentId),
    ]);
    expect(result.text).toContain("hello world");
    expect(result.text).toContain("dev stub");
    const pp = (result.meta as any).postProcessing;
    expect(pp.agentId).toBe(agentId);
    expect(pp.agentName).toBe("Bridge test");
    expect(pp.aborted).toBe(false);
  });

  test("omits pages (page mapping invalidated by an agentic rewrite)", async () => {
    const result = await applyPostProcessors(
      { ...input(org), pages: [{ page: 1, text: "hello world" }] },
      [agentProcessorName(agentId)],
    );
    expect(result.pages).toBeUndefined();
  });

  test("a foreign tenant cannot run the agent (tenant boundary throws)", async () => {
    let threw = false;
    try {
      await applyPostProcessors(input(org2), [agentProcessorName(agentId)]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("skips oversized input, preserves text + page mapping, records skipped meta", async () => {
    const prev = process.env.POSTPROCESSING_MAX_INPUT_TOKENS;
    process.env.POSTPROCESSING_MAX_INPUT_TOKENS = "1"; // ~4 chars
    try {
      const result = await applyPostProcessors(
        {
          ...input(org, "this text is well over four characters"),
          pages: [{ page: 1, text: "this text is well over four characters" }],
        },
        [agentProcessorName(agentId)],
      );
      // unchanged text (no dev-stub marker) and page mapping preserved
      expect(result.text).toBe("this text is well over four characters");
      expect(result.pages).toEqual([
        { page: 1, text: "this text is well over four characters" },
      ]);
      expect((result.meta as any).postProcessing.skipped).toBe("too_large");
    } finally {
      process.env.POSTPROCESSING_MAX_INPUT_TOKENS = prev;
    }
  });

  test("a disabled agent fails cleanly (throws)", async () => {
    const disabled = await createAgent(
      { tenantId: org },
      { name: "Disabled one", prompt: "x", enabled: false },
    );
    let threw = false;
    try {
      await applyPostProcessors(input(org), [agentProcessorName(disabled.id)]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
