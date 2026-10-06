import { describe, test, expect } from "bun:test";
import { APICallError, RetryError } from "ai";
import { describeStreamError, RATE_LIMITED_ERROR } from "./index";

const apiError = (statusCode: number) =>
  new APICallError({
    message: "Provider returned error",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    isRetryable: true,
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

  test("other errors keep their message", () => {
    expect(describeStreamError(apiError(500))).toBe("Provider returned error");
    expect(describeStreamError(new Error("boom"))).toBe("boom");
    expect(describeStreamError("weird")).toBe("Streaming failed");
  });
});
