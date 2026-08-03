import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import {
  MICROSOFT_TX_COOKIE,
  createRandomToken,
  encodeTransaction,
} from "../../../lib/auth/microsoft-oauth";
import defineMicrosoftLoginRoutes from "./index";

/**
 * Route test without database or network: everything asserted here happens
 * before the token exchange (configuration guard, state/CSRF handling,
 * transaction cookie). The sign-in itself is covered in
 * src/lib/auth/microsoft-oauth.test.ts.
 */
const app: SymbiosikaFrameworkHonoApp = new Hono();

const originalEnv = {
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
};

const enableProvider = () => {
  process.env.MICROSOFT_CLIENT_ID = "client-id";
  process.env.MICROSOFT_CLIENT_SECRET = "client-secret";
};

const disableProvider = () => {
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_SECRET;
};

describe("Microsoft login routes", () => {
  beforeAll(() => {
    defineMicrosoftLoginRoutes(app, "/api/v1");
  });

  afterAll(() => {
    if (originalEnv.clientId === undefined) delete process.env.MICROSOFT_CLIENT_ID;
    else process.env.MICROSOFT_CLIENT_ID = originalEnv.clientId;
    if (originalEnv.clientSecret === undefined)
      delete process.env.MICROSOFT_CLIENT_SECRET;
    else process.env.MICROSOFT_CLIENT_SECRET = originalEnv.clientSecret;
  });

  test("start redirects back to the login page when not configured", async () => {
    disableProvider();

    const response = await app.request("/api/v1/auth/microsoft/login");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${_GLOBAL_SERVER_CONFIG.loginUrl}?error=microsoft_unavailable`
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("start redirects to Microsoft and stores the transaction cookie", async () => {
    enableProvider();

    const response = await app.request(
      "/api/v1/auth/microsoft/login?redirectUrl=%2Fwiki%2Fpage-1"
    );

    expect(response.status).toBe(302);

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://login.microsoftonline.com");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${MICROSOFT_TX_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    // The state in the URL is the one pinned in the cookie
    const cookieValue = decodeURIComponent(
      cookie.split(`${MICROSOFT_TX_COOKIE}=`)[1]!.split(";")[0]!
    );
    const transaction = JSON.parse(
      Buffer.from(cookieValue, "base64url").toString("utf8")
    );
    expect(transaction.state).toBe(state);
    expect(transaction.redirect).toBe("/wiki/page-1");
    expect(transaction.verifier).toBeTruthy();
  });

  test("an off-site redirect target is dropped", async () => {
    enableProvider();

    const response = await app.request(
      "/api/v1/auth/microsoft/login?redirectUrl=https%3A%2F%2Fevil.example.com"
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    const cookieValue = decodeURIComponent(
      cookie.split(`${MICROSOFT_TX_COOKIE}=`)[1]!.split(";")[0]!
    );
    const transaction = JSON.parse(
      Buffer.from(cookieValue, "base64url").toString("utf8")
    );

    expect(transaction.redirect).toBe("/static/app/");
  });

  test("callback without a transaction cookie fails closed", async () => {
    enableProvider();

    const response = await app.request(
      "/api/v1/auth/microsoft/callback?code=abc&state=xyz"
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${_GLOBAL_SERVER_CONFIG.loginUrl}?error=microsoft_failed`
    );
  });

  test("callback rejects a mismatching state (CSRF)", async () => {
    enableProvider();

    const transaction = encodeTransaction({
      state: createRandomToken(),
      verifier: createRandomToken(),
      redirect: "/static/app/",
    });

    const response = await app.request(
      "/api/v1/auth/microsoft/callback?code=abc&state=someone-elses-state",
      {
        headers: { Cookie: `${MICROSOFT_TX_COOKIE}=${transaction}` },
      }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${_GLOBAL_SERVER_CONFIG.loginUrl}?error=microsoft_failed`
    );
    // The transaction cookie is cleared, so it cannot be replayed
    expect(response.headers.get("set-cookie")).toContain(
      `${MICROSOFT_TX_COOKIE}=;`
    );
  });

  test("a cancelled consent screen is reported as cancelled", async () => {
    enableProvider();

    const response = await app.request(
      "/api/v1/auth/microsoft/callback?error=access_denied&error_description=user+cancelled"
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${_GLOBAL_SERVER_CONFIG.loginUrl}?error=microsoft_cancelled`
    );
  });

  test("callback stays closed when the provider is not configured", async () => {
    disableProvider();

    const response = await app.request(
      "/api/v1/auth/microsoft/callback?code=abc&state=xyz"
    );

    expect(response.headers.get("location")).toBe(
      `${_GLOBAL_SERVER_CONFIG.loginUrl}?error=microsoft_unavailable`
    );
  });
});
