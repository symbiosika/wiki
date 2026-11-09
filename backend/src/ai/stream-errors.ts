/**
 * Errors of the streaming wiki chat, for the client and for the log.
 *
 * The client gets `"<code>"` or `"<code>: <technical detail>"` as stream
 * error text: the frontend explains the code in plain words and shows the
 * detail collapsed underneath, so an admin can see what OpenRouter said.
 */
import { APICallError, RetryError } from "ai";
import { AI_MODEL_ID } from "./index";
import { describeAiError } from "./errors";

/** Stream error codes the frontend translates into an explanation. */
export const RATE_LIMITED_ERROR = "rate_limited";
export const STREAM_ERROR_CODES = [
  RATE_LIMITED_ERROR,
  /** No usable endpoint for the model (unknown model, OpenRouter privacy / ZDR or provider filters). */
  "model_unavailable",
  /** OpenRouter rejected the API key. */
  "auth_failed",
  /** OpenRouter account has no credits left. */
  "insufficient_credits",
  /** Anything else the provider answered with. */
  "provider_error",
] as const;
export type StreamErrorCode = (typeof STREAM_ERROR_CODES)[number];

const lastAttempt = (error: unknown) =>
  RetryError.isInstance(error) ? error.lastError : error;

/** The `error.message` of an OpenRouter error body, if there is one. */
const openRouterMessage = (error: APICallError): string | null => {
  if (!error.responseBody) return null;
  try {
    const parsed = JSON.parse(error.responseBody) as {
      error?: { message?: unknown };
    };
    const message = parsed?.error?.message;
    return typeof message === "string" && message.trim() ? message : null;
  } catch {
    return null;
  }
};

/** Map a failed model call to one of the stream error codes. */
export const classifyStreamError = (error: unknown): StreamErrorCode => {
  const last = lastAttempt(error);
  if (!APICallError.isInstance(last)) return "provider_error";
  switch (last.statusCode) {
    case 429:
      return RATE_LIMITED_ERROR;
    case 401:
    case 403:
      return "auth_failed";
    case 402:
      return "insufficient_credits";
    case 404:
      return "model_unavailable";
    default:
      return "provider_error";
  }
};

/**
 * Message sent to the client when the stream fails: a stable code the
 * frontend can explain, plus the provider's own wording as detail. A rate
 * limit stays the bare code — the explanation says everything there is.
 */
export const describeStreamError = (error: unknown): string => {
  const code = classifyStreamError(error);
  if (code === RATE_LIMITED_ERROR) return code;
  const last = lastAttempt(error);
  const providerMessage = APICallError.isInstance(last)
    ? openRouterMessage(last)
    : null;
  const detail =
    providerMessage ??
    (error instanceof Error ? describeAiError(error) : "Streaming failed");
  return `${code}: ${detail} [model ${AI_MODEL_ID}]`;
};

/**
 * One readable log line for a failed chat stream. Logging the raw error
 * object makes Bun print the surrounding minified bundle source, which buries
 * the actual reason.
 */
export const formatStreamErrorLog = (mode: string, error: unknown): string => {
  const last = lastAttempt(error);
  const status = APICallError.isInstance(last)
    ? ` status=${last.statusCode ?? "?"}`
    : "";
  return `[Chat] stream error mode=${mode} model=${AI_MODEL_ID} code=${classifyStreamError(error)}${status}: ${describeAiError(error)}`;
};
