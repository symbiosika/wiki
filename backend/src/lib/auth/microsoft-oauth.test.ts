import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { getDb } from "@framework/lib/db/db-connection";
import { users } from "@framework/lib/db/schema/users";
import { initTests, TEST_ORG1_USER_1 } from "@framework/test/init.test";
import {
  buildMicrosoftAuthorizeUrl,
  createCodeChallenge,
  createRandomToken,
  decodeTransaction,
  encodeTransaction,
  getMicrosoftRedirectUri,
  isMicrosoftLoginEnabled,
  isSameState,
  sanitizeRedirect,
  signInWithMicrosoftProfile,
} from "./microsoft-oauth";

const originalEnv = {
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  tenantId: process.env.MICROSOFT_TENANT_ID,
};

const restoreEnv = () => {
  const assign = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  assign("MICROSOFT_CLIENT_ID", originalEnv.clientId);
  assign("MICROSOFT_CLIENT_SECRET", originalEnv.clientSecret);
  assign("MICROSOFT_TENANT_ID", originalEnv.tenantId);
};

describe("Microsoft login configuration", () => {
  afterAll(restoreEnv);

  test("is off unless both client id and secret are set", () => {
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(isMicrosoftLoginEnabled()).toBe(false);

    // A client id alone is what the framework's /user/oauth-providers reports
    // on — but the confidential-client token exchange needs the secret too.
    process.env.MICROSOFT_CLIENT_ID = "client-id";
    expect(isMicrosoftLoginEnabled()).toBe(false);

    process.env.MICROSOFT_CLIENT_SECRET = "client-secret";
    expect(isMicrosoftLoginEnabled()).toBe(true);
  });

  test("redirect URI is derived from the server base URL", () => {
    const originalBaseUrl = _GLOBAL_SERVER_CONFIG.baseUrl;
    const originalBasePath = _GLOBAL_SERVER_CONFIG.basePath;
    _GLOBAL_SERVER_CONFIG.baseUrl = "https://wiki.example.com";
    _GLOBAL_SERVER_CONFIG.basePath = "/api/v1";

    expect(getMicrosoftRedirectUri()).toBe(
      "https://wiki.example.com/api/v1/auth/microsoft/callback"
    );

    // Trailing slash in the base path must not double up
    _GLOBAL_SERVER_CONFIG.basePath = "/api/v1/";
    expect(getMicrosoftRedirectUri()).toBe(
      "https://wiki.example.com/api/v1/auth/microsoft/callback"
    );

    _GLOBAL_SERVER_CONFIG.baseUrl = originalBaseUrl;
    _GLOBAL_SERVER_CONFIG.basePath = originalBasePath;
  });

  test("authorize URL carries client, PKCE and state", () => {
    process.env.MICROSOFT_CLIENT_ID = "client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "client-secret";
    process.env.MICROSOFT_TENANT_ID = "contoso-tenant";

    const url = new URL(
      buildMicrosoftAuthorizeUrl({ state: "st4te", codeChallenge: "ch4llenge" })
    );

    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/contoso-tenant/oauth2/v2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(getMicrosoftRedirectUri());
    // The secret must never appear in a browser-visible URL
    expect(url.search).not.toContain("client-secret");
  });

  test("falls back to the common directory", () => {
    delete process.env.MICROSOFT_TENANT_ID;
    const url = new URL(
      buildMicrosoftAuthorizeUrl({ state: "s", codeChallenge: "c" })
    );
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
  });
});

describe("Microsoft login transaction handling", () => {
  test("PKCE challenge matches the RFC 7636 example", () => {
    // Test vector from RFC 7636 Appendix B
    expect(
      createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("random tokens are URL-safe and unique", () => {
    const a = createRandomToken();
    const b = createRandomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("state comparison accepts only the exact value", () => {
    expect(isSameState("abc", "abc")).toBe(true);
    expect(isSameState("abc", "abd")).toBe(false);
    expect(isSameState("abc", "abcd")).toBe(false);
    expect(isSameState("abc", "")).toBe(false);
  });

  test("transaction survives a cookie round-trip", () => {
    const tx = { state: "s1", verifier: "v1", redirect: "/static/app/" };
    expect(decodeTransaction(encodeTransaction(tx))).toEqual(tx);
  });

  test("unusable transaction cookies decode to null", () => {
    expect(decodeTransaction(undefined)).toBeNull();
    expect(decodeTransaction("")).toBeNull();
    expect(decodeTransaction("not-base64-json")).toBeNull();
    expect(
      decodeTransaction(
        Buffer.from(JSON.stringify({ state: "s" }), "utf8").toString("base64url")
      )
    ).toBeNull();
  });

  test("only app-relative redirect targets are kept", () => {
    expect(sanitizeRedirect("/wiki/page-1")).toBe("/wiki/page-1");
    expect(sanitizeRedirect(undefined)).toBe("/static/app/");
    expect(sanitizeRedirect("")).toBe("/static/app/");
    // Open-redirect attempts
    expect(sanitizeRedirect("//evil.example.com")).toBe("/static/app/");
    expect(sanitizeRedirect("https://evil.example.com")).toBe("/static/app/");
  });
});

describe("Microsoft sign-in against the user table", () => {
  beforeAll(async () => {
    await initTests();
  });

  test("reuses the existing account of a magic-link user", async () => {
    // The regression the framework's own OAuth flow has: it looks users up by
    // email + provider and would try to insert a second row for this address,
    // which the unique index on users.email rejects.
    const { token, userId } = await signInWithMicrosoftProfile({
      email: TEST_ORG1_USER_1.email,
      firstname: "Ignored",
      surname: "Ignored",
    });

    expect(userId).toBe(TEST_ORG1_USER_1.id);
    expect(token.split(".").length).toBe(3);

    const rows = await getDb()
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, TEST_ORG1_USER_1.email));

    expect(rows.length).toBe(1);
    expect(rows[0]?.emailVerified).toBe(true);
  });

  test("creates a verified account for an unknown address", async () => {
    const email = `ms-login-${createRandomToken(8)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}@example.com`;

    const { userId } = await signInWithMicrosoftProfile({
      email,
      firstname: "Mia",
      surname: "Muster",
    });

    const rows = await getDb()
      .select({
        id: users.id,
        firstname: users.firstname,
        surname: users.surname,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, email));

    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(userId);
    expect(rows[0]?.firstname).toBe("Mia");
    expect(rows[0]?.surname).toBe("Muster");
    expect(rows[0]?.emailVerified).toBe(true);

    // Awaited on purpose: PGlite is single-process, and a stray delete landing
    // while the next suite builds its fixtures shows up as an unhandled error.
    await getDb().delete(users).where(eq(users.id, rows[0]!.id));
  });
});
