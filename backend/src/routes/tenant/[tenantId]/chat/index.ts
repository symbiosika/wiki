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
  stepCountIs,
  type UIMessage,
} from "ai";
import { getModel, assertOpenRouterConfigured } from "../../../../ai";
import {
  createWikiChatTools,
  buildWikiChatSystemPrompt,
  type WikiChatMode,
} from "../../../../ai/tools/wiki";
import {
  getChatAgentConfig,
  setChatAgentConfig,
  MAX_SYSTEM_PROMPT_CHARS,
} from "../../../../lib/chat-config/store";

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
      const { messages, mode: rawMode } = c.req.valid("json");
      const mode: WikiChatMode = rawMode === "edit" ? "edit" : "read";

      try {
        const tools = createWikiChatTools({ tenantId, userId }, mode);
        const { systemPrompt: orgSystemPrompt } =
          await getChatAgentConfig(tenantId);
        const system = buildWikiChatSystemPrompt(mode, orgSystemPrompt);

        const result = streamText({
          model: getModel(),
          system,
          tools,
          stopWhen: stepCountIs(10),
          maxOutputTokens: 8192,
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
}
