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
import { ISSUER, INTROSPECTION_SECRET, PUBLIC_URL, PRM_PATH } from "./config.ts";

const normalize = (u: string) => (u ?? "").replace(/\/$/, "");

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
    res = await fetch(`${ISSUER}/oauth/introspect`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: any;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!data?.active) return null;

  // Audience: token must target THIS server (or the issuer itself).
  const aud = data.aud;
  const audOk = Array.isArray(aud)
    ? aud.map(normalize).includes(normalize(PUBLIC_URL)) ||
      aud.map(normalize).includes(normalize(ISSUER))
    : normalize(aud) === normalize(PUBLIC_URL) ||
      normalize(aud) === normalize(ISSUER);
  if (!audOk) return null;

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
 * discover the authorization server without us hard-wiring it.
 */
export const unauthorized = (c: any) => {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${PUBLIC_URL}${PRM_PATH}"`,
  );
  return c.json({ error: "invalid_token" }, 401);
};
