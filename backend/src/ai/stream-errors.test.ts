import { describe, test, expect } from "bun:test";
import { APICallError, RetryError } from "ai";
import {
  describeStreamError,
  formatStreamErrorLog,
  RATE_LIMITED_ERROR,
} from "./stream-errors";
import { AI_MODEL_ID } from "./index";

const apiError = (statusCode: number, responseBody?: string) =>
  new APICallError({
    message: "Provider returned error",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: statusCode === 429 || statusCode >= 500,
  });

const ZDR_MESSAGE =
  "0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy.\nZDR violation (account settings): 1 endpoint excluded; configurable at https://openrouter.ai/settings/privacy";
const zdrBody = JSON.stringify({
  error: {
    message: ZDR_MESSAGE,
    code: 404,
    metadata: { failed_routing_step: "Filter by Guardrails" },
  },
});

describe("describeStreamError", () => {
  test("a rate limit that outlasted the retries gets a stable code", () => {
    const error = new RetryError({
      message: "Failed after 5 attempts. Last error: Provider returned error",
      reason: "maxRetriesExceeded",
      errors: [apiError(429), apiError(429)],
    });
    expect(describeStreamError(error)).toBe(RATE_LIMITED_ERROR);
  });

  test("a single 429 is a rate limit too", () => {
    expect(describeStreamError(apiError(429))).toBe(RATE_LIMITED_ERROR);
  });

  test("no usable endpoint (OpenRouter privacy / ZDR) is model_unavailable with the provider's wording", () => {
    expect(describeStreamError(apiError(404, zdrBody))).toBe(
      `model_unavailable: ${ZDR_MESSAGE} [model ${AI_MODEL_ID}]`,
    );
  });

  test("auth and credit problems get their own codes", () => {
    expect(describeStreamError(apiError(401))).toStartWith("auth_failed: ");
    expect(describeStreamError(apiError(402))).toStartWith(
      "insufficient_credits: ",
    );
  });

  test("other errors are provider_error with a description", () => {
    expect(describeStreamError(apiError(500))).toStartWith(
      "provider_error: Provider returned error (HTTP 500)",
    );
    expect(describeStreamError(new Error("boom"))).toBe(
      `provider_error: boom [model ${AI_MODEL_ID}]`,
    );
    expect(describeStreamError("weird")).toBe(
      `provider_error: Streaming failed [model ${AI_MODEL_ID}]`,
    );
  });
});

describe("formatStreamErrorLog", () => {
  test("is a single readable line with model, code and status", () => {
    const line = formatStreamErrorLog("read", apiError(404, zdrBody));
    expect(line).toStartWith(
      `[Chat] stream error mode=read model=${AI_MODEL_ID} code=model_unavailable status=404: `,
    );
    expect(line).toContain("ZDR violation");
  });
});
