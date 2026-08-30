/**
 * Unit tests for the pure helpers in api.ts (no network).
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import type { McpRequestContext } from "@framework/types";
import type { McpTokenKind } from "@framework/lib/mcp/types";
import { ok, fail, resolveTenantId, tenantPath } from "./api";

const ctx = (
  tenantId?: string,
  tokenKind: McpTokenKind = "session",
): McpRequestContext => ({
  usersId: "u",
  scopes: [],
  tokenKind,
  tenantId,
  fetchApi: async () => new Response("{}"),
});

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
  test("prefers the credential's tenant", () => {
    expect(resolveTenantId(ctx("tenant-1"))).toBe("tenant-1");
  });

  test("throws when no tenant is available", () => {
    const prev = process.env.WIKI_TENANT_ID;
    delete process.env.WIKI_TENANT_ID;
    try {
      expect(() => resolveTenantId(ctx(undefined))).toThrow();
    } finally {
      if (prev !== undefined) process.env.WIKI_TENANT_ID = prev;
    }
  });

  test("an OAuth token without a tenant binding does not fall back", () => {
    // Even if WIKI_TENANT_ID were set, an OAuth token missing its tenant
    // binding must fail loud (reconnect) rather than be mapped elsewhere.
    const prev = process.env.WIKI_TENANT_ID;
    process.env.WIKI_TENANT_ID = "some-other-org";
    try {
      expect(() => resolveTenantId(ctx(undefined, "oauth"))).toThrow(
        /not bound to an organisation/,
      );
    } finally {
      if (prev === undefined) delete process.env.WIKI_TENANT_ID;
      else process.env.WIKI_TENANT_ID = prev;
    }
  });

  test("non-OAuth credentials fall back to WIKI_TENANT_ID", () => {
    const prev = process.env.WIKI_TENANT_ID;
    process.env.WIKI_TENANT_ID = "fallback-org";
    try {
      expect(resolveTenantId(ctx(undefined, "session"))).toBe("fallback-org");
    } finally {
      if (prev === undefined) delete process.env.WIKI_TENANT_ID;
      else process.env.WIKI_TENANT_ID = prev;
    }
  });
});

describe("tenantPath()", () => {
  test("builds a tenant-scoped API path", () => {
    expect(tenantPath(ctx("t1"), "/wiki/tree")).toBe(
      "/api/v1/tenant/t1/wiki/tree",
    );
  });
});
