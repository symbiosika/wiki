/**
 * Microsoft Teams SSO: turning a Teams identity into a verified profile.
 *
 * A tab running inside Teams can ask the host for an Entra ID token via
 * `microsoftTeams.authentication.getAuthToken()`. That token is issued *for this
 * application* and signed by Microsoft, which makes it the only trustworthy
 * statement about who is using the tab.
 *
 * What must NOT be trusted: `microsoftTeams.app.getContext()`. Its
 * `userObjectId` / `loginHint` are values the client hands us — anyone can post
 * them to an endpoint. Only the signature check below establishes an identity.
 *
 * The result is a `OAuthProfile`, i.e. exactly what the browser-based Microsoft
 * login produces after its Graph call. Everything downstream — account lookup by
 * `oid`, linking to an account created by magic link, the invitation-code gate,
 * registration — is the framework's existing social-login chain. Teams is
 * another way to arrive at a verified Microsoft identity, not a second account
 * model.
 *
 * Configuration (same variables as the browser login, nothing new):
 *   MICROSOFT_CLIENT_ID     required; the `aud` a Teams token must carry
 *   MICROSOFT_TENANT_ID     optional; a directory GUID pins logins to that
 *                           Entra tenant. Unset or `common`/`organizations`
 *                           accepts any directory — see `assertAllowedTenant`.
 */
import { createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
import type { OAuthProfile } from "@framework/lib/auth/oauth2";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import log from "@framework/lib/log";

/** The scope the Teams client requests on the app's exposed API. */
const REQUIRED_SCOPE = "access_as_user";

/** Tolerated clock difference between us and Entra, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 60;

/** How long a fetched signing-key set is reused. */
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Floor between two fetches for the same directory, for unknown-`kid` refreshes. */
const JWKS_MIN_REFETCH_MS = 5 * 60 * 1000;

/**
 * Directory values that mean "any tenant may sign in". Kept explicit: a typo in
 * `MICROSOFT_TENANT_ID` must not silently widen the login to every Microsoft
 * account in the world, so anything that is not one of these is treated as a
 * pinned directory and compared against the token's `tid`.
 */
const MULTI_TENANT_DIRECTORIES = ["common", "organizations", "consumers"];

export class TeamsSsoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamsSsoError";
  }
}

const clientId = (): string => process.env.MICROSOFT_CLIENT_ID || "";

const configuredDirectory = (): string =>
  (process.env.MICROSOFT_TENANT_ID || "common").trim();

/**
 * Teams SSO rides on the Microsoft app registration of the browser login. It is
 * available exactly when that registration is configured — the client secret is
 * irrelevant here, because no code is exchanged: the token arrives from the
 * Teams host and is only validated.
 */
export const isTeamsSsoActive = (): boolean => clientId() !== "";

/**
 * Audiences a Teams token may carry.
 *
 * Entra issues the token for the resource the Teams client asked for. Depending
 * on how the app registration exposes its API that is either the bare client id
 * or the Application ID URI, so both are accepted — but nothing else, and both
 * are tied to *our* client id.
 */
export const acceptedAudiences = (): string[] => {
  const id = clientId();
  if (!id) return [];

  const audiences = [id, `api://${id}`];
  try {
    const host = new URL(_GLOBAL_SERVER_CONFIG.baseUrl).host;
    if (host) audiences.push(`api://${host}/${id}`);
  } catch {
    // A malformed baseUrl only costs the host-shaped audience; the bare client
    // id keeps working, and a wrong audience fails the verification anyway.
  }
  return audiences;
};

/* ── Signing keys ────────────────────────────────────────────────────────── */

type JwksKey = {
  kid?: string;
  kty?: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
};

type CachedJwks = { keys: JwksKey[]; fetchedAt: number };

const jwksCache = new Map<string, CachedJwks>();

const jwksUrl = (directory: string): string =>
  `https://login.microsoftonline.com/${encodeURIComponent(
    directory
  )}/discovery/v2.0/keys`;

/** Reset the cached signing keys. Only needed by tests. */
export const _resetTeamsSsoJwksCache = (): void => {
  jwksCache.clear();
};

const fetchJwks = async (directory: string): Promise<JwksKey[]> => {
  const response = await fetch(jwksUrl(directory));
  if (!response.ok) {
    throw new TeamsSsoError(
      `Could not load Microsoft signing keys (HTTP ${response.status})`
    );
  }

  const body = (await response.json()) as { keys?: JwksKey[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new TeamsSsoError("Microsoft signing key set is empty");
  }

  jwksCache.set(directory, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
};

/**
 * The signing key for a `kid`.
 *
 * Entra rotates keys, so an unknown `kid` is not an error but a hint that the
 * cache is stale — it triggers one refetch, rate-limited so a stream of tokens
 * with bogus `kid`s cannot turn into a stream of outbound requests.
 */
const getSigningKey = async (
  directory: string,
  kid: string
): Promise<JwksKey> => {
  const cached = jwksCache.get(directory);
  const fresh = cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS;

  let keys = fresh ? cached!.keys : await fetchJwks(directory);
  let key = keys.find((candidate) => candidate.kid === kid);

  if (!key && fresh && Date.now() - cached!.fetchedAt > JWKS_MIN_REFETCH_MS) {
    keys = await fetchJwks(directory);
    key = keys.find((candidate) => candidate.kid === kid);
  }

  if (!key) {
    throw new TeamsSsoError("Unknown token signing key");
  }
  return key;
};

/**
 * Turn a JWKS entry into something `jsonwebtoken` can verify with.
 *
 * The JWK itself is preferred (`n`/`e`); the `x5c` certificate is the fallback
 * for key sets that ship only the chain.
 */
const toPublicKey = (key: JwksKey): string => {
  if (key.kty === "RSA" && key.n && key.e) {
    return createPublicKey({
      key: { kty: "RSA", n: key.n, e: key.e },
      format: "jwk",
    })
      .export({ type: "spki", format: "pem" })
      .toString();
  }

  const cert = key.x5c?.[0];
  if (cert) {
    const wrapped = cert.match(/.{1,64}/g)?.join("\n") ?? cert;
    return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`;
  }

  throw new TeamsSsoError("Unsupported token signing key");
};

/* ── Claims ──────────────────────────────────────────────────────────────── */

type TeamsTokenClaims = {
  oid?: string;
  tid?: string;
  iss?: string;
  aud?: string | string[];
  scp?: string | string[];
  ver?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
};

const decodeHeader = (token: string): { kid?: string; alg?: string } => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") {
    throw new TeamsSsoError("Malformed token");
  }
  return decoded.header;
};

/**
 * Both issuer shapes Entra uses: v2 tokens say `login.microsoftonline.com/<tid>/v2.0`,
 * v1 tokens (`accessTokenAcceptedVersion: 1`, the default for a fresh app
 * registration) say `sts.windows.net/<tid>/`. Which one arrives depends on the
 * app registration, not on us, so both are accepted — but only for the tenant
 * the token claims, which is checked against the configured directory.
 */
const assertIssuerMatchesTenant = (claims: TeamsTokenClaims): void => {
  const { iss, tid } = claims;
  if (!iss || !tid) throw new TeamsSsoError("Token without issuer or tenant");

  const expected = [
    `https://login.microsoftonline.com/${tid}/v2.0`,
    `https://sts.windows.net/${tid}/`,
  ];

  if (!expected.includes(iss)) {
    throw new TeamsSsoError("Token issuer does not match its tenant");
  }
};

/**
 * Keep the login inside the configured Entra directory.
 *
 * Without this, a token from *any* Microsoft directory would pass — the
 * signature is valid for all of them — and every Microsoft 365 user worldwide
 * could reach the invitation-code gate. With a directory GUID configured, only
 * that tenant gets in.
 */
const assertAllowedTenant = (claims: TeamsTokenClaims): void => {
  const directory = configuredDirectory();
  if (MULTI_TENANT_DIRECTORIES.includes(directory.toLowerCase())) return;

  if (claims.tid !== directory) {
    throw new TeamsSsoError("Token was issued for another Microsoft tenant");
  }
};

const assertScope = (claims: TeamsTokenClaims): void => {
  const scopes =
    typeof claims.scp === "string"
      ? claims.scp.split(" ").filter(Boolean)
      : (claims.scp ?? []);

  if (!scopes.includes(REQUIRED_SCOPE)) {
    throw new TeamsSsoError(
      `Token is missing the ${REQUIRED_SCOPE} scope — check the exposed API of the app registration`
    );
  }
};

/**
 * The address to identify the account by.
 *
 * `preferred_username` is what Entra puts the sign-in name in; `upn` and `email`
 * are the older/optional variants. A token without any of them cannot be mapped
 * onto an account (it happens for some guest and service identities), and that
 * has to be said plainly rather than guessed at — the affected user can still
 * sign in through the regular Microsoft login.
 */
const readEmail = (claims: TeamsTokenClaims): string => {
  const candidate = [claims.preferred_username, claims.upn, claims.email].find(
    (value) => typeof value === "string" && value.includes("@")
  );

  if (!candidate) {
    throw new TeamsSsoError(
      "The Microsoft token carries no e-mail address for this user"
    );
  }
  return candidate;
};

/** Split `name` only when the dedicated claims are absent. */
const readName = (
  claims: TeamsTokenClaims
): { firstname: string; surname: string } => {
  if (claims.given_name || claims.family_name) {
    return {
      firstname: claims.given_name ?? "",
      surname: claims.family_name ?? "",
    };
  }

  const name = (claims.name ?? "").trim();
  if (!name) return { firstname: "", surname: "" };

  const separator = name.indexOf(" ");
  if (separator < 0) return { firstname: name, surname: "" };
  return {
    firstname: name.slice(0, separator),
    surname: name.slice(separator + 1).trim(),
  };
};

/* ── Verification ────────────────────────────────────────────────────────── */

/**
 * Validate a Teams SSO token and map it onto a verified Microsoft profile.
 *
 * Throws `TeamsSsoError` for everything that is not a currently valid token for
 * this application: bad signature, wrong audience, wrong tenant, expired,
 * missing scope, unusable claims. Callers must treat every failure the same way
 * — no account, no session.
 */
export const verifyTeamsSsoToken = async (
  token: string
): Promise<OAuthProfile> => {
  if (!isTeamsSsoActive()) {
    throw new TeamsSsoError("Teams SSO is not configured on this server");
  }
  if (!token || typeof token !== "string") {
    throw new TeamsSsoError("No token provided");
  }

  const header = decodeHeader(token);
  if (header.alg !== "RS256") {
    // Entra signs with RS256. Accepting whatever the token names would open the
    // door to `alg: none` and to HMAC verification against a public key.
    throw new TeamsSsoError("Unexpected token signature algorithm");
  }
  if (!header.kid) {
    throw new TeamsSsoError("Token without a signing key id");
  }

  const key = await getSigningKey(configuredDirectory(), header.kid);

  // Non-empty by construction — `isTeamsSsoActive` above guarantees a client id
  // — but the verifier's type wants that spelled out.
  const audiences = acceptedAudiences() as [string, ...string[]];

  let claims: TeamsTokenClaims;
  try {
    claims = jwt.verify(token, toPublicKey(key), {
      algorithms: ["RS256"],
      audience: audiences,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }) as TeamsTokenClaims;
  } catch (err) {
    throw new TeamsSsoError(
      `Token verification failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  assertIssuerMatchesTenant(claims);
  assertAllowedTenant(claims);
  assertScope(claims);

  if (!claims.oid) {
    throw new TeamsSsoError("Token without a user object id");
  }

  const email = readEmail(claims);
  const { firstname, surname } = readName(claims);

  log.debug(`Teams SSO token accepted for ${email} (tenant ${claims.tid})`);

  return {
    // `oid` is the same immutable subject id the browser login stores in
    // `users.extUserId`, so both ways in resolve to one account.
    id: claims.oid,
    email,
    provider: "microsoft",
    firstname,
    surname,
  };
};
