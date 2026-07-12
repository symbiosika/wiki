/**
 * Central AI access for the app.
 *
 * All LLM / agent calls go through OpenRouter (per project convention), using a
 * Mistral model. We talk to OpenRouter via its OpenAI-compatible API through
 * `@ai-sdk/openai-compatible` — that provider is versioned in lockstep with the
 * AI SDK we use (like @ai-sdk/mistral), so the model specification version
 * matches `ai` at runtime. (The dedicated @openrouter/ai-sdk-provider targets a
 * different AI SDK major and throws AI_UnsupportedModelVersionError here.)
 *
 * Live audio transcription is handled separately and directly by Mistral (see
 * ../lib/audio/transcription) — NOT here.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import type { GenericSchema } from "valibot";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

/** Model id used for all text LLM / agent calls (a Mistral model on OpenRouter). */
export const AI_MODEL_ID =
  process.env.OPENROUTER_MODEL ?? "mistralai/mistral-large";

const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: OPENROUTER_BASE_URL,
  apiKey: OPENROUTER_API_KEY ?? "",
});

/** Shared language model for generateObject / generateText / agents. */
export const STANDARD_AI_MODEL = openrouter.chatModel(AI_MODEL_ID);

/** Throws a clear error if the OpenRouter key is missing. */
export const assertOpenRouterConfigured = (): void => {
  if (!OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. It is required for AI protocol " +
        "processing (summary + digital-twin brain).",
    );
  }
};

/**
 * Generate a structured object from the model using a valibot schema.
 * Thin wrapper around `generateObject` so every call site shares the same
 * model + config and reads cleanly.
 */
export const generateStructured = async <T>(params: {
  schema: GenericSchema<T>;
  system: string;
  prompt: string;
}): Promise<T> => {
  assertOpenRouterConfigured();
  const { object } = await generateObject({
    model: STANDARD_AI_MODEL,
    schema: valibotSchema(params.schema),
    system: params.system,
    prompt: params.prompt,
  });
  return object as T;
};
