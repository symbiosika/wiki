/**
 * Central AI access for the app.
 *
 * All LLM / agent calls go through OpenRouter (per project convention), using a
 * Mistral model. Live audio transcription is handled separately and directly by
 * Mistral (see ../lib/audio/transcription) — NOT here.
 *
 * The model id is configurable via OPENROUTER_MODEL (defaults to a Mistral
 * model). Never import @ai-sdk/mistral for text generation in app code — route
 * everything through the provider created here.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, type LanguageModel } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import type { GenericSchema } from "valibot";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/** Model id used for all text LLM / agent calls (a Mistral model on OpenRouter). */
export const AI_MODEL_ID =
  process.env.OPENROUTER_MODEL ?? "mistralai/mistral-large";

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY ?? "",
});

/**
 * Shared language model for generateObject / generateText / agents.
 * Cast bridges the provider's bundled ai types to our ai@6 `LanguageModel`
 * (nominal mismatch only; the runtime interface is compatible).
 */
export const STANDARD_AI_MODEL = openrouter.chat(
  AI_MODEL_ID,
) as unknown as LanguageModel;

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
