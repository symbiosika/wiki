/**
 * End-to-end test of the chat-agent MCP tools: an agent reads and changes the
 * organisation's custom system prompt through the embedded MCP server and the
 * REAL /chat/config routes, DB included.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { defineMcpRoutes } from "@framework/lib/mcp";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { getChatAgentConfig } from "../../lib/chat-config/store";

let app: Hono;
let token: string;

const org1 = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return ((await res.json()) as any).result;
};

describe("chat-agent MCP tools", () => {
  beforeAll(async () => {
    token = (await initTests()).user1Token;
    process.env.WIKI_TENANT_ID = org1;

    const { wikiMcpServer } = await import("../index");
    const defineChatRoutes = (
      await import("../../routes/tenant/[tenantId]/chat")
    ).default;

    app = new Hono();
    defineMcpRoutes(app as any, [wikiMcpServer]);
    const api = new Hono() as unknown as SymbiosikaFrameworkHonoApp;
    defineChatRoutes(api, "");
    app.route("/api/v1", api as unknown as Hono);
  });

  afterAll(() => {
    delete process.env.WIKI_TENANT_ID;
  });

  test("reads, replaces and clears the org's system prompt", async () => {
    const org2Before = await getChatAgentConfig(org2);

    const prompt = "Antworte immer auf Deutsch und duze die Nutzer.";
    const updated = await callTool("update_chat_agent_config", {
      systemPrompt: prompt,
    });
    expect(updated.isError).toBeUndefined();
    expect(updated.structuredContent.systemPrompt).toBe(prompt);

    const read = await callTool("get_chat_agent_config");
    expect(read.isError).toBeUndefined();
    expect(read.structuredContent.systemPrompt).toBe(prompt);

    // stored for the token's organisation only
    expect((await getChatAgentConfig(org1)).systemPrompt).toBe(prompt);
    expect(await getChatAgentConfig(org2)).toEqual(org2Before);

    const cleared = await callTool("update_chat_agent_config", {
      systemPrompt: "",
    });
    expect(cleared.structuredContent.systemPrompt).toBe("");
    expect(
      (await callTool("get_chat_agent_config")).structuredContent.systemPrompt,
    ).toBe("");
  });

  test("rejects a prompt over the character cap", async () => {
    const res = await callTool("update_chat_agent_config", {
      systemPrompt: "x".repeat(25_001),
    });
    expect(res.isError).toBe(true);
  });
});
