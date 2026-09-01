import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import {
  createDatabaseClient,
  waitForDbConnection,
  getDb,
} from "@framework/lib/db/db-connection";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { chatSessions } from "../../db/schema";
import {
  listSessions,
  createSession,
  getSession,
  getSessionWithMessages,
  renameSession,
  deleteSession,
  saveMessages,
  shorten,
  type StoredChatMessage,
} from "./store";

const org = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const ctxA = { tenantId: org, userId: USER_A };
const ctxB = { tenantId: org, userId: USER_B };

const userMessage = (id: string, text: string): StoredChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistantMessage = (id: string, text: string): StoredChatMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

const cleanup = async () => {
  const db = getDb();
  await db.delete(chatSessions).where(eq(chatSessions.tenantId, org));
  await db.delete(chatSessions).where(eq(chatSessions.tenantId, org2));
};

describe("Chat sessions store", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    await initTests();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  test("creates an empty session without a title", async () => {
    const session = await createSession(ctxA);
    expect(session.id).toBeTruthy();
    expect(session.title).toBeNull();

    const stored = await getSession(ctxA, session.id);
    expect(stored?.userId).toBe(USER_A);
    expect(stored?.tenantId).toBe(org);
  });

  test("stores messages and derives the title from the first question", async () => {
    const session = await createSession(ctxA);

    await saveMessages(ctxA, session.id, [
      userMessage("m1", "Wie beantrage ich Urlaub?"),
      assistantMessage("m2", "Über das Formular im Handbuch."),
    ]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.session.title).toBe("Wie beantrage ich Urlaub?");
    expect(loaded!.session.preview).toBe("Wie beantrage ich Urlaub?");
    expect(loaded!.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(loaded!.messages[1]!.role).toBe("assistant");
  });

  test("a derived title is not overwritten by later turns", async () => {
    const session = await createSession(ctxA);
    await saveMessages(ctxA, session.id, [userMessage("a1", "Erste Frage")]);
    await saveMessages(ctxA, session.id, [
      userMessage("a1", "Erste Frage"),
      assistantMessage("a2", "Antwort"),
      userMessage("a3", "Zweite Frage"),
    ]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.session.title).toBe("Erste Frage");
    expect(loaded!.messages).toHaveLength(3);
  });

  test("saving is an upsert: resending the history creates no duplicates", async () => {
    const session = await createSession(ctxA);

    await saveMessages(ctxA, session.id, [userMessage("u1", "Frage")]);
    // the streaming endpoint saves twice per turn (before and after the answer)
    await saveMessages(ctxA, session.id, [
      userMessage("u1", "Frage"),
      assistantMessage("u2", "Teilantwort"),
    ]);
    await saveMessages(ctxA, session.id, [
      userMessage("u1", "Frage"),
      assistantMessage("u2", "Vollständige Antwort"),
    ]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[1]!.parts).toEqual([
      { type: "text", text: "Vollständige Antwort" },
    ]);
  });

  test("messages dropped from the history are removed", async () => {
    const session = await createSession(ctxA);
    await saveMessages(ctxA, session.id, [
      userMessage("d1", "Frage"),
      assistantMessage("d2", "Antwort"),
    ]);
    await saveMessages(ctxA, session.id, [userMessage("d1", "Frage")]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.messages.map((m) => m.id)).toEqual(["d1"]);
  });

  test("tool-call parts survive a round trip", async () => {
    const session = await createSession(ctxA);
    const toolMessage: StoredChatMessage = {
      id: "t1",
      role: "assistant",
      parts: [
        {
          type: "tool-search_wiki",
          state: "output-available",
          input: { query: "Urlaub" },
          output: { pages: [{ id: "p1", title: "Urlaubsregelung" }] },
        },
        { type: "text", text: "Siehe Urlaubsregelung." },
      ],
    };

    await saveMessages(ctxA, session.id, [
      userMessage("t0", "Urlaub?"),
      toolMessage,
    ]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.messages[1]!.parts).toEqual(toolMessage.parts);
  });

  test("very long strings inside parts are clipped", async () => {
    const session = await createSession(ctxA);
    const huge = "x".repeat(30_000);
    await saveMessages(ctxA, session.id, [
      userMessage("l0", "Frage"),
      {
        id: "l1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_wiki_page",
            state: "output-available",
            output: { content: huge },
          },
        ],
      },
    ]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    const output = (loaded!.messages[1]!.parts[0] as { output: { content: string } })
      .output.content;
    expect(output.length).toBeLessThan(huge.length);
    expect(output.endsWith("…[gekürzt]")).toBe(true);
  });

  test("an answer without an id is still stored", async () => {
    const session = await createSession(ctxA);
    await saveMessages(ctxA, session.id, [
      userMessage("n1", "Frage"),
      {
        id: "",
        role: "assistant",
        parts: [{ type: "text", text: "Antwort ohne id" }],
      },
    ]);

    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[1]!.parts).toEqual([
      { type: "text", text: "Antwort ohne id" },
    ]);
  });

  test("lists the user's sessions, most recent activity first", async () => {
    await cleanup();
    const first = await createSession(ctxA);
    await saveMessages(ctxA, first.id, [userMessage("s1", "Ältere Frage")]);
    const second = await createSession(ctxA);
    await saveMessages(ctxA, second.id, [userMessage("s2", "Neuere Frage")]);

    const sessions = await listSessions(ctxA);
    expect(sessions.map((s) => s.id)).toEqual([second.id, first.id]);
    expect(sessions[0]!.preview).toBe("Neuere Frage");
  });

  test("sessions are private to their owner", async () => {
    const session = await createSession(ctxA);
    await saveMessages(ctxA, session.id, [userMessage("p1", "Privat")]);

    expect(await getSession(ctxB, session.id)).toBeNull();
    expect(await getSessionWithMessages(ctxB, session.id)).toBeNull();
    expect(await renameSession(ctxB, session.id, "Geklaut")).toBeNull();
    expect(await deleteSession(ctxB, session.id)).toBe(false);

    // the foreign write must not have touched anything
    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.session.title).toBe("Privat");

    const foreignList = await listSessions(ctxB);
    expect(foreignList.some((s) => s.id === session.id)).toBe(false);
  });

  test("sessions are scoped to the organisation", async () => {
    const session = await createSession(ctxA);
    const otherOrgCtx = { tenantId: org2, userId: USER_A };
    expect(await getSession(otherOrgCtx, session.id)).toBeNull();
    expect(await listSessions(otherOrgCtx)).toHaveLength(0);
  });

  test("a foreign session cannot be written to", async () => {
    const session = await createSession(ctxA);
    await saveMessages(ctxB, session.id, [userMessage("x1", "Fremd")]);
    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded!.messages).toHaveLength(0);
  });

  test("renames and deletes a session", async () => {
    const session = await createSession(ctxA);
    await saveMessages(ctxA, session.id, [userMessage("r1", "Frage")]);

    const renamed = await renameSession(ctxA, session.id, "  Mein  Thema  ");
    expect(renamed?.title).toBe("Mein Thema");

    expect(await deleteSession(ctxA, session.id)).toBe(true);
    expect(await getSession(ctxA, session.id)).toBeNull();
    // deleting twice is not an error, it is a miss
    expect(await deleteSession(ctxA, session.id)).toBe(false);
  });

  test("shorten collapses whitespace and clips with an ellipsis", () => {
    expect(shorten("  a   b \n c ", 100)).toBe("a b c");
    expect(shorten("abcdefghij", 5)).toBe("abcd…");
  });
});
