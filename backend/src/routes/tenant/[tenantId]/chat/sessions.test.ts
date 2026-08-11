import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  createDatabaseClient,
  waitForDbConnection,
  getDb,
} from "@framework/lib/db/db-connection";
import defineChatRoutes from "./index";
import { chatSessions } from "../../../../db/schema";
import { saveMessages } from "../../../../lib/chat-sessions/store";

let app: SymbiosikaFrameworkHonoApp;
let token: string;
let token2: string;

const org = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;
const sessionsUrl = `/tenant/${org}/chat/sessions`;

const cleanup = async () => {
  const db = getDb();
  await db.delete(chatSessions).where(eq(chatSessions.tenantId, org));
  await db.delete(chatSessions).where(eq(chatSessions.tenantId, org2));
};

describe("Chat session routes", () => {
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

  test("creates, lists and reads a session", async () => {
    const created = await testFetcher.post(app, sessionsUrl, token, {});
    expect(created.status).toBe(200);
    const sessionId = created.jsonResponse.id as string;
    expect(sessionId).toBeTruthy();
    expect(created.jsonResponse.title).toBeNull();

    const list = await testFetcher.get(app, sessionsUrl, token);
    expect(list.status).toBe(200);
    expect(list.jsonResponse.some((s: any) => s.id === sessionId)).toBe(true);

    const detail = await testFetcher.get(
      app,
      `${sessionsUrl}/${sessionId}`,
      token,
    );
    expect(detail.status).toBe(200);
    expect(detail.jsonResponse.session.id).toBe(sessionId);
    expect(detail.jsonResponse.messages).toEqual([]);
  });

  test("returns the stored conversation with its derived title", async () => {
    const created = await testFetcher.post(app, sessionsUrl, token, {});
    const sessionId = created.jsonResponse.id as string;

    // the streaming endpoint writes through this same store function
    await saveMessages(
      { tenantId: org, userId: TEST_ORG1_USER_1.id },
      sessionId,
      [
        { id: "q1", role: "user", parts: [{ type: "text", text: "Was gilt?" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "Das steht im Handbuch." }],
        },
      ],
    );

    const detail = await testFetcher.get(
      app,
      `${sessionsUrl}/${sessionId}`,
      token,
    );
    expect(detail.jsonResponse.session.title).toBe("Was gilt?");
    expect(detail.jsonResponse.messages).toHaveLength(2);
  });

  test("renames a session", async () => {
    const created = await testFetcher.post(app, sessionsUrl, token, {});
    const sessionId = created.jsonResponse.id as string;

    const renamed = await testFetcher.put(
      app,
      `${sessionsUrl}/${sessionId}`,
      token,
      { title: "Urlaubsfragen" },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.jsonResponse.title).toBe("Urlaubsfragen");
  });

  test("deletes a session and then reports it as missing", async () => {
    const created = await testFetcher.post(app, sessionsUrl, token, {});
    const sessionId = created.jsonResponse.id as string;

    const deleted = await testFetcher.delete(
      app,
      `${sessionsUrl}/${sessionId}`,
      token,
    );
    expect(deleted.status).toBe(200);

    const detail = await testFetcher.get(
      app,
      `${sessionsUrl}/${sessionId}`,
      token,
    );
    expect(detail.status).toBe(404);
  });

  test("an unknown session id is a 404, not a leak", async () => {
    const res = await testFetcher.get(
      app,
      `${sessionsUrl}/00000000-0000-4000-8000-000000000000`,
      token,
    );
    expect(res.status).toBe(404);
  });

  test("a member of another organisation cannot list sessions", async () => {
    const res = await testFetcher.get(app, sessionsUrl, token2);
    expect(res.status).toBe(403);
  });

  test("a member of another organisation cannot read a session", async () => {
    const created = await testFetcher.post(app, sessionsUrl, token, {});
    const sessionId = created.jsonResponse.id as string;

    const res = await testFetcher.get(
      app,
      `${sessionsUrl}/${sessionId}`,
      token2,
    );
    expect(res.status).toBe(403);

    // …and cannot reach it through their own organisation either
    const viaOwnOrg = await testFetcher.get(
      app,
      `/tenant/${org2}/chat/sessions/${sessionId}`,
      token2,
    );
    expect(viaOwnOrg.status).toBe(404);
  });
});
