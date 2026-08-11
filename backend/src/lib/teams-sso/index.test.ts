import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import {
  FAKE_CLIENT_ID,
  FAKE_TENANT_ID,
  createFakeTeamsToken,
  createUnsignedTeamsToken,
  installFakeEntra,
} from "../../test/fake-entra.test";
import {
  _resetTeamsSsoJwksCache,
  acceptedAudiences,
  isTeamsSsoActive,
  verifyTeamsSsoToken,
} from "./index";

/**
 * Validation of the Entra ID token a Teams tab hands us. Every test here is a
 * way in that must stay closed: the token is the only thing standing between an
 * arbitrary POST and a session.
 *
 * Microsoft is replaced by a local key pair (see test/fake-entra.test.ts), so
 * the real signature check, JWKS fetch and `kid` lookup all run.
 */
const originalEnv = {
  clientId: process.env.MICROSOFT_CLIENT_ID,
  tenantId: process.env.MICROSOFT_TENANT_ID,
  baseUrl: _GLOBAL_SERVER_CONFIG.baseUrl,
};

let entra: ReturnType<typeof installFakeEntra>;

/** Every rejection must be a rejection — never a profile. */
const expectRejected = async (token: string) => {
  let error: unknown;
  try {
    await verifyTeamsSsoToken(token);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(Error);
  return error as Error;
};

describe("Teams SSO token validation", () => {
  beforeAll(() => {
    entra = installFakeEntra();
    _GLOBAL_SERVER_CONFIG.baseUrl = "https://wiki.example.com";
  });

  afterAll(() => {
    entra.restore();
    _GLOBAL_SERVER_CONFIG.baseUrl = originalEnv.baseUrl;
    if (originalEnv.clientId === undefined)
      delete process.env.MICROSOFT_CLIENT_ID;
    else process.env.MICROSOFT_CLIENT_ID = originalEnv.clientId;
    if (originalEnv.tenantId === undefined)
      delete process.env.MICROSOFT_TENANT_ID;
    else process.env.MICROSOFT_TENANT_ID = originalEnv.tenantId;
  });

  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = FAKE_CLIENT_ID;
    process.env.MICROSOFT_TENANT_ID = FAKE_TENANT_ID;
    _resetTeamsSsoJwksCache();
    entra.state.jwksCalls = 0;
  });

  test("a valid token becomes a verified Microsoft profile", async () => {
    const profile = await verifyTeamsSsoToken(
      createFakeTeamsToken({
        oid: "oid-happy",
        email: "Happy.User@Symbiosika.de",
      })
    );

    expect(profile).toEqual({
      // the immutable subject id, i.e. what the browser login stores too
      id: "oid-happy",
      // the address is passed through as-is; normalisation happens where the
      // account is resolved, so the raw claim stays visible for logging
      email: "Happy.User@Symbiosika.de",
      provider: "microsoft",
      firstname: "Teams",
      surname: "User",
    });
  });

  test("Teams SSO is inactive without a configured client id", async () => {
    delete process.env.MICROSOFT_CLIENT_ID;

    expect(isTeamsSsoActive()).toBe(false);
    // fails closed rather than accepting anything while unconfigured
    await expectRejected(createFakeTeamsToken());
  });

  test("both the bare client id and the Application ID URI are accepted", async () => {
    expect(acceptedAudiences()).toEqual([
      FAKE_CLIENT_ID,
      `api://${FAKE_CLIENT_ID}`,
      `api://wiki.example.com/${FAKE_CLIENT_ID}`,
    ]);

    const viaUri = await verifyTeamsSsoToken(
      createFakeTeamsToken({ aud: `api://wiki.example.com/${FAKE_CLIENT_ID}` })
    );
    expect(viaUri.id).toBe("fake-oid-1");
  });

  test("a token for another application is rejected", async () => {
    // The signature is genuine — Entra signed it — but it was issued for a
    // different app. Accepting it would let any Entra app impersonate ours.
    const error = await expectRejected(
      createFakeTeamsToken({ aud: "some-other-app-id" })
    );
    expect(error.message).toContain("verification failed");
  });

  test("a token signed with an unpublished key is rejected", async () => {
    await expectRejected(createFakeTeamsToken({ signWithForeignKey: true }));
  });

  test("an unsigned token (alg: none) is rejected", async () => {
    const error = await expectRejected(createUnsignedTeamsToken());
    expect(error.message).toContain("signature algorithm");
  });

  test("an expired token is rejected", async () => {
    const error = await expectRejected(
      createFakeTeamsToken({ expiresIn: -600 })
    );
    expect(error.message).toContain("verification failed");
  });

  test("a token from another Microsoft tenant is rejected", async () => {
    // The whole point of pinning MICROSOFT_TENANT_ID: without this check every
    // Microsoft 365 user in the world reaches the invitation-code gate.
    const foreignTenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const error = await expectRejected(
      createFakeTeamsToken({ tid: foreignTenant })
    );
    expect(error.message).toContain("another Microsoft tenant");
  });

  test("any tenant is allowed when the directory is not pinned", async () => {
    process.env.MICROSOFT_TENANT_ID = "common";
    const foreignTenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    const profile = await verifyTeamsSsoToken(
      createFakeTeamsToken({ tid: foreignTenant, oid: "oid-multi" })
    );
    expect(profile.id).toBe("oid-multi");
  });

  test("an issuer that does not match the token's tenant is rejected", async () => {
    const error = await expectRejected(
      createFakeTeamsToken({
        iss: "https://login.microsoftonline.com/some-other-tenant/v2.0",
      })
    );
    expect(error.message).toContain("issuer does not match");
  });

  test("the v1 issuer shape is accepted", async () => {
    // Which shape arrives depends on accessTokenAcceptedVersion in the app
    // registration, which is not ours to control.
    const profile = await verifyTeamsSsoToken(
      createFakeTeamsToken({
        iss: `https://sts.windows.net/${FAKE_TENANT_ID}/`,
        oid: "oid-v1",
      })
    );
    expect(profile.id).toBe("oid-v1");
  });

  test("a token without the access_as_user scope is rejected", async () => {
    // e.g. a Graph token the client happened to have lying around
    const error = await expectRejected(
      createFakeTeamsToken({ scp: "User.Read" })
    );
    expect(error.message).toContain("access_as_user");
  });

  test("a token without any scope is rejected", async () => {
    await expectRejected(createFakeTeamsToken({ scp: null }));
  });

  test("a token without a usable e-mail claim is rejected", async () => {
    const error = await expectRejected(createFakeTeamsToken({ email: null }));
    expect(error.message).toContain("no e-mail address");
  });

  test("upn and email serve as fallbacks for the sign-in name", async () => {
    const viaUpn = await verifyTeamsSsoToken(
      createFakeTeamsToken({
        email: null,
        extraClaims: { upn: "upn.user@symbiosika.de" },
      })
    );
    expect(viaUpn.email).toBe("upn.user@symbiosika.de");

    const viaEmail = await verifyTeamsSsoToken(
      createFakeTeamsToken({
        email: null,
        extraClaims: { email: "mail.user@symbiosika.de" },
      })
    );
    expect(viaEmail.email).toBe("mail.user@symbiosika.de");
  });

  test("a token without a user object id is rejected", async () => {
    const error = await expectRejected(
      createFakeTeamsToken({ extraClaims: { oid: undefined }, oid: "" })
    );
    expect(error.message).toContain("user object id");
  });

  test("the display name is split when the dedicated claims are missing", async () => {
    const profile = await verifyTeamsSsoToken(
      createFakeTeamsToken({
        givenName: "",
        familyName: "",
        name: "Ada Lovelace",
      })
    );
    expect({ f: profile.firstname, s: profile.surname }).toEqual({
      f: "Ada",
      s: "Lovelace",
    });
  });

  test("garbage is rejected without reaching the key set", async () => {
    await expectRejected("not-a-token");
    expect(entra.state.jwksCalls).toBe(0);
  });

  test("an unknown signing key id is rejected", async () => {
    const error = await expectRejected(
      createFakeTeamsToken({ kid: "rotated-away" })
    );
    expect(error.message).toContain("signing key");
  });

  test("the key set is fetched once and then reused", async () => {
    await verifyTeamsSsoToken(createFakeTeamsToken());
    await verifyTeamsSsoToken(createFakeTeamsToken());
    await verifyTeamsSsoToken(createFakeTeamsToken());

    expect(entra.state.jwksCalls).toBe(1);
  });
});
