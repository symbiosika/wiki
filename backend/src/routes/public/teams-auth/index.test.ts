import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type {
  SFContextVariables,
  SymbiosikaFrameworkHonoApp,
} from "@framework/types";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { getDb } from "@framework/lib/db/db-connection";
import { invitationCodes, users } from "@framework/lib/db/db-schema";
import { authAndSetUsersInfo } from "@framework/lib/utils/hono-middlewares";
import { initTests, TEST_ORG1_USER_1 } from "@framework/test/init.test";
import {
  FAKE_CLIENT_ID,
  FAKE_TENANT_ID,
  createFakeTeamsToken,
  installFakeEntra,
} from "../../../test/fake-entra.test";
import { _resetTeamsSsoJwksCache } from "../../../lib/teams-sso";
import defineTeamsAuthRoutes, {
  _resetTeamsCodeAttempts,
} from "./index";

/**
 * The Teams sign-in as the tab experiences it: POST a token, get a session in
 * the response body — no cookie anywhere, because in a Teams tab there is no
 * usable one.
 *
 * The invitation-code rules are the framework's; what is tested here is that
 * this route really goes through them instead of taking a shortcut, and that the
 * session it hands out is a normal, usable one.
 */
const app: SymbiosikaFrameworkHonoApp = new Hono();

/** A protected route, to prove the issued token actually authenticates. */
const protectedApp = new Hono<{ Variables: SFContextVariables }>();
protectedApp.get("/whoami", authAndSetUsersInfo, (c) =>
  c.json({ userId: c.get("usersId"), email: c.get("usersEmail") })
);

const NEW_USER_EMAIL = "teams.newcomer@symbiosika.de";
/**
 * One address per test that reaches the invitation gate. A successful sign-up
 * leaves an account behind, and an existing account is exactly what turns the
 * gate off — sharing an address between these tests would make the later ones
 * assert the wrong branch.
 */
const GATED_EMAIL = "teams.gated@symbiosika.de";
const GATED_NO_CODE_EMAIL = "teams.gated.nocode@symbiosika.de";
const GATED_BRUTEFORCE_EMAIL = "teams.gated.bruteforce@symbiosika.de";
const GATED_EMAILS = [GATED_EMAIL, GATED_NO_CODE_EMAIL, GATED_BRUTEFORCE_EMAIL];
const TEST_CODE = "teams-invitation-code";

const originalEnv = {
  clientId: process.env.MICROSOFT_CLIENT_ID,
  tenantId: process.env.MICROSOFT_TENANT_ID,
  baseUrl: _GLOBAL_SERVER_CONFIG.baseUrl,
};

let entra: ReturnType<typeof installFakeEntra>;

const exchange = (teamsToken: string) =>
  app.request("/api/v1/auth/teams/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamsToken }),
  });

const completeRegistration = (body: Record<string, unknown>) =>
  app.request("/api/v1/auth/teams/complete-registration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const activateInvitationCode = async () => {
  await getDb()
    .insert(invitationCodes)
    .values({ code: TEST_CODE, isActive: true })
    .onConflictDoUpdate({
      target: [invitationCodes.code],
      set: { isActive: true },
    });
};

const deactivateInvitationCode = () =>
  getDb().delete(invitationCodes).where(eq(invitationCodes.code, TEST_CODE));

const findUser = (email: string) =>
  getDb()
    .select({ id: users.id, extUserId: users.extUserId, provider: users.provider })
    .from(users)
    .where(eq(users.email, email));

describe("Teams SSO routes", () => {
  beforeAll(async () => {
    await initTests();
    defineTeamsAuthRoutes(app, "/api/v1");

    entra = installFakeEntra();
    _GLOBAL_SERVER_CONFIG.baseUrl = "https://wiki.example.com";

    await getDb()
      .delete(users)
      .where(inArray(users.email, [NEW_USER_EMAIL, ...GATED_EMAILS]));
  });

  afterAll(async () => {
    entra.restore();
    _GLOBAL_SERVER_CONFIG.baseUrl = originalEnv.baseUrl;
    if (originalEnv.clientId === undefined)
      delete process.env.MICROSOFT_CLIENT_ID;
    else process.env.MICROSOFT_CLIENT_ID = originalEnv.clientId;
    if (originalEnv.tenantId === undefined)
      delete process.env.MICROSOFT_TENANT_ID;
    else process.env.MICROSOFT_TENANT_ID = originalEnv.tenantId;

    try {
      // An invitation code left active would make every later registration
      // demand one, so it goes even if a test failed midway.
      await deactivateInvitationCode();
      await getDb()
        .delete(users)
        .where(inArray(users.email, [NEW_USER_EMAIL, ...GATED_EMAILS]));
    } catch (err) {
      console.warn("[teams-auth.test] cleanup failed:", err);
    }
  });

  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = FAKE_CLIENT_ID;
    process.env.MICROSOFT_TENANT_ID = FAKE_TENANT_ID;
    _resetTeamsSsoJwksCache();
    _resetTeamsCodeAttempts();
  });

  test("an existing account is signed in and the session token works", async () => {
    const response = await exchange(
      createFakeTeamsToken({
        oid: "oid-existing-user",
        email: TEST_ORG1_USER_1.email,
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.status).toBe("authenticated");
    expect(body.user.email).toBe(TEST_ORG1_USER_1.email);
    expect(body.user.id).toBe(TEST_ORG1_USER_1.id);
    expect(typeof body.expiresAt).toBe("string");

    // No cookie is involved — that is the whole reason this route exists.
    expect(response.headers.getSetCookie()).toEqual([]);

    // The token is a normal session token, usable as a bearer credential.
    const whoami = await protectedApp.request("/whoami", {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(whoami.status).toBe(200);
    expect(((await whoami.json()) as any).email).toBe(TEST_ORG1_USER_1.email);
  });

  test("the Microsoft subject id is stored on the existing account", async () => {
    // This is what makes the second sign-in resolve by `oid` instead of the
    // address — and what links a magic-link account to its Microsoft identity.
    const [user] = await findUser(TEST_ORG1_USER_1.email);
    expect(user?.extUserId).toBe("oid-existing-user");
  });

  test("an unknown address is registered when no invitation code is required", async () => {
    const response = await exchange(
      createFakeTeamsToken({ oid: "oid-newcomer", email: NEW_USER_EMAIL })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.status).toBe("authenticated");
    expect(body.user.email).toBe(NEW_USER_EMAIL);

    const [created] = await findUser(NEW_USER_EMAIL);
    expect(created?.provider).toBe("microsoft");
    expect(created?.extUserId).toBe("oid-newcomer");
  });

  test("a gated instance asks for an invitation code instead of registering", async () => {
    await activateInvitationCode();
    try {
      const response = await exchange(
        createFakeTeamsToken({ oid: "oid-gated", email: GATED_EMAIL })
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.status).toBe("invitation_code_required");
      expect(body.email).toBe(GATED_EMAIL);
      expect(body.pendingRegistrationToken).toBeTruthy();
      // no session, and no account
      expect(body.token).toBeUndefined();
      expect((await findUser(GATED_EMAIL)).length).toBe(0);

      // A wrong code is refused and stays retryable …
      const wrong = await completeRegistration({
        pendingRegistrationToken: body.pendingRegistrationToken,
        invitationCode: "nope",
      });
      expect(wrong.status).toBe(400);
      expect((await findUser(GATED_EMAIL)).length).toBe(0);

      // … the right one completes the sign-up.
      const done = await completeRegistration({
        pendingRegistrationToken: body.pendingRegistrationToken,
        invitationCode: TEST_CODE,
      });
      expect(done.status).toBe(200);
      const doneBody = (await done.json()) as any;
      expect(doneBody.status).toBe("authenticated");
      expect(doneBody.user.email).toBe(GATED_EMAIL);
      expect(done.headers.getSetCookie()).toEqual([]);

      const [created] = await findUser(GATED_EMAIL);
      expect(created?.extUserId).toBe("oid-gated");
    } finally {
      await deactivateInvitationCode();
    }
  });

  test("a known account signs in even while the gate is active", async () => {
    // The gate authorises *new* accounts; it must not lock out existing users.
    await activateInvitationCode();
    try {
      const response = await exchange(
        createFakeTeamsToken({
          oid: "oid-existing-user",
          email: TEST_ORG1_USER_1.email,
        })
      );
      expect(((await response.json()) as any).status).toBe("authenticated");
    } finally {
      await deactivateInvitationCode();
    }
  });

  test("completing a registration without a code is refused while gated", async () => {
    await activateInvitationCode();
    try {
      const start = await exchange(
        createFakeTeamsToken({
          oid: "oid-gated-2",
          email: GATED_NO_CODE_EMAIL,
        })
      );
      const { pendingRegistrationToken } = (await start.json()) as any;

      const response = await completeRegistration({
        pendingRegistrationToken,
      });
      expect(response.status).toBe(400);
      expect((await findUser(GATED_NO_CODE_EMAIL)).length).toBe(0);
    } finally {
      await deactivateInvitationCode();
    }
  });

  test("an invalid Teams token is rejected without a hint about why", async () => {
    const response = await exchange(
      createFakeTeamsToken({ signWithForeignKey: true })
    );

    expect(response.status).toBe(401);
    // The reason belongs in the log, not in the response.
    expect(await response.text()).not.toContain("signature");
  });

  test("a token from another tenant is rejected", async () => {
    const response = await exchange(
      createFakeTeamsToken({
        tid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        email: "outsider@example.com",
      })
    );

    expect(response.status).toBe(401);
    expect((await findUser("outsider@example.com")).length).toBe(0);
  });

  test("a forged pending registration is rejected", async () => {
    // Anyone can post a token; only one this server signed may name an account.
    const response = await completeRegistration({
      pendingRegistrationToken: "made.up.token",
      invitationCode: TEST_CODE,
    });

    expect(response.status).toBe(401);
  });

  test("invitation-code guessing runs out of attempts", async () => {
    await activateInvitationCode();
    try {
      const start = await exchange(
        createFakeTeamsToken({
          oid: "oid-bruteforce",
          email: GATED_BRUTEFORCE_EMAIL,
        })
      );
      const { pendingRegistrationToken } = (await start.json()) as any;

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        const response = await completeRegistration({
          pendingRegistrationToken,
          invitationCode: `guess-${attempt}`,
        });
        statuses.push(response.status);
      }

      // The budget is spent after 10 tries, and the account was never created.
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      expect((await findUser(GATED_BRUTEFORCE_EMAIL)).length).toBe(0);
    } finally {
      await deactivateInvitationCode();
    }
  });

  test("the routes report themselves unavailable while unconfigured", async () => {
    delete process.env.MICROSOFT_CLIENT_ID;

    expect((await exchange(createFakeTeamsToken())).status).toBe(503);
    expect(
      (await completeRegistration({ pendingRegistrationToken: "x" })).status
    ).toBe(503);
  });

  test("a request without a token is a validation error", async () => {
    const response = await app.request("/api/v1/auth/teams/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });
});
