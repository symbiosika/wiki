import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  createDatabaseClient,
  waitForDbConnection,
} from "@framework/lib/db/db-connection";
import { deleteOrganisationSpecificData } from "@framework/lib/specific-data";
import defineChatRoutes from "./index";
import { CHAT_AGENT_CONFIG_KEY } from "../../../../lib/chat-config/store";

let app: SymbiosikaFrameworkHonoApp;
let token: string;
let token2: string;

const org = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;
const configUrl = `/tenant/${org}/chat/config`;

const cleanup = async () => {
  await deleteOrganisationSpecificData(org, CHAT_AGENT_CONFIG_KEY);
  await deleteOrganisationSpecificData(org2, CHAT_AGENT_CONFIG_KEY);
};

describe("Chat-agent config routes", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    const t = await initTests();
    token = t.user1Token;
    token2 = t.user2Token;
    app = new Hono();
    defineChatRoutes(app);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  test("returns an empty prompt when nothing is stored yet", async () => {
    const res = await testFetcher.get(app, configUrl, token);
    expect(res.status).toBe(200);
    expect(res.jsonResponse.systemPrompt).toBe("");
  });

  test("upserts and reads back the org system prompt", async () => {
    const prompt = "Always answer formally and cite the handbook page.";

    const put = await testFetcher.put(app, configUrl, token, {
      systemPrompt: prompt,
    });
    expect(put.status).toBe(200);
    expect(put.jsonResponse.systemPrompt).toBe(prompt);

    const get = await testFetcher.get(app, configUrl, token);
    expect(get.status).toBe(200);
    expect(get.jsonResponse.systemPrompt).toBe(prompt);

    // update again (exercises the update branch of the upsert)
    const updated = "New rules.";
    const put2 = await testFetcher.put(app, configUrl, token, {
      systemPrompt: updated,
    });
    expect(put2.status).toBe(200);
    expect(put2.jsonResponse.systemPrompt).toBe(updated);

    const get2 = await testFetcher.get(app, configUrl, token);
    expect(get2.jsonResponse.systemPrompt).toBe(updated);
  });

  test("rejects a prompt over the character cap", async () => {
    const res = await testFetcher.put(app, configUrl, token, {
      systemPrompt: "x".repeat(8_001),
    });
    expect(res.status).toBe(400);
  });

  test("config is org-scoped: a foreign member cannot read it", async () => {
    const res = await testFetcher.get(app, configUrl, token2);
    expect(res.status).toBe(403);
  });

  test("each organisation keeps its own prompt", async () => {
    await testFetcher.put(app, `/tenant/${org}/chat/config`, token, {
      systemPrompt: "org1 prompt",
    });
    await testFetcher.put(app, `/tenant/${org2}/chat/config`, token2, {
      systemPrompt: "org2 prompt",
    });

    const a = await testFetcher.get(app, `/tenant/${org}/chat/config`, token);
    const b = await testFetcher.get(app, `/tenant/${org2}/chat/config`, token2);
    expect(a.jsonResponse.systemPrompt).toBe("org1 prompt");
    expect(b.jsonResponse.systemPrompt).toBe("org2 prompt");
  });
});
