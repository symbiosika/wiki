/**
 * A stand-in for Entra ID, so the Teams SSO path can be tested end to end
 * without leaving the process.
 *
 * The real thing does two things we depend on: it publishes RSA signing keys at
 * a discovery URL, and it hands out tokens signed with them. Both are
 * reproduced here with a locally generated key pair — the production code is
 * exercised unchanged, including the JWKS fetch, the `kid` lookup and the
 * signature check. Nothing is mocked inside the module under test.
 *
 * Lives in a `.test.ts` file on purpose: it is test support and must never be
 * bundled into the server (same convention as `framework/src/test/*`).
 */
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";

export const FAKE_TENANT_ID = "11111111-2222-3333-4444-555555555555";
export const FAKE_CLIENT_ID = "99999999-8888-7777-6666-555555555555";
export const FAKE_KID = "fake-entra-key-1";

type KeyPair = { privateKey: KeyObject; publicKey: KeyObject };

const keyPair: KeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** A second, unpublished key — for tokens signed by "someone else". */
const foreignKeyPair: KeyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const jwk = (pair: KeyPair, kid: string) => ({
  ...(pair.publicKey.export({ format: "jwk" }) as Record<string, unknown>),
  kid,
  use: "sig",
  alg: "RS256",
});

/** What the discovery endpoint answers with. */
export const fakeJwks = () => ({ keys: [jwk(keyPair, FAKE_KID)] });

export type FakeTokenOptions = {
  oid?: string;
  email?: string | null;
  tid?: string;
  aud?: string;
  iss?: string;
  scp?: string | null;
  name?: string;
  givenName?: string;
  familyName?: string;
  /** Seconds from now; negative produces an expired token. */
  expiresIn?: number;
  /** Sign with a key that is not in the published key set. */
  signWithForeignKey?: boolean;
  /** Claim a `kid` the key set does not contain. */
  kid?: string;
  extraClaims?: Record<string, unknown>;
};

/**
 * Mint a token that looks like the one `getAuthToken()` returns in a Teams tab.
 * Every field an assertion may need to break is overridable.
 */
export const createFakeTeamsToken = (options: FakeTokenOptions = {}): string => {
  const {
    oid = "fake-oid-1",
    email = "teams.user@symbiosika.de",
    tid = FAKE_TENANT_ID,
    aud = FAKE_CLIENT_ID,
    iss = `https://login.microsoftonline.com/${tid}/v2.0`,
    scp = "access_as_user",
    name,
    givenName = "Teams",
    familyName = "User",
    expiresIn = 3600,
    signWithForeignKey = false,
    kid = FAKE_KID,
    extraClaims = {},
  } = options;

  const now = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = {
    oid,
    tid,
    iss,
    aud,
    ver: "2.0",
    iat: now,
    nbf: now,
    exp: now + expiresIn,
    ...(scp === null ? {} : { scp }),
    ...(email === null ? {} : { preferred_username: email }),
    ...(name ? { name } : {}),
    ...(givenName ? { given_name: givenName } : {}),
    ...(familyName ? { family_name: familyName } : {}),
    ...extraClaims,
  };

  return jwt.sign(
    claims,
    (signWithForeignKey ? foreignKeyPair : keyPair).privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string,
    { algorithm: "RS256", keyid: kid, noTimestamp: true }
  );
};

/** A token whose header says `alg: none` — the classic downgrade attempt. */
export const createUnsignedTeamsToken = (): string => {
  const header = { alg: "none", typ: "JWT", kid: FAKE_KID };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    oid: "fake-oid-1",
    tid: FAKE_TENANT_ID,
    iss: `https://login.microsoftonline.com/${FAKE_TENANT_ID}/v2.0`,
    aud: FAKE_CLIENT_ID,
    scp: "access_as_user",
    preferred_username: "attacker@symbiosika.de",
    exp: now + 3600,
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode(header)}.${encode(payload)}.`;
};

/**
 * Route every outbound request to the fake directory, and count the discovery
 * calls so the caching behaviour can be asserted. Any other URL throws — a test
 * that reaches the real internet is a broken test.
 */
export const installFakeEntra = () => {
  const realFetch = globalThis.fetch;
  const state = { jwksCalls: 0 };

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";

    if (url.includes("/discovery/v2.0/keys")) {
      state.jwksCalls += 1;
      return Response.json(fakeJwks());
    }

    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  return {
    state,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
};
