import { defineServer } from "@framework/index";
import * as appDbSchema from "./db/schema";
import defineChatRoutes from "./routes/tenant/[tenantId]/chat";
import defineWikiRoutes from "./routes/tenant/[tenantId]/wiki";
import defineProtocolRoutes from "./routes/tenant/[tenantId]/protocol";
import defineDocumentAssistantRoutes from "./routes/tenant/[tenantId]/document-assistant";
import defineUrlImportRoutes from "./routes/tenant/[tenantId]/url-import";
import definePostProcessingAgentRoutes from "./routes/tenant/[tenantId]/post-processing-agents";
import { tickScheduler, urlImportJobHandler } from "./lib/url-import/runner";
import { agentPostProcessorResolver } from "./lib/post-processing-agents/processor";
import { websocket } from "./lib/ws/bun-ws";

const server = defineServer({
  port: 3000,
  jwtExpiresAfter: 60 * 60 * 24 * 30, // 30 days
  appName: "Symbiosika Wiki",
  basePath: "/api/v1",
  loginUrl: "/login.html",
  magicLoginVerifyUrl: "/magic-login-verify.html",
  staticPublicDataPath: "./public",
  staticPrivateDataPath: "./static",
  // OAuth2 / OIDC Authorization Server. Enabling it mounts all OAuth
  // endpoints (/oauth/authorize, /oauth/token, /oauth/introspect,
  // /oauth/userinfo, /.well-known/*, …). The standalone MCP server in
  // ../mcp-server acts as an OAuth2 resource server: it validates the
  // bearer tokens minted here via /oauth/introspect using the same
  // shared secret. The MCP server issues no tokens of its own.
  oauth2: {
    enabled: true,
    introspectionSecret: process.env.OAUTH_INTROSPECTION_SECRET,
  },
  customDbSchema: {
    ...appDbSchema,
  },
  // Resolve tenant-managed post-processing agents named `agent:<uuid>` on
  // import. A single resolver keeps them out of the global registry (no
  // cross-tenant leakage) and needs no registry mutation on CRUD; the built
  // processor is tenant-safe (loads the agent scoped to the importing tenant).
  customPostProcessorResolvers: [agentPostProcessorResolver],
  customHonoAppsWithAuth: [
    {
      baseRoute: "",
      app: (app) => {
        defineChatRoutes(app);
        defineWikiRoutes(app);
        defineProtocolRoutes(app);
        defineDocumentAssistantRoutes(app);
        defineUrlImportRoutes(app);
        definePostProcessingAgentRoutes(app);
      },
    },
  ],
  // durable async execution of URL-import runs (survives restarts)
  jobHandlers: [urlImportJobHandler],
  // master tick: every minute, enqueue runs for jobs whose cron is due
  customCronJobs: [
    {
      name: "url-import-scheduler",
      schedule: "* * * * *",
      handler: () => tickScheduler(),
    },
  ],
});

// `defineServer` returns a Bun.serve config (`{ fetch, port, … }`) but is itself
// WebSocket-agnostic. Adding the `websocket` handler here makes Bun dispatch
// socket events to the handlers registered by `upgradeWebSocket` (see the
// protocol realtime route). Both halves come from the same shared instance.
export default {
  ...server,
  websocket,
};
