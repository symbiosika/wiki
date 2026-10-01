/**
 * Chat-agent tools: read and change the organisation's custom system prompt
 * of the wiki's own chat assistant.
 *
 *   - get_chat_agent_config    : the current custom prompt (empty = none)
 *   - update_chat_agent_config : replace it (empty string clears it)
 *
 * The custom prompt is appended to the built-in wiki-assistant prompt and
 * steers tone, focus and house rules of the in-app chat (and of AI test
 * runs, which examine that same agent). It is one org-wide value per tenant —
 * the same setting as Verwaltung → Chat-Agent in the app. Everything goes
 * through the app's `/chat/config` routes, so tenant scoping and the route
 * checks are the app's own.
 */

import { z } from "zod";
import type { McpRequestContext, McpToolDefinition } from "@framework/types";
import { defineTool, READ_ONLY, writeAnnotations } from "./_define";
import { callApi, tenantPath } from "../api";
import { MAX_SYSTEM_PROMPT_CHARS } from "../../lib/chat-config/store";

const configPath = (ctx: McpRequestContext) => tenantPath(ctx, "/chat/config");

export const chatAgentTools: McpToolDefinition[] = [
  defineTool(
    {
      name: "get_chat_agent_config",
      title: "Get the chat agent's system prompt",
      description:
        "Returns the organisation's custom system prompt for the wiki's own " +
        "chat assistant (`systemPrompt`; empty = none set). It is appended to " +
        "the built-in assistant prompt and applies to everyone in the " +
        "organisation. Read it before changing it with " +
        "update_chat_agent_config.",
      annotations: READ_ONLY,
      opaqueIds: true,
    },
    async (_args, ctx) => callApi(ctx, configPath(ctx)),
  ),

  defineTool(
    {
      name: "update_chat_agent_config",
      title: "Update the chat agent's system prompt",
      description:
        "Replaces the organisation's custom system prompt for the wiki's own " +
        "chat assistant with `systemPrompt` (the whole text — to change one " +
        "part, read it with get_chat_agent_config first and send the edited " +
        "full text). An empty string removes the custom prompt. The change " +
        "applies org-wide immediately, so confirm the new text with the user " +
        `first. Max. ${MAX_SYSTEM_PROMPT_CHARS} characters.`,
      inputSchema: z.object({
        systemPrompt: z
          .string()
          .max(MAX_SYSTEM_PROMPT_CHARS)
          .describe(
            "The complete new custom prompt (Markdown/plain text). Empty " +
              "string = no custom prompt.",
          ),
      }),
      annotations: writeAnnotations({ destructive: true, idempotent: true }),
      opaqueIds: true,
    },
    async (args, ctx) =>
      callApi(ctx, configPath(ctx), {
        method: "PUT",
        json: { systemPrompt: args.systemPrompt },
      }),
  ),
];
