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

/** Shared secret for /oauth/introspect. Must match the backend's value. */
export const INTROSPECTION_SECRET =
  process.env.OAUTH_INTROSPECTION_SECRET || "";

/**
 * Fallback tenant (organisation) id, used only if a validated token carries no
 * `tenant` binding. Normally the token's tenant wins.
 */
export const FALLBACK_TENANT_ID = process.env.WIKI_TENANT_ID || "";

/** Scopes this resource server advertises in its metadata. */
export const SCOPES_SUPPORTED = [
  "openid",
  "profile",
  "email",
  "knowledge:read",
  "knowledge:write",
];

/**
 * Canonical resource identifier of the MCP endpoint (RFC 8707 / RFC 9728).
 * Clients like claude.ai send exactly this URL as the `resource` parameter and
 * expect it back in the protected-resource metadata.
 */
export const MCP_RESOURCE = `${PUBLIC_URL}/mcp`;

/** Path of the protected-resource metadata (RFC 9728). */
export const PRM_PATH = "/.well-known/oauth-protected-resource";

/** API prefix of the wiki app. */
export const API_BASE_PATH = "/api/v1";
