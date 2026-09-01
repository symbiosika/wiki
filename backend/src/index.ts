import { defineServer } from "@framework/index";
import * as appDbSchema from "./db/schema";
import defineChatRoutes from "./routes/tenant/[tenantId]/chat";
import defineWikiRoutes from "./routes/tenant/[tenantId]/wiki";
import defineProtocolRoutes from "./routes/tenant/[tenantId]/protocol";
import defineDocumentAssistantRoutes from "./routes/tenant/[tenantId]/document-assistant";
import defineUrlImportRoutes from "./routes/tenant/[tenantId]/url-import";
import definePostProcessingAgentRoutes from "./routes/tenant/[tenantId]/post-processing-agents";
import defineAiTestRoutes from "./routes/tenant/[tenantId]/ai-tests";
import defineCollectionRoutes from "./routes/tenant/[tenantId]/collections";
import defineOrganisationLogoRoutes from "./routes/tenant/[tenantId]/organisation-logo";
import defineAppInfoRoutes from "./routes/public/app-info";
import defineTeamsAuthRoutes from "./routes/public/teams-auth";
import definePublicWikiRoutes from "./routes/public/wiki";
import { tickScheduler, urlImportJobHandler } from "./lib/url-import/runner";
import { aiTestJobHandler } from "./lib/ai-tests/runner";
import { agentPostProcessorResolver } from "./lib/post-processing-agents/processor";
import { websocket } from "./lib/ws/bun-ws";
import * as emailTemplates from "./lib/email-templates";
import {
  isPublicWikiEnabled,
  publicWikiStaticExclusions,
} from "./lib/wiki/public-flag";
import { hasNulByteInPath } from "./lib/http/request-path-guard";
import { startDiagnostics, withDiagnostics } from "./lib/diagnostics";
import { wikiMcpServer } from "./mcp";

/**
 * Operational instrumentation (boot/crash/signal events, heartbeat, slow and
 * failed requests). Started before the server is defined so a crash *during*
 * startup — a bad env var, an unreachable database — is recorded too.
 * See ./lib/diagnostics and docs/bad-gateway-debugging.md.
 */
startDiagnostics();

/**
 * Operator switch for the public documentation surface (PUBLIC_WIKI_ENABLED).
 * Read once here so the API routes and the static bundle can never disagree
 * about whether the feature is on — see ./lib/wiki/public-flag.
 */
const publicWikiEnabled = isPublicWikiEnabled();

const server = defineServer({
  port: 3000,
  jwtExpiresAfter: 60 * 60 * 24 * 30, // 30 days
  magicLinkTtl: 60 * 60 * 24, // 24 hours
  // Display name of the app (used in emails, OAuth metadata, …). Override
  // with the APP_NAME env var, e.g. APP_NAME=Wiki for shorter email names.
  appName: process.env.APP_NAME ?? "Symbiosika Wiki",
  basePath: "/api/v1",
  loginUrl: "/login.html",
  magicLoginVerifyUrl: "/magic-login-verify.html",
  // A social login for an unknown address on an instance that requires an
  // invitation code lands back on our own login page (the framework appends
  // `?provider=…`), where the last step asks for the code instead of shipping
  // a second, separately styled page.
  oauthInvitationCodeUrl: "/login.html",
  staticPublicDataPath: "./public",
  staticPrivateDataPath: "./static",
  // With the public documentation switched off, the bundle stays in the image
  // but stops answering — otherwise a dead page would remain reachable,
  // reporting that the API is unavailable.
  staticPublicExclude: publicWikiStaticExclusions(),
  // The SPA bundle is served without the login redirect so it can also load
  // inside a Microsoft Teams tab, where the document request is cross-site and
  // carries no session cookie — the bundle would be redirected to the login page
  // before its own code ever runs. Only the bundle is opened up: it holds no
  // secrets, and every API route it calls stays authenticated. See
  // ./routes/public/teams-auth and docs/teams-app.md.
  staticPrivateExclude: ["app"],
  // activate additional parameters for PDF parsing
  enablePdfParserExtraction: true,

  // OAuth2 / OIDC Authorization Server. Enabling it mounts all OAuth
  // endpoints (/oauth/authorize, /oauth/token, /oauth/introspect,
  // /oauth/userinfo, /.well-known/*, …). The embedded MCP server below
  // validates its tokens in-process; the introspection endpoint (and its
  // shared secret) stays available for external resource servers.
  oauth2: {
    enabled: true,
    introspectionSecret: process.env.OAUTH_INTROSPECTION_SECRET,
    // The one-time code emailed during MCP/OAuth login (entered in the same
    // browser window). Kept longer than the framework's 10m default so a
    // user has time to fetch it from their inbox.
    emailLoginCodeTtl: 60 * 60, // 1 hour
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
  // The wiki MCP server, embedded behind /mcp at the domain root. The
  // framework handles auth (OAuth2 access tokens with audience check, API
  // tokens), RFC 9728 discovery and CORS; the tools call this app's own HTTP
  // API in-process as the authenticated user. Wire-compatible with the former
  // standalone ../mcp-server — see ./src/mcp.
  mcpServers: [wikiMcpServer],
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
        // Microsoft Teams SSO. Unauthenticated because it establishes the
        // session: the Entra ID token from the Teams host is what authorises
        // the caller.
        defineTeamsAuthRoutes(app);
        // Unauthenticated, read-only view of pages a tenant explicitly
        // published (knowledgeText.publicMode / publicEffective). Deliberately
        // registered here rather than in customHonoAppsWithAuth — see
        // ./routes/public/wiki for why that is safe.
        //
        // Not registering them at all is the real off switch: unregistered
        // routes fall into Hono's 404 and give away nothing about having
        // existed.
        if (publicWikiEnabled) definePublicWikiRoutes(app);
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
        defineCollectionRoutes(app);
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
//
// `fetch` is wrapped so paths that no file can have (a NUL byte, the classic
// `…/etc/passwd%00` scanner probe) are answered 400 here instead of throwing
// deep inside the static handler and being logged as a server error — see
// ./lib/http/request-path-guard.
const guardedFetch = (request: Request, ...rest: unknown[]) =>
  hasNulByteInPath(request.url)
    ? new Response("Bad Request", { status: 400 })
    : (server.fetch as (...args: unknown[]) => Response | Promise<Response>)(
        request,
        ...rest
      );

// The diagnostics wrapper goes outermost, so it sees every request — including
// the ones the guard above refuses and the ones that arrive before the
// framework has registered any route (it waits for the database). That is the
// vantage point a "Bad Gateway" investigation needs; see ./lib/diagnostics.
export default {
  ...server,
  fetch: withDiagnostics(guardedFetch),
  websocket,
};
