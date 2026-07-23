/**
 * Token validation — the only "auth code" the resource server itself writes.
 * Two checks, both essential:
 *
 *   1. Introspection at the authorization server (token valid & active?)
 *   2. Audience check (was the token issued for exactly THIS server?)
 *
 * The audience check is the confused-deputy protection: it prevents a token
 * issued for server X from being replayed against server Y.
 */

import type { AuthInfo } from "@modelcontextprotocol/server";
import {
  ISSUER,
  INTROSPECTION_SECRET,
  PUBLIC_URL,
  PRM_PATH,
  MCP_RESOURCE,
  FALLBACK_TENANT_ID,
} from "./config.ts";

/**
 * Canonicalize a URL for audience comparison (RFC 8707): lowercase scheme and
 * host, drop default ports and trailing slashes. Falls back to plain
 * trailing-slash stripping for non-URL values.
 */
const canonical = (u: string): string => {
  try {
    const url = new URL(u ?? "");
    const port =
      url.port &&
      !(
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      )
        ? `:${url.port}`
        : "";
    const path = url.pathname.replace(/\/$/, "");
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return (u ?? "").replace(/\/$/, "");
  }
};

/** Log the rejection reason and return null — no silent auth failures. */
const deny = (reason: string): null => {
  console.warn(`[symbiosika-wiki-mcp] token rejected: ${reason}`);
  return null;
};

/**
 * Validate the bearer token from the Authorization header. On success returns
 * an `AuthInfo` (token, clientId, scopes, sub, tenant), otherwise `null`.
 *
 * Two credential types are accepted, tried in order:
 *   1. OAuth2 access tokens issued by the authorization server (the normal flow
 *      used by interactive hosts like claude.ai), validated via introspection.
 *   2. Framework API tokens — long-lived, revocable, per-tenant credentials
 *      minted at `POST /api/v1/user/api-tokens`. These are the credential for
 *      non-interactive hosts (ElevenLabs, n8n, …) that cannot run the OAuth2
 *      authorization-code flow but can send a static header.
 *
 * The token kind is recorded on `extra.kind` so `callApi` can forward the
 * credential to the app the way the app expects it (Bearer vs. X-API-KEY).
 */
export async function authenticate(req: Request): Promise<AuthInfo | null> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!token) return null;

  return (await introspectOAuthToken(token)) ?? (await validateApiToken(token));
}

/**
 * Validate an OAuth2 access token via introspection + audience check. Returns
 * `null` (quietly, for a merely inactive token — it may be an API token instead)
 * or `AuthInfo` on success. Genuine misconfiguration is logged.
 */
async function introspectOAuthToken(
  token: string,
): Promise<AuthInfo | null> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (INTROSPECTION_SECRET) {
    headers.authorization = `Bearer ${INTROSPECTION_SECRET}`;
  }

  let res: Response;
  try {
    res = await fetch(`${ISSUER}/oauth/introspect`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ token }).toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deny(
      `introspection at ${ISSUER}/oauth/introspect unreachable: ${message}`,
    );
  }
  if (!res.ok) {
    return deny(
      `introspection returned HTTP ${res.status} (check OAUTH_INTROSPECTION_SECRET)`,
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return deny("introspection returned invalid JSON");
  }
  // Not an active OAuth token — fall through to the API-token path silently.
  if (!data?.active) return null;

  // Audience: the token must target THIS server. Accepted values: the MCP
  // endpoint URL (RFC 8707 resource), the server origin, or the issuer itself
  // (legacy tokens minted without a resource indicator).
  const accepted = [MCP_RESOURCE, PUBLIC_URL, ISSUER].map(canonical);
  const audList = (Array.isArray(data.aud) ? data.aud : [data.aud]).map(
    canonical,
  );
  if (!audList.some((a: string) => accepted.includes(a))) {
    return deny(
      `audience mismatch: token aud=${JSON.stringify(data.aud)}, accepted=${JSON.stringify([MCP_RESOURCE, PUBLIC_URL, ISSUER])}`,
    );
  }

  return {
    token,
    clientId: data.client_id ?? "",
    scopes:
      typeof data.scope === "string"
        ? data.scope.split(" ").filter(Boolean)
        : [],
    extra: { sub: data.sub, tenant: data.tenant, kind: "oauth" },
  } as AuthInfo;
}

/**
 * Validate a framework API token. The app accepts API tokens on any
 * authenticated endpoint via the `X-API-KEY` header (it exchanges them for a
 * short-lived JWT server-side), so we probe the userinfo endpoint with the
 * token there: HTTP 200 means the token is valid and un-expired.
 *
 * The token's tenant is bound server-side; here we resolve the organisation
 * from `WIKI_TENANT_ID` (single-org deployment). Returns `AuthInfo` on success
 * or `null`.
 */
async function validateApiToken(token: string): Promise<AuthInfo | null> {
  let res: Response;
  try {
    res = await fetch(`${ISSUER}/oauth/userinfo`, {
      headers: { "X-API-KEY": token },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deny(
      `API-token validation at ${ISSUER}/oauth/userinfo unreachable: ${message}`,
    );
  }
  if (!res.ok) {
    // Neither an OAuth token nor a valid API token.
    return deny("token rejected (not an active OAuth or API token)");
  }

  let me: any;
  try {
    me = await res.json();
  } catch {
    return deny("userinfo returned invalid JSON");
  }
  if (!me?.sub) return deny("userinfo returned no subject");

  return {
    token,
    clientId: "api-token",
    scopes: [],
    extra: {
      sub: me.sub,
      tenant: FALLBACK_TENANT_ID || undefined,
      kind: "api",
    },
  } as AuthInfo;
}

/**
 * 401 response pointing at the resource metadata. This lets the MCP client
 * discover the authorization server without us hard-wiring it. The pointer
 * targets the path-suffixed metadata variant (`…/oauth-protected-resource/mcp`)
 * that clients derive for a resource with a path component (e.g. claude.ai).
 */
export const unauthorized = (c: any) => {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${PUBLIC_URL}${PRM_PATH}/mcp"`,
  );
  return c.json({ error: "invalid_token" }, 401);
};
