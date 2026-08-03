/**
 * Microsoft 365 / Entra ID login ("Mit Microsoft anmelden").
 *
 * Why this lives in the app and not in the framework: the framework ships an
 * OAuth login (`/api/v1/user/auth/microsoft`, see
 * framework/src/lib/auth/oauth2.ts), but it looks users up by
 * `email + provider` and inserts a *new* row when no `provider = "microsoft"`
 * match exists. Since `users.email` carries a unique index, every account that
 * was created by a magic link (provider `local` — i.e. all of ours) would fail
 * that insert. It also hands the fresh session JWT back through a URL, while
 * this app authenticates with the HttpOnly `jwt` cookie.
 *
 * So this module implements the authorization-code flow (with PKCE and a
 * `state`/verifier transaction cookie) itself and finishes it the way every
 * other login here finishes: by looking the user up **by e-mail only** and
 * minting a normal framework session.
 *
 * Configuration (all optional — without them the feature is simply off):
 *   MICROSOFT_CLIENT_ID      Application (client) ID of the Entra app
 *   MICROSOFT_CLIENT_SECRET  client secret of that app
 *   MICROSOFT_TENANT_ID      directory to authenticate against; defaults to
 *                            `common` (any Microsoft account). Use the tenant
 *                            GUID or `organizations` to restrict it.
 *
 * The Entra app registration needs this exact redirect URI (web platform):
 *   <BASE_URL>/api/v1/auth/microsoft/callback
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { getDb } from "@framework/lib/db/db-connection";
import { users } from "@framework/lib/db/schema/users";
import {
  createMagicLinkToken,
  verifyMagicLink,
} from "@framework/lib/auth/magic-link";
import log from "@framework/lib/log";

/** Path (below the API base path) the Entra app must redirect back to. */
export const MICROSOFT_CALLBACK_PATH = "/auth/microsoft/callback";

/** Cookie holding the pending login transaction (state + PKCE verifier). */
export const MICROSOFT_TX_COOKIE = "ms_oauth_tx";

/** How long a started Microsoft login may take before it must be restarted. */
export const MICROSOFT_TX_TTL_SECONDS = 10 * 60;

const clientId = () => process.env.MICROSOFT_CLIENT_ID ?? "";
const clientSecret = () => process.env.MICROSOFT_CLIENT_SECRET ?? "";
const directory = () => process.env.MICROSOFT_TENANT_ID || "common";

const authority = () =>
  `https://login.microsoftonline.com/${encodeURIComponent(directory())}/oauth2/v2.0`;

/**
 * Is the Microsoft login usable on this instance? Both halves of the client
 * credentials are needed — the framework's public `/user/oauth-providers`
 * endpoint only looks at the client ID, so a half-configured instance would
 * advertise a button that cannot work.
 */
export const isMicrosoftLoginEnabled = (): boolean =>
  clientId() !== "" && clientSecret() !== "";

/** Absolute redirect URI, must match the Entra app registration verbatim. */
export const getMicrosoftRedirectUri = (): string =>
  `${_GLOBAL_SERVER_CONFIG.baseUrl}${_GLOBAL_SERVER_CONFIG.basePath.replace(/\/$/, "")}${MICROSOFT_CALLBACK_PATH}`;

const base64url = (input: Buffer): string =>
  input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Random, URL-safe value used for `state` and the PKCE verifier. */
export const createRandomToken = (bytes = 32): string =>
  base64url(randomBytes(bytes));

/** S256 code challenge for a PKCE verifier. */
export const createCodeChallenge = (verifier: string): string =>
  base64url(createHash("sha256").update(verifier).digest());

/**
 * Constant-time comparison of the `state` we issued against the one that came
 * back, so a mismatch cannot be probed byte by byte.
 */
export const isSameState = (expected: string, received: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};

export type MicrosoftLoginTransaction = {
  state: string;
  verifier: string;
  /** Where to send the user after a successful login (app-relative path). */
  redirect: string;
};

/** Serialise the pending transaction for the HttpOnly cookie. */
export const encodeTransaction = (tx: MicrosoftLoginTransaction): string =>
  base64url(Buffer.from(JSON.stringify(tx), "utf8"));

/** Counterpart of `encodeTransaction`; returns null for anything unusable. */
export const decodeTransaction = (
  value: string | undefined
): MicrosoftLoginTransaction | null => {
  if (!value) return null;
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      typeof parsed?.state !== "string" ||
      typeof parsed?.verifier !== "string" ||
      typeof parsed?.redirect !== "string" ||
      parsed.state === "" ||
      parsed.verifier === ""
    ) {
      return null;
    }
    return {
      state: parsed.state,
      verifier: parsed.verifier,
      redirect: parsed.redirect,
    };
  } catch {
    return null;
  }
};

/**
 * Only same-origin, app-relative targets may be redirected to after login —
 * otherwise the login endpoint would double as an open redirect. `//host` is a
 * protocol-relative URL and therefore off-site, despite starting with a slash.
 */
export const DEFAULT_LOGIN_REDIRECT = "/static/app/";

export const sanitizeRedirect = (redirect: string | undefined): string => {
  if (!redirect) return DEFAULT_LOGIN_REDIRECT;
  if (!redirect.startsWith("/") || redirect.startsWith("//")) {
    return DEFAULT_LOGIN_REDIRECT;
  }
  return redirect;
};

/** URL the browser is sent to in order to pick a Microsoft account. */
export const buildMicrosoftAuthorizeUrl = (params: {
  state: string;
  codeChallenge: string;
}): string => {
  const query = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    response_mode: "query",
    redirect_uri: getMicrosoftRedirectUri(),
    scope: "openid profile email User.Read",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authority()}/authorize?${query.toString()}`;
};

/** Exchange the authorization code for an access token. */
export const exchangeMicrosoftCode = async (
  code: string,
  codeVerifier: string
): Promise<string> => {
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: getMicrosoftRedirectUri(),
      scope: "openid profile email User.Read",
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(
      `Microsoft token exchange failed: ${payload.error ?? response.status} ${
        payload.error_description ?? ""
      }`.trim()
    );
  }

  return payload.access_token;
};

export type MicrosoftProfile = {
  email: string;
  firstname: string;
  surname: string;
};

/**
 * Read the signed-in identity from Microsoft Graph. Work/school accounts may
 * expose the address only as `userPrincipalName`, so both fields are checked.
 */
export const fetchMicrosoftProfile = async (
  accessToken: string
): Promise<MicrosoftProfile> => {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    mail?: string | null;
    userPrincipalName?: string | null;
    givenName?: string | null;
    surname?: string | null;
    error?: { message?: string };
  };

  if (!response.ok || payload.error) {
    throw new Error(
      `Microsoft Graph request failed: ${payload.error?.message ?? response.status}`
    );
  }

  const email = (payload.mail || payload.userPrincipalName || "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) {
    throw new Error("Microsoft account has no usable e-mail address");
  }

  return {
    email,
    firstname: payload.givenName ?? "",
    surname: payload.surname ?? "",
  };
};

/**
 * Turn a Microsoft-verified identity into a framework session.
 *
 * Deliberately built on the magic-link primitives instead of a hand-rolled
 * user insert: `createMagicLinkToken(…, createUserIfMissing)` already resolves
 * the account **by e-mail alone**, enforces the invitation-code rules, accepts
 * pending tenant invitations and runs the post-register actions, and
 * `verifyMagicLink` mints the revocable session JWT. The token never leaves the
 * server — it is created and redeemed within this call.
 *
 * Microsoft has asserted the address, so the account is marked verified. That
 * matters for users who signed up via magic link and never clicked a
 * verification mail.
 */
export const signInWithMicrosoftProfile = async (
  profile: MicrosoftProfile
): Promise<{ token: string; userId: string }> => {
  const token = await createMagicLinkToken(
    profile.email,
    "login",
    true,
    undefined,
    undefined,
    profile.firstname,
    profile.surname
  );

  const { user, token: sessionToken } = await verifyMagicLink(token);

  await getDb()
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, user.id));

  log.info(`Microsoft login for user ${user.id}`);

  return { token: sessionToken, userId: user.id };
};
