import { describe, test, expect } from "bun:test";
import { APICallError, RetryError } from "ai";
import { describeAiError } from "./errors";

const openRouterError = (statusCode: number, raw: string) =>
  new APICallError({
    message: "Provider returned error",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({
      error: {
        message: "Provider returned error",
        code: statusCode,
        metadata: { provider_name: "Mistral", raw },
      },
    }),
  });

describe("describeAiError", () => {
  test("unwraps a RetryError down to status, provider and raw error", () => {
    const err = openRouterError(429, "Rate limit exceeded");
    const retry = new RetryError({
      message: "Failed after 3 attempts. Last error: Provider returned error",
      reason: "maxRetriesExceeded",
      errors: [err, err, err],
    });
    expect(describeAiError(retry)).toBe(
      "Failed after 3 attempts (maxRetriesExceeded). Last error: " +
        "Provider returned error (HTTP 429; provider Mistral, code 429, raw: Rate limit exceeded)",
    );
  });

  test("lists every attempt when they differ", () => {
    const retry = new RetryError({
      message: "Failed after 2 attempts.",
      reason: "maxRetriesExceeded",
      errors: [openRouterError(429, "slow down"), openRouterError(502, "bad gateway")],
    });
    const text = describeAiError(retry);
    expect(text).toContain("Attempt 1: Provider returned error (HTTP 429");
    expect(text).toContain("Attempt 2: Provider returned error (HTTP 502");
    expect(text).toContain("bad gateway");
  });

  test("keeps a non-JSON response body and plain errors readable", () => {
    const err = new APICallError({
      message: "Bad Gateway",
      url: "x",
      requestBodyValues: {},
      statusCode: 502,
      responseBody: "<html>upstream down</html>",
    });
    expect(describeAiError(err)).toBe(
      "Bad Gateway (HTTP 502; <html>upstream down</html>)",
    );
    expect(describeAiError(new Error("Timeout after 120000ms"))).toBe(
      "Timeout after 120000ms",
    );
    expect(describeAiError("boom")).toBe("boom");
  });
});
