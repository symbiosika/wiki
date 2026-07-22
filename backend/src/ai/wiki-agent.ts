/**
 * Shared configuration for the wiki chat agent.
 *
 * The production chat (streaming, see routes/.../chat) and the AI test-suite
 * runner (non-streaming, see lib/ai-tests) must run the *same* agent — same
 * model, system prompt, tools and limits — otherwise the test results would
 * describe a different agent than the one users actually talk to. To guarantee
 * that, both call sites build their agent config here instead of inlining the
 * parameters. The only thing that differs is how the model is invoked
 * (`streamText` vs `generateText`) and how messages are supplied.
 */
import { stepCountIs } from "ai";
import { getModel } from "./index";
import {
  createWikiChatTools,
  buildWikiChatSystemPrompt,
  type WikiChatMode,
} from "./tools/wiki";

/** Step budget for the wiki agent (max tool-loop iterations). */
export const WIKI_AGENT_STEP_LIMIT = 10;

/** Output-token cap for a single agent turn. */
export const WIKI_AGENT_MAX_OUTPUT_TOKENS = 8192;

export interface WikiAgentConfigInput {
  tenantId: string;
  userId: string;
  mode: WikiChatMode;
  /** Organisation-specific system-prompt addition (already loaded). */
  orgSystemPrompt?: string | null;
  /**
   * Optional OpenRouter model override. The production chat never sets this
   * (it always tests the default model); a test suite may only override the
   * *judge* model, never this one.
   */
  modelId?: string;
  /** Optional step-budget override (defaults to WIKI_AGENT_STEP_LIMIT). */
  stepLimit?: number;
}

/**
 * Build the shared model/system/tools/limits block. Spread it into
 * `streamText(...)` (chat) or `generateText(...)` (test runner) and add the
 * call-site-specific bits (`messages` / `prompt`, error handling) there.
 */
export function buildWikiAgentConfig(input: WikiAgentConfigInput) {
  return {
    model: getModel(input.modelId),
    system: buildWikiChatSystemPrompt(input.mode, input.orgSystemPrompt),
    tools: createWikiChatTools(
      { tenantId: input.tenantId, userId: input.userId },
      input.mode,
    ),
    stopWhen: stepCountIs(input.stepLimit ?? WIKI_AGENT_STEP_LIMIT),
    maxOutputTokens: WIKI_AGENT_MAX_OUTPUT_TOKENS,
  };
}
