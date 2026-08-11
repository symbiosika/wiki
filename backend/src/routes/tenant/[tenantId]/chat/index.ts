/**
 * Routes for the "Chat with AI" wiki assistant.
 *
 * A single streaming endpoint that runs an agent over the wiki tools. The
 * agent talks to the model exclusively through OpenRouter (see ../../ai) — the
 * only AI gateway this app uses.
 *
 * The chat has two modes, chosen per request via the `mode` field:
 *   - "read" (default): only the read-only wiki tools are exposed.
 *   - "edit": additionally exposes the write tools (create / edit / delete).
 * The frontend toggles the mode with a switch at the top right of the chat.
 *
 * Streaming is stateless by default (the slide-over panel keeps its history in
 * the browser). The dedicated chat view instead passes a `sessionId`, and then
 * the conversation is persisted per user — see ../../lib/chat-sessions/store
 * and the `/sessions` endpoints below.
 */

import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { HTTPException } from "hono/http-exception";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { describeRoute } from "hono-openapi";
import { resolver, validator } from "hono-openapi";
import * as v from "valibot";
import {
  streamText,
  convertToModelMessages,
  createIdGenerator,
  type UIMessage,
} from "ai";
import { assertOpenRouterConfigured } from "../../../../ai";
import { buildWikiAgentConfig } from "../../../../ai/wiki-agent";
import type { WikiChatMode } from "../../../../ai/tools/wiki";
import {
  getChatAgentConfig,
  setChatAgentConfig,
  MAX_SYSTEM_PROMPT_CHARS,
} from "../../../../lib/chat-config/store";
import {
  listSessions,
  createSession,
  getSessionWithMessages,
  renameSession,
  deleteSession,
  saveMessages,
  DEFAULT_SESSION_LIMIT,
  MAX_TITLE_CHARS,
  type StoredChatMessage,
} from "../../../../lib/chat-sessions/store";

/**
 * Request schema. Messages are AI-SDK UIMessages: their `parts` carry text as
 * well as tool calls/results, so we validate the envelope loosely (each part
 * is an open object with a `type`) and let `convertToModelMessages` interpret
 * it. `mode` selects the tool set.
 */
const chatRequestSchema = v.object({
  messages: v.pipe(
    v.array(
      v.object({
        id: v.optional(v.string()),
        role: v.picklist(["user", "assistant", "system"]),
        parts: v.pipe(
          v.array(v.looseObject({ type: v.string() })),
          v.maxLength(200),
        ),
      }),
    ),
    v.minLength(1),
    v.maxLength(100),
  ),
  mode: v.optional(v.picklist(["read", "edit"])),
  /**
   * When set, the conversation is stored under this session (the dedicated
   * chat view). Unknown or foreign ids are ignored rather than rejected: a
   * missing session must never cost the user their answer.
   */
  sessionId: v.optional(v.string()),
});

export default function defineChatRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const baseRoute = `${API_BASE_PATH}/tenant/:tenantId/chat`;

  /**
   * POST /tenant/:tenantId/chat
   * Stream a wiki-assistant reply over OpenRouter with wiki tools.
   * Body: { messages: UIMessage[]; mode?: "read" | "edit" }
   */
  app.post(
    baseRoute,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Stream the wiki AI assistant (OpenRouter + wiki tools)",
      responses: {
        200: {
          description: "Streaming chat response",
          content: {
            "text/event-stream": {
              schema: resolver(v.any()),
            },
          },
        },
      },
    }),
    validator("param", v.object({ tenantId: v.string() })),
    isTenantMember,
    validator("json", chatRequestSchema),
    async (c) => {
      try {
        assertOpenRouterConfigured();
      } catch {
        throw new HTTPException(500, {
          message: "OpenRouter is not configured (OPENROUTER_API_KEY missing)",
        });
      }

      const { tenantId } = c.req.valid("param");
      const userId = c.get("usersId");
      const { messages, mode: rawMode, sessionId } = c.req.valid("json");
      const mode: WikiChatMode = rawMode === "edit" ? "edit" : "read";
      const sessionCtx = { tenantId, userId };

      try {
        const { systemPrompt: orgSystemPrompt } =
          await getChatAgentConfig(tenantId);

        // Store the question before the answer starts. If the stream never
        // finishes (tab closed, network gone), the user still finds what they
        // asked when they come back to the session.
        if (sessionId) {
          await saveMessages(
            sessionCtx,
            sessionId,
            messages as StoredChatMessage[],
          ).catch((error) =>
            console.error("[Chat] failed to store incoming messages", error),
          );
        }

        const result = streamText({
          ...buildWikiAgentConfig({ tenantId, userId, mode, orgSystemPrompt }),
          messages: await convertToModelMessages(messages as UIMessage[]),
          onError: (error) => {
            console.error(`[Chat] stream error mode=${mode}`, error);
          },
        });

        return result.toUIMessageStreamResponse({
          headers: {
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
          // `originalMessages` puts the stream in persistence mode: the response
          // message gets a stable id and `onFinish` hands back the whole updated
          // conversation, which is exactly what we store.
          ...(sessionId
            ? {
                originalMessages: messages as UIMessage[],
                // Without this the answer reaches `onFinish` with no id (the
                // SDK only assigns one by itself when it continues an existing
                // assistant message) and could not be stored or updated.
                generateMessageId: createIdGenerator({ prefix: "msg" }),
                onFinish: async ({ messages: updated }) => {
                  await saveMessages(
                    sessionCtx,
                    sessionId,
                    updated as StoredChatMessage[],
                  ).catch((error) =>
                    console.error("[Chat] failed to store conversation", error),
                  );
                },
              }
            : {}),
          onError: (error) =>
            error instanceof Error ? error.message : "Streaming failed",
        });
      } catch (error) {
        console.error("Failed to stream chat", error);
        throw new HTTPException(500, {
          message: `Failed to stream chat: ${(error as Error).message}`,
        });
      }
    },
  );

  /**
   * GET /tenant/:tenantId/chat/config
   * Read the organisation's chat-agent config (currently the custom system
   * prompt). Available to every tenant member so the chat panel and the
   * Verwaltung page can show the current value.
   */
  app.get(
    `${baseRoute}/config`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Get the organisation's chat-agent configuration",
      responses: { 200: { description: "The chat-agent configuration" } },
    }),
    validator("param", v.object({ tenantId: v.string() })),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const config = await getChatAgentConfig(tenantId);
      return c.json(config);
    },
  );

  /**
   * PUT /tenant/:tenantId/chat/config
   * Update the organisation's chat-agent config. Org-wide setting; matching the
   * app's other org-managed config it is open to any tenant member.
   * Body: { systemPrompt: string }
   */
  app.put(
    `${baseRoute}/config`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Update the organisation's chat-agent configuration",
      responses: { 200: { description: "The stored chat-agent configuration" } },
    }),
    validator("param", v.object({ tenantId: v.string() })),
    validator(
      "json",
      v.object({
        systemPrompt: v.pipe(
          v.string(),
          v.maxLength(MAX_SYSTEM_PROMPT_CHARS),
        ),
      }),
    ),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const { systemPrompt } = c.req.valid("json");
      const config = await setChatAgentConfig(tenantId, { systemPrompt });
      return c.json(config);
    },
  );

  // ---- chat sessions -------------------------------------------------------
  //
  // Sessions are private to the user who started them. Every handler therefore
  // scopes on `(tenantId, usersId)`, and a session belonging to somebody else
  // is indistinguishable from one that does not exist (404).

  const sessionsRoute = `${baseRoute}/sessions`;
  const sessionCtx = (c: {
    req: { valid: (target: "param") => { tenantId: string } };
    get: (key: "usersId") => string;
  }) => ({
    tenantId: c.req.valid("param").tenantId,
    userId: c.get("usersId"),
  });

  /**
   * GET /tenant/:tenantId/chat/sessions?limit=n
   * The user's conversations, most recently used first.
   */
  app.get(
    sessionsRoute,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "List the user's chat sessions",
      responses: { 200: { description: "The user's chat sessions" } },
    }),
    validator("param", v.object({ tenantId: v.string() })),
    validator(
      "query",
      v.object({
        limit: v.optional(v.pipe(v.string(), v.regex(/^\d{1,3}$/))),
      }),
    ),
    isTenantMember,
    async (c) => {
      const { limit } = c.req.valid("query");
      const sessions = await listSessions(
        sessionCtx(c),
        limit ? Number(limit) : DEFAULT_SESSION_LIMIT,
      );
      return c.json(sessions);
    },
  );

  /**
   * POST /tenant/:tenantId/chat/sessions
   * Start a new conversation. The title is optional — it is derived from the
   * first question once that is stored.
   */
  app.post(
    sessionsRoute,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Create a chat session",
      responses: { 200: { description: "The created chat session" } },
    }),
    validator("param", v.object({ tenantId: v.string() })),
    validator(
      "json",
      v.object({
        title: v.optional(
          v.pipe(v.string(), v.maxLength(MAX_TITLE_CHARS * 4)),
        ),
      }),
    ),
    isTenantMember,
    async (c) => {
      const { title } = c.req.valid("json");
      const session = await createSession(sessionCtx(c), title ?? null);
      return c.json(session);
    },
  );

  /**
   * GET /tenant/:tenantId/chat/sessions/:sessionId
   * One conversation with its full message history.
   */
  app.get(
    `${sessionsRoute}/:sessionId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Get a chat session including its messages",
      responses: { 200: { description: "The chat session and its messages" } },
    }),
    validator(
      "param",
      v.object({ tenantId: v.string(), sessionId: v.pipe(v.string(), v.uuid()) }),
    ),
    isTenantMember,
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const result = await getSessionWithMessages(sessionCtx(c), sessionId);
      if (!result) {
        throw new HTTPException(404, { message: "Chat session not found" });
      }
      return c.json(result);
    },
  );

  /**
   * PUT /tenant/:tenantId/chat/sessions/:sessionId
   * Rename a conversation.
   */
  app.put(
    `${sessionsRoute}/:sessionId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Rename a chat session",
      responses: { 200: { description: "The updated chat session" } },
    }),
    validator(
      "param",
      v.object({ tenantId: v.string(), sessionId: v.pipe(v.string(), v.uuid()) }),
    ),
    validator(
      "json",
      v.object({
        title: v.pipe(v.string(), v.maxLength(MAX_TITLE_CHARS * 4)),
      }),
    ),
    isTenantMember,
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const { title } = c.req.valid("json");
      const session = await renameSession(sessionCtx(c), sessionId, title);
      if (!session) {
        throw new HTTPException(404, { message: "Chat session not found" });
      }
      return c.json(session);
    },
  );

  /**
   * DELETE /tenant/:tenantId/chat/sessions/:sessionId
   * Delete a conversation and its messages.
   */
  app.delete(
    `${sessionsRoute}/:sessionId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["chat"],
      summary: "Delete a chat session",
      responses: { 200: { description: "Deletion result" } },
    }),
    validator(
      "param",
      v.object({ tenantId: v.string(), sessionId: v.pipe(v.string(), v.uuid()) }),
    ),
    isTenantMember,
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const deleted = await deleteSession(sessionCtx(c), sessionId);
      if (!deleted) {
        throw new HTTPException(404, { message: "Chat session not found" });
      }
      return c.json({ success: true });
    },
  );
}
