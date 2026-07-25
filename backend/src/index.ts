import { defineServer } from "@framework/index";
import * as appDbSchema from "./db/schema";
import defineChatRoutes from "./routes/tenant/[tenantId]/chat";
import defineWikiRoutes from "./routes/tenant/[tenantId]/wiki";
import defineProtocolRoutes from "./routes/tenant/[tenantId]/protocol";
import defineDocumentAssistantRoutes from "./routes/tenant/[tenantId]/document-assistant";
import defineUrlImportRoutes from "./routes/tenant/[tenantId]/url-import";
import definePostProcessingAgentRoutes from "./routes/tenant/[tenantId]/post-processing-agents";
import defineAiTestRoutes from "./routes/tenant/[tenantId]/ai-tests";
import defineOrganisationLogoRoutes from "./routes/tenant/[tenantId]/organisation-logo";
import defineAppInfoRoutes from "./routes/public/app-info";
import { tickScheduler, urlImportJobHandler } from "./lib/url-import/runner";
import { aiTestJobHandler } from "./lib/ai-tests/runner";
import { agentPostProcessorResolver } from "./lib/post-processing-agents/processor";
import { websocket } from "./lib/ws/bun-ws";
import * as emailTemplates from "./lib/email-templates";

const server = defineServer({
  port: 3000,
  jwtExpiresAfter: 60 * 60 * 24 * 30, // 30 days
  // Display name of the app (used in emails, OAuth metadata, …). Override
  // with the APP_NAME env var, e.g. APP_NAME=Wiki for shorter email names.
  appName: process.env.APP_NAME ?? "Symbiosika Wiki",
  basePath: "/api/v1",
  loginUrl: "/login.html",
  magicLoginVerifyUrl: "/magic-login-verify.html",
  staticPublicDataPath: "./public",
  staticPrivateDataPath: "./static",
  // activate additional parameters for PDF parsing
  enablePdfParserExtraction: true,

  // OAuth2 / OIDC Authorization Server. Enabling it mounts all OAuth
  // endpoints (/oauth/authorize, /oauth/token, /oauth/introspect,
  // /oauth/userinfo, /.well-known/*, …). The standalone MCP server in
  // ../mcp-server acts as an OAuth2 resource server: it validates the
  // bearer tokens minted here via /oauth/introspect using the same
  // shared secret. The MCP server issues no tokens of its own.
  oauth2: {
    enabled: true,
    introspectionSecret: process.env.OAUTH_INTROSPECTION_SECRET,
    // Scopes granted to dynamically registered clients (RFC 7591) that omit
    // `scope` in their registration request — e.g. the claude.ai MCP
    // connector. Kept narrow: only identity plus the knowledge scopes the
    // wiki MCP server actually needs. Must cover at least the
    // `scopes_supported` advertised by the MCP resource metadata, otherwise
    // the client's authorize request fails with `invalid_scope`.
    dcrDefaultScopes: [
      "openid",
      "profile",
      "email",
      "knowledge:read",
      "knowledge:write",
      "knowledge-manage:read",
      "knowledge-manage:write",
      "user:read",
    ],
  },
  customDbSchema: {
    ...appDbSchema,
  },
  // Clean, minimal transactional emails (see ./lib/email-templates). These
  // override the framework defaults: centred logo, one heading, one button,
  // no coloured background. Kept bilingual (German first, English below).
  emailTemplates: {
    magicLink: emailTemplates.magicLink,
    emailLoginCode: emailTemplates.emailLoginCode,
    verifyEmail: emailTemplates.verifyEmail,
    resetPassword: emailTemplates.resetPassword,
    resetPasswordWelcome: emailTemplates.resetPasswordWelcome,
    inviteToOrganization: emailTemplates.inviteToOrganization,
    inviteToOrganizationWhenUserExists:
      emailTemplates.inviteToOrganizationWhenUserExists,
  },
  // Resolve tenant-managed post-processing agents named `agent:<uuid>` on
  // import. A single resolver keeps them out of the global registry (no
  // cross-tenant leakage) and needs no registry mutation on CRUD; the built
  // processor is tenant-safe (loads the agent scoped to the importing tenant).
  customPostProcessorResolvers: [agentPostProcessorResolver],
  // Public, unauthenticated routes. Used by the static auth pages in ./public,
  // which need the app name before a user is signed in.
  customHonoApps: [
    {
      baseRoute: "",
      app: (app) => {
        defineAppInfoRoutes(app);
      },
    },
  ],
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
        defineAiTestRoutes(app);
        defineOrganisationLogoRoutes(app);
      },
    },
  ],
  // durable async execution of URL-import + AI-test runs (survives restarts)
  jobHandlers: [urlImportJobHandler, aiTestJobHandler],
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
