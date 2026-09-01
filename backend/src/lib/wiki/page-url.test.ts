/**
 * Unit tests for the wiki page addresses (no network).
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { wikiPagePath, wikiPageUrl } from "./page-url";

describe("wikiPagePath()", () => {
  test("points into the app's hash route", () => {
    expect(wikiPagePath("t-1", "p-1")).toBe(
      "/static/app/#/tenant/t-1/wiki/p-1",
    );
  });

  test("appends a section anchor behind the route", () => {
    expect(wikiPagePath("t-1", "p-1", "urlaub")).toBe(
      "/static/app/#/tenant/t-1/wiki/p-1#urlaub",
    );
  });

  test("is relative, so it stays on whatever host serves the app", () => {
    expect(wikiPagePath("t-1", "p-1").startsWith("/")).toBe(true);
  });
});

describe("wikiPageUrl()", () => {
  test("prefixes the configured base url", () => {
    const original = _GLOBAL_SERVER_CONFIG.baseUrl;
    _GLOBAL_SERVER_CONFIG.baseUrl = "https://wiki.example.com";
    try {
      expect(wikiPageUrl("t-1", "p-1")).toBe(
        "https://wiki.example.com/static/app/#/tenant/t-1/wiki/p-1",
      );
    } finally {
      _GLOBAL_SERVER_CONFIG.baseUrl = original;
    }
  });

  test("tolerates a trailing slash on the base url", () => {
    const original = _GLOBAL_SERVER_CONFIG.baseUrl;
    _GLOBAL_SERVER_CONFIG.baseUrl = "https://wiki.example.com/";
    try {
      expect(wikiPageUrl("t-1", "p-1", "a")).toBe(
        "https://wiki.example.com/static/app/#/tenant/t-1/wiki/p-1#a",
      );
    } finally {
      _GLOBAL_SERVER_CONFIG.baseUrl = original;
    }
  });
});
