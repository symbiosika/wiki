/**
 * Unit tests for the pure helpers in app-api.ts (no network).
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import { ok, fail, resolveTenantId, tenantPath } from "./app-api.ts";
import type { AuthInfo } from "@modelcontextprotocol/server";

const auth = (tenant?: string, kind?: string): AuthInfo =>
  ({
    token: "t",
    clientId: "c",
    scopes: [],
    extra: { sub: "u", tenant, ...(kind ? { kind } : {}) },
  }) as AuthInfo;

describe("ok()", () => {
  test("wraps a string as a text block", () => {
    const r = ok("hello");
    expect(r.content[0]).toEqual({ type: "text", text: "hello" });
    expect(r.structuredContent).toBeUndefined();
  });

  test("wraps an array in { items }", () => {
    const r = ok([1, 2, 3]);
    expect(r.structuredContent).toEqual({ items: [1, 2, 3] });
  });

  test("passes an object through as structuredContent", () => {
    const r = ok({ id: "x", title: "T" });
    expect(r.structuredContent).toEqual({ id: "x", title: "T" });
    expect(JSON.parse(r.content[0]!.text)).toEqual({ id: "x", title: "T" });
  });
});

describe("fail()", () => {
  test("marks the result as an error", () => {
    const r = fail("boom");
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("boom");
  });
});

describe("resolveTenantId()", () => {
  test("prefers the token tenant", () => {
    expect(resolveTenantId(auth("tenant-1"))).toBe("tenant-1");
  });

  test("throws when no tenant is available", () => {
    expect(() => resolveTenantId(auth(undefined))).toThrow();
  });

  test("an OAuth token without a tenant binding does not fall back", () => {
    // Even if WIKI_TENANT_ID were set, an OAuth token missing its tenant
    // binding must fail loud (reconnect) rather than be mapped elsewhere.
    expect(() => resolveTenantId(auth(undefined, "oauth"))).toThrow(
      /not bound to an organisation/,
    );
  });
});

describe("tenantPath()", () => {
  test("builds a tenant-scoped API path", () => {
    expect(tenantPath(auth("t1"), "/wiki/tree")).toBe(
      "/api/v1/tenant/t1/wiki/tree",
    );
  });
});
