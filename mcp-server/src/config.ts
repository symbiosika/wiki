/**
 * Central configuration of the MCP server, read exclusively from env vars.
 *
 * The MCP server is an OAuth2 resource server: it issues NO tokens and knows
 * no passwords. It validates incoming bearer tokens at the authorization
 * server (the wiki backend) and enforces that a token was issued for exactly
 * this server (audience check). Login, consent and token issuance all live at
 * the authorization server.
 */

export const PORT = Number(process.env.MCP_PORT || "8787");

/** Canonical URL of THIS server — also the expected token audience. */
export const PUBLIC_URL = (
  process.env.MCP_PUBLIC_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");

/** Base URL of the wiki app (authorization server + resource API). */
export const ISSUER = (
  process.env.OAUTH_ISSUER || "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Base URL of the wiki WEB app — the host a human opens a page on:
 * `<APP_BASE_URL>/tenant/<tenantId>/wiki/<pageId>`. Every page-shaped tool
 * result carries such a `url` (see `page-url.ts`), so a chat client can link
 * straight to the source instead of only knowing an opaque page id.
 *
 * Defaults to the wiki app itself (the backend serves the SPA under the same
 * origin it issues tokens on). Set WIKI_APP_URL only when the UI is reachable
 * under a different host than the API.
 */
export const APP_BASE_URL = (process.env.WIKI_APP_URL || ISSUER).replace(
  /\/$/,
  "",
);

/** Shared secret for /oauth/introspect. Must match the backend's value. */
export const INTROSPECTION_SECRET =
  process.env.OAUTH_INTROSPECTION_SECRET || "";

/**
 * Fallback tenant (organisation) id, used only if a validated token carries no
 * `tenant` binding. Normally the token's tenant wins.
 */
export const FALLBACK_TENANT_ID = process.env.WIKI_TENANT_ID || "";

/**
 * Scopes this resource server advertises in its metadata. Clients (e.g.
 * claude.ai) request exactly what is advertised here, so every scope the wiki
 * tools rely on MUST be listed — `user:read` powers `list_organisations`
 * (GET /api/v1/user/tenants), which 403s with "Missing required scope:
 * user:read" if it is omitted. Keep this in sync with the backend's
 * `dcrDefaultScopes`.
 */
export const SCOPES_SUPPORTED = [
  "openid",
  "profile",
  "email",
  "knowledge:read",
  "knowledge:write",
  "user:read",
];

/** Path of the protected-resource metadata (RFC 9728). */
export const PRM_PATH = "/.well-known/oauth-protected-resource";

/**
 * Canonical resource identifier of the MCP endpoint (RFC 8707 / RFC 9728).
 * Clients like claude.ai send exactly this URL as the `resource` parameter and
 * expect it back in the protected-resource metadata.
 */
export const MCP_RESOURCE = `${PUBLIC_URL}/mcp`;

/** API prefix of the wiki app. */
export const API_BASE_PATH = "/api/v1";
