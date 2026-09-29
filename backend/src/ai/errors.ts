/**
 * Turn an AI SDK / OpenRouter error into a message that actually says what
 * went wrong.
 *
 * `generateText` retries failed model calls and then throws a `RetryError`
 * whose message is only "Failed after 3 attempts. Last error: Provider returned
 * error". The useful part — HTTP status, which upstream provider failed and
 * its raw error — sits in the wrapped `APICallError`s' `statusCode` and
 * `responseBody`. OpenRouter reports upstream failures as
 * `{ error: { message, code, metadata: { provider_name, raw } } }`.
 */
import { APICallError, RetryError } from "ai";

const MAX_DETAIL_LENGTH = 500;

const truncate = (text: string, max = MAX_DETAIL_LENGTH) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Pull provider name / code / raw message out of an OpenRouter error body. */
const describeResponseBody = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        code?: number | string;
        metadata?: { provider_name?: string; raw?: unknown };
      };
    };
    const err = parsed?.error;
    if (!err) return truncate(body);
    const parts: string[] = [];
    if (err.metadata?.provider_name) {
      parts.push(`provider ${err.metadata.provider_name}`);
    }
    if (err.code !== undefined) parts.push(`code ${err.code}`);
    const raw = err.metadata?.raw;
    if (raw !== undefined && raw !== null && raw !== "") {
      parts.push(
        `raw: ${truncate(typeof raw === "string" ? raw : JSON.stringify(raw))}`,
      );
    } else if (err.message) {
      parts.push(err.message);
    }
    return parts.length > 0 ? parts.join(", ") : truncate(body);
  } catch {
    return body.trim() ? truncate(body) : null;
  }
};

const describeSingle = (error: unknown): string => {
  if (APICallError.isInstance(error)) {
    const details: string[] = [];
    if (error.statusCode !== undefined) details.push(`HTTP ${error.statusCode}`);
    const body = error.responseBody
      ? describeResponseBody(error.responseBody)
      : null;
    if (body) details.push(body);
    return details.length > 0
      ? `${error.message} (${details.join("; ")})`
      : error.message;
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error && cause.message !== error.message
      ? `${error.message} (cause: ${cause.message})`
      : error.message;
  }
  return String(error);
};

/**
 * Human-readable description of an AI call failure including status code,
 * provider and raw upstream error. For a `RetryError` every attempt is listed
 * when they differ, so a "429, 429, 502" pattern stays visible.
 */
export const describeAiError = (error: unknown): string => {
  if (!RetryError.isInstance(error)) return describeSingle(error);

  const attempts = error.errors.map(describeSingle);
  const unique = [...new Set(attempts)];
  const head = `Failed after ${attempts.length} attempts (${error.reason})`;
  if (unique.length === 0) return error.message;
  if (unique.length === 1) return `${head}. Last error: ${unique[0]}`;
  return `${head}. ${attempts.map((a, i) => `Attempt ${i + 1}: ${a}`).join(" | ")}`;
};
