/**
 * Symbiosika Wiki MCP server (OAuth2 resource server).
 *
 * A standalone process (own port) with four jobs:
 *   1. answer unauthenticated requests with 401 + a pointer to the AS,
 *   2. serve resource metadata pointing at the app (AS),
 *   3. validate incoming tokens at the AS (introspection) and enforce audience,
 *   4. serve the MCP tools over Streamable HTTP.
 *
 * Login, consent, token issuance, DCR, JWKS etc. live entirely at the
 * authorization server (the wiki backend). This server issues NO tokens.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import {
  PORT,
  PUBLIC_URL,
  ISSUER,
  SCOPES_SUPPORTED,
  PRM_PATH,
  MCP_RESOURCE,
} from "./config.ts";
import { authenticate, unauthorized } from "./auth.ts";
import { registerAllTools } from "./tools/index.ts";
import pkg from "../package.json";

// ── MCP server + tools ───────────────────────────────────────────────────────
const mcp = new McpServer({ name: "symbiosika-wiki-mcp", version: pkg.version });
registerAllTools(mcp);

// Stateless transport with JSON responses.
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});
await mcp.connect(transport);

// ── HTTP app ─────────────────────────────────────────────────────────────────
const app = new Hono();

// CORS must expose WWW-Authenticate or the client won't see the 401 hint.
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "authorization",
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
    ],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    exposeHeaders: [
      "WWW-Authenticate",
      "mcp-session-id",
      "mcp-protocol-version",
    ],
  }),
);

// Resource metadata (RFC 9728): points the client at the app (AS). Served at
// the root path and at the path-suffixed variant (`…/oauth-protected-resource/mcp`)
// that clients derive for a resource with a path component, e.g. claude.ai.
const resourceMetadata = (c: any) =>
  c.json({
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
  });
app.get(PRM_PATH, resourceMetadata);
app.get(`${PRM_PATH}/mcp`, resourceMetadata);

// AS metadata under the MCP URL: clients that probe {mcp_url}/.well-known/…
// find working endpoints that forward to the app.
app.get("/.well-known/oauth-authorization-server", (c) =>
  c.json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/authorize`,
    token_endpoint: `${PUBLIC_URL}/token`,
    registration_endpoint: `${PUBLIC_URL}/register`,
    revocation_endpoint: `${PUBLIC_URL}/revoke`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  }),
);
app.get("/.well-known/openid-configuration", (c) =>
  c.redirect(`${PUBLIC_URL}/.well-known/oauth-authorization-server`, 302),
);

// Forwards to the app (AS) — no logic of our own.
app.get("/authorize", (c) =>
  c.redirect(`${ISSUER}/oauth/authorize${new URL(c.req.url).search}`, 302),
);

const proxyPost = (path: string) => async (c: any) => {
  const res = await fetch(`${ISSUER}${path}`, {
    method: "POST",
    headers: {
      "content-type":
        c.req.header("content-type") ?? "application/x-www-form-urlencoded",
    },
    body: await c.req.text(),
  });
  const text = await res.text();
  try {
    return c.json(JSON.parse(text), res.status as any);
  } catch {
    return c.body(text, res.status as any);
  }
};
app.post("/register", proxyPost("/oauth/register"));
app.post("/token", proxyPost("/oauth/token"));
app.post("/revoke", proxyPost("/oauth/revoke"));

// The MCP endpoint: authenticate first, then hand off to the transport.
app.all("/mcp", async (c) => {
  const authInfo = await authenticate(c.req.raw);
  if (!authInfo) return unauthorized(c);
  return transport.handleRequest(c.req.raw, { authInfo });
});

// Health + info.
app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) =>
  c.json({
    name: "symbiosika-wiki-mcp",
    version: pkg.version,
    mcp_endpoint: `${PUBLIC_URL}/mcp`,
    authorization_server: ISSUER,
  }),
);

console.log(
  `[symbiosika-wiki-mcp] listening on :${PORT}  ·  mcp=${PUBLIC_URL}/mcp  ·  AS=${ISSUER}`,
);

export default { port: PORT, fetch: app.fetch, idleTimeout: 120 };
