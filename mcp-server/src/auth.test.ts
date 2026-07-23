/**
 * Tests for token validation and credential forwarding. `fetch` is stubbed so
 * no network is touched — we only assert how the auth layer classifies tokens
 * and how `callApi` forwards each kind to the app.
 * Run: bun test
 */
import { describe, test, expect, afterEach } from "bun:test";
import { authenticate } from "./auth.ts";
import { callApi } from "./app-api.ts";
import type { AuthInfo } from "@modelcontextprotocol/server";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const bearer = (token: string) =>
  new Request("https://mcp.example/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

/** Route stubbed responses by URL substring. */
const stubFetch = (
  routes: Array<{ match: string; status: number; body: unknown }>,
  record?: (url: string, init?: RequestInit) => void,
) => {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    record?.(url, init);
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? 404;
    return new Response(JSON.stringify(route?.body ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
};

describe("authenticate()", () => {
  test("rejects requests without a Bearer header", async () => {
    expect(await authenticate(new Request("https://mcp.example/mcp"))).toBeNull();
  });

  test("accepts an active OAuth token with a matching audience", async () => {
    stubFetch([
      {
        match: "/oauth/introspect",
        status: 200,
        body: {
          active: true,
          sub: "user-1",
          scope: "knowledge:read knowledge:write",
          client_id: "claude",
          tenant: "tenant-1",
          aud: "http://localhost:3000",
        },
      },
    ]);
    const info = await authenticate(bearer("oauth-jwt"));
    expect(info).not.toBeNull();
    expect((info!.extra as any).kind).toBe("oauth");
    expect((info!.extra as any).sub).toBe("user-1");
    expect(info!.scopes).toEqual(["knowledge:read", "knowledge:write"]);
  });

  test("falls back to the API-token path when introspection is inactive", async () => {
    const calls: string[] = [];
    stubFetch(
      [
        { match: "/oauth/introspect", status: 200, body: { active: false } },
        { match: "/oauth/userinfo", status: 200, body: { sub: "svc-user" } },
      ],
      (url) => calls.push(url),
    );
    const info = await authenticate(bearer("api-token-xyz"));
    expect(info).not.toBeNull();
    expect((info!.extra as any).kind).toBe("api");
    expect((info!.extra as any).sub).toBe("svc-user");
    // introspection is tried first, userinfo (X-API-KEY probe) second.
    expect(calls.some((u) => u.includes("/oauth/introspect"))).toBe(true);
    expect(calls.some((u) => u.includes("/oauth/userinfo"))).toBe(true);
  });

  test("rejects a token that is neither an OAuth nor an API token", async () => {
    stubFetch([
      { match: "/oauth/introspect", status: 200, body: { active: false } },
      { match: "/oauth/userinfo", status: 401, body: { error: "unauthorized" } },
    ]);
    expect(await authenticate(bearer("garbage"))).toBeNull();
  });
});

describe("callApi() credential forwarding", () => {
  const makeAuth = (kind: string): AuthInfo =>
    ({
      token: "tok",
      clientId: "c",
      scopes: [],
      extra: { sub: "u", tenant: "tenant-1", kind },
    }) as AuthInfo;

  test("sends OAuth tokens as an Authorization: Bearer header", async () => {
    let seen: Record<string, string> = {};
    stubFetch(
      [{ match: "/api/", status: 200, body: { success: true, data: {} } }],
      (_url, init) => {
        seen = (init?.headers as Record<string, string>) ?? {};
      },
    );
    await callApi(makeAuth("oauth"), "/api/v1/x");
    expect(seen["authorization"]).toBe("Bearer tok");
    expect(seen["x-api-key"]).toBeUndefined();
  });

  test("sends API tokens as an X-API-KEY header", async () => {
    let seen: Record<string, string> = {};
    stubFetch(
      [{ match: "/api/", status: 200, body: { success: true, data: {} } }],
      (_url, init) => {
        seen = (init?.headers as Record<string, string>) ?? {};
      },
    );
    await callApi(makeAuth("api"), "/api/v1/x");
    expect(seen["x-api-key"]).toBe("tok");
    expect(seen["authorization"]).toBeUndefined();
  });
});
