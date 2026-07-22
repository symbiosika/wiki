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
import { generateObject, generateText, type LanguageModelUsage } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import { toJsonSchema } from "@valibot/to-json-schema";
import { safeParse, type GenericSchema } from "valibot";

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

/**
 * Resolve a language model by OpenRouter model id, falling back to the
 * configured default (`AI_MODEL_ID`) when no id is given. Use this when a call
 * site needs a per-request model override (e.g. a tenant-configured agent).
 */
export const getModel = (modelId?: string) =>
  modelId ? openrouter.chatModel(modelId) : STANDARD_AI_MODEL;

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

/** Pull a JSON object out of a model reply that may wrap it in prose/fences. */
export const extractJsonObject = (text: string): string => {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  return t;
};

/**
 * Parse a model reply into a schema-valid object (pure, no IO). Tolerates
 * surrounding prose / markdown fences, then validates with valibot. Exported so
 * the tolerant-parse path can be unit-tested without hitting a model.
 */
export const parseSchemaJson = <T>(
  text: string,
  schema: GenericSchema<T>,
): { ok: true; object: T } | { ok: false; error: string } => {
  try {
    const parsed = JSON.parse(extractJsonObject(text));
    const validated = safeParse(schema, parsed);
    if (validated.success) return { ok: true, object: validated.output as T };
    return {
      ok: false,
      error: validated.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join("; "),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid JSON",
    };
  }
};

const addUsage = (
  acc: { inputTokens: number; outputTokens: number; totalTokens: number },
  u: LanguageModelUsage,
) => {
  acc.inputTokens += u.inputTokens ?? 0;
  acc.outputTokens += u.outputTokens ?? 0;
  acc.totalTokens += u.totalTokens ?? 0;
};

/**
 * Structured-object generation for evaluation / judge call sites.
 *
 * Unlike {@link generateStructured} this (a) honours a per-call model override
 * via `modelId` (so a test suite can judge with a stronger model than the one
 * under test) and (b) returns the token `usage` alongside the object (so a run
 * can account for judge cost).
 *
 * It deliberately does NOT use the AI SDK's `generateObject`: our OpenRouter
 * provider is configured without `supportsStructuredOutputs`, so `generateObject`
 * silently drops the JSON schema and often fails validation on non-trivial
 * shapes ("No object generated: response did not match schema"). Instead we ask
 * for JSON in the prompt (schema included), parse tolerantly, validate with
 * valibot, and repair once — provider-agnostic and robust for nested schemas.
 */
export const generateJudgeObject = async <T>(params: {
  schema: GenericSchema<T>;
  system: string;
  prompt: string;
  modelId?: string;
}): Promise<{ object: T; usage: LanguageModelUsage }> => {
  assertOpenRouterConfigured();
  const model = getModel(params.modelId);
  const jsonSchema = JSON.stringify(toJsonSchema(params.schema));
  const schemaBlock = `\n\nReturn ONLY a single JSON object — no prose, no explanation, no markdown code fences — that validates against this JSON schema:\n${jsonSchema}`;

  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let lastError = "invalid JSON";
  let lastText = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? `${params.prompt}${schemaBlock}`
        : `${params.prompt}${schemaBlock}\n\nYour previous reply could not be used (${lastError}). Previous reply:\n${lastText}\n\nReturn corrected JSON only.`;

    const result = await generateText({
      model,
      system: params.system,
      prompt,
    });
    addUsage(usage, result.totalUsage);
    lastText = result.text ?? "";

    const parsed = parseSchemaJson(lastText, params.schema);
    if (parsed.ok) {
      return { object: parsed.object, usage: usage as LanguageModelUsage };
    }
    lastError = parsed.error;
  }

  throw new Error(`Judge did not return schema-valid JSON: ${lastError}`);
};
