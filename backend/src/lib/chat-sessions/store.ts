/**
 * Chat sessions — persistence for the dedicated chat view.
 *
 * A session is one conversation, owned by one user inside one organisation.
 * Everything here is scoped by `(tenantId, userId)`: a session can only ever be
 * read, written or deleted by the person who started it, in the organisation it
 * was started in. Callers never pass a session id alone.
 *
 * Messages are stored in the AI-SDK `UIMessage` shape (`role` + `parts`), so a
 * reopened conversation both renders like the live stream did and can be handed
 * straight back to the model. Saving is an upsert keyed by the client-generated
 * message id: the frontend resends the whole history on every turn, so a turn
 * rewrites what changed instead of appending duplicates.
 */
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import {
  chatSessions,
  chatMessages,
  type ChatSessionSelect,
  type ChatMessageSelect,
} from "../../db/schema";

/** Longest title we derive from a first question. */
export const MAX_TITLE_CHARS = 120;

/** Longest single string we keep inside a stored message part. */
const MAX_PART_TEXT_CHARS = 20_000;

/** Hard cap on stored messages per session (oldest are dropped on save). */
const MAX_MESSAGES_PER_SESSION = 400;

/** Default page size of the session list. */
export const DEFAULT_SESSION_LIMIT = 30;

export interface ChatSessionContext {
  tenantId: string;
  userId: string;
}

/** A stored message in the shape the frontend / the AI SDK expects. */
export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: unknown[];
}

/** Session as returned by the API (list and detail). */
export interface ChatSessionDto {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  /** first words of the opening question — the list preview */
  preview: string | null;
}

const nowIso = () => new Date().toISOString();

const toDto = (
  session: ChatSessionSelect,
  preview: string | null = null,
): ChatSessionDto => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  preview,
});

/** Collapse whitespace and clip — used for both titles and list previews. */
export const shorten = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

/** Concatenated text of a UIMessage's text parts (ignores tool calls). */
const messageText = (message: StoredChatMessage): string =>
  (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join(" ");

/**
 * Clip long strings inside a message's parts before storing it.
 *
 * Tool results can be very large (a whole wiki page, a search result set). They
 * are worth keeping — the reopened conversation shows them — but not at any
 * size, so every string in the structure is capped. The shape is preserved so
 * the AI SDK can still parse what it gets back.
 */
const clipDeep = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") {
    return value.length <= MAX_PART_TEXT_CHARS
      ? value
      : `${value.slice(0, MAX_PART_TEXT_CHARS)}…[gekürzt]`;
  }
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map((item) => clipDeep(item, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        clipDeep(item, depth + 1),
      ]),
    );
  }
  return value;
};

// ---- sessions ---------------------------------------------------------------

/**
 * List a user's sessions, newest activity first. The preview is the opening
 * question, so a session is recognisable before it has a title.
 */
export const listSessions = async (
  ctx: ChatSessionContext,
  limit: number = DEFAULT_SESSION_LIMIT,
): Promise<ChatSessionDto[]> => {
  const db = getDb();
  const sessions = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
      ),
    )
    .orderBy(desc(chatSessions.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  if (sessions.length === 0) return [];

  // One extra query for the previews instead of N: pull the first user message
  // of every listed session and index it by session.
  const firstMessages = await db
    .select()
    .from(chatMessages)
    .where(
      inArray(
        chatMessages.sessionId,
        sessions.map((session) => session.id),
      ),
    )
    .orderBy(asc(chatMessages.position));

  const previews = new Map<string, string>();
  for (const row of firstMessages) {
    if (row.role !== "user" || previews.has(row.sessionId)) continue;
    const text = messageText({
      id: row.messageId,
      role: "user",
      parts: (row.parts as unknown[]) ?? [],
    });
    if (text) previews.set(row.sessionId, shorten(text, MAX_TITLE_CHARS));
  }

  return sessions.map((session) =>
    toDto(session, previews.get(session.id) ?? null),
  );
};

/** Create an empty session. The title arrives with the first question. */
export const createSession = async (
  ctx: ChatSessionContext,
  title?: string | null,
): Promise<ChatSessionDto> => {
  const rows = await getDb()
    .insert(chatSessions)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      title: title ? shorten(title, MAX_TITLE_CHARS) : null,
    })
    .returning();

  const session = rows[0];
  if (!session) throw new Error("Failed to create chat session");
  return toDto(session);
};

/** Fetch one session, or null when it does not belong to this user. */
export const getSession = async (
  ctx: ChatSessionContext,
  sessionId: string,
): Promise<ChatSessionSelect | null> => {
  const rows = await getDb()
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.tenantId, ctx.tenantId),
        eq(chatSessions.userId, ctx.userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

/** A session plus its full message history, ordered. */
export const getSessionWithMessages = async (
  ctx: ChatSessionContext,
  sessionId: string,
): Promise<{ session: ChatSessionDto; messages: StoredChatMessage[] } | null> => {
  const session = await getSession(ctx, sessionId);
  if (!session) return null;

  const rows = await getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.position));

  const messages = rows.map(toStoredMessage);
  const firstUser = messages.find((message) => message.role === "user");
  const preview = firstUser
    ? shorten(messageText(firstUser), MAX_TITLE_CHARS) || null
    : null;

  return { session: toDto(session, preview), messages };
};

const toStoredMessage = (row: ChatMessageSelect): StoredChatMessage => ({
  id: row.messageId,
  role: row.role as StoredChatMessage["role"],
  parts: (row.parts as unknown[]) ?? [],
});

/** Rename a session. Returns null when it does not belong to this user. */
export const renameSession = async (
  ctx: ChatSessionContext,
  sessionId: string,
  title: string,
): Promise<ChatSessionDto | null> => {
  const session = await getSession(ctx, sessionId);
  if (!session) return null;

  const rows = await getDb()
    .update(chatSessions)
    .set({ title: shorten(title, MAX_TITLE_CHARS) || null, updatedAt: nowIso() })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  const updated = rows[0];
  return updated ? toDto(updated) : null;
};

/** Delete a session and (via cascade) its messages. */
export const deleteSession = async (
  ctx: ChatSessionContext,
  sessionId: string,
): Promise<boolean> => {
  const session = await getSession(ctx, sessionId);
  if (!session) return false;
  await getDb().delete(chatSessions).where(eq(chatSessions.id, sessionId));
  return true;
};

// ---- messages ---------------------------------------------------------------

/**
 * Persist the conversation as it currently stands.
 *
 * The frontend always sends the full history, so this writes the list as a
 * whole: every message is upserted at its position, and rows that are no longer
 * part of the conversation are removed. That keeps a retried or aborted turn
 * from leaving orphans behind.
 *
 * Also derives the session title from the first question the first time one is
 * saved, and bumps `updatedAt` so the session list stays ordered by activity.
 */
export const saveMessages = async (
  ctx: ChatSessionContext,
  sessionId: string,
  messages: StoredChatMessage[],
): Promise<void> => {
  const session = await getSession(ctx, sessionId);
  if (!session) return;

  // keep only the tail when a conversation grows very long
  const kept = messages.slice(-MAX_MESSAGES_PER_SESSION);
  const db = getDb();

  const messageIdAt = (message: StoredChatMessage, index: number): string =>
    // A message without an id would be dropped, and dropping the answer is the
    // one thing this must never do — fall back to its position.
    message.id || `auto-${index}`;

  for (const [index, message] of kept.entries()) {
    if (!message?.role) continue;
    const parts = clipDeep(message.parts ?? []) as unknown[];
    await db
      .insert(chatMessages)
      .values({
        sessionId,
        tenantId: ctx.tenantId,
        messageId: messageIdAt(message, index),
        role: message.role,
        parts,
        position: index,
      })
      .onConflictDoUpdate({
        target: [chatMessages.sessionId, chatMessages.messageId],
        set: { parts, position: index, role: message.role },
      });
  }

  const keptIds = kept.map(messageIdAt);
  await db
    .delete(chatMessages)
    .where(
      keptIds.length
        ? and(
            eq(chatMessages.sessionId, sessionId),
            notInArray(chatMessages.messageId, keptIds),
          )
        : eq(chatMessages.sessionId, sessionId),
    );

  const firstUser = kept.find((message) => message.role === "user");
  const derivedTitle =
    !session.title && firstUser
      ? shorten(messageText(firstUser), MAX_TITLE_CHARS) || null
      : null;

  await db
    .update(chatSessions)
    .set({
      updatedAt: nowIso(),
      ...(derivedTitle ? { title: derivedTitle } : {}),
    })
    .where(eq(chatSessions.id, sessionId));
};
