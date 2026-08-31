/**
 * The Symbiosika-Wiki MCP server, embedded in the backend.
 *
 * This is the `mcpServers` entry for `defineServer()`: the framework mounts
 * it at `/mcp` (domain root), handles OAuth2/API-token authentication, the
 * RFC 9728 discovery and CORS, and calls the tool handlers with an
 * authenticated context whose `fetchApi` dispatches against this very app —
 * in process, no network, all route-level permission checks intact.
 *
 * The server previously ran as a standalone process (../../../mcp-server,
 * reachable on its own domain). Everything a client sees — server name,
 * version, instructions, tool names and schemas, scopes — is kept identical,
 * so existing connectors keep working once the old domain redirects here.
 *
 * Every tool carries MCP tool annotations (readOnlyHint, destructiveHint,
 * idempotentHint, openWorldHint) so clients can tell reading apart from
 * writing before they call: `READ_ONLY` for everything that only reads,
 * `writeAnnotations()` for the writing tools (see `tools/_define.ts`).
 */

import type { McpServerDefinition } from "@framework/types";
import { SERVER_INSTRUCTIONS } from "./instructions";
import { identityTools } from "./tools/identity";
import { discoveryTools } from "./tools/discovery";
import { readTools } from "./tools/read";
import { writeTools } from "./tools/write";
import { collectionTools } from "./tools/collections";
import { appUiTools, appResources } from "./tools/app-ui";

/**
 * Scopes advertised in the protected-resource metadata. Clients (e.g.
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

export const wikiMcpServer: McpServerDefinition = {
  path: "/mcp",
  name: "symbiosika-wiki-mcp",
  version: "0.3.0",
  instructions: SERVER_INSTRUCTIONS,
  scopesSupported: SCOPES_SUPPORTED,
  tools: [
    ...identityTools,
    ...discoveryTools,
    ...readTools,
    ...writeTools,
    ...collectionTools,
    ...appUiTools,
  ],
  resources: appResources,
};
