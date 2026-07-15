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
  INTROSPECTION_URL,
  INTROSPECTION_TIMEOUT_MS,
  INTROSPECTION_SECRET,
  PUBLIC_URL,
  PRM_PATH,
  MCP_RESOURCE,
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
 */
export async function authenticate(req: Request): Promise<AuthInfo | null> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!token) return null;

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (INTROSPECTION_SECRET) {
    headers.authorization = `Bearer ${INTROSPECTION_SECRET}`;
  }

  let res: Response;
  try {
    res = await fetch(`${INTROSPECTION_URL}/oauth/introspect`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ token }).toString(),
      // Fail fast: a container that can't reach the backend (hairpin NAT /
      // split-horizon DNS) must not hang the request until the upstream proxy
      // returns a 504 — turn it into a clean, logged 401 instead.
      signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deny(
      `introspection at ${INTROSPECTION_URL}/oauth/introspect unreachable ` +
        `(timeout ${INTROSPECTION_TIMEOUT_MS}ms? check OAUTH_INTROSPECTION_URL ` +
        `is reachable from this container): ${message}`,
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
  if (!data?.active) {
    return deny("token inactive (expired, revoked or unknown)");
  }

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
    extra: { sub: data.sub, tenant: data.tenant },
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
