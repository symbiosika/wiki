import { defineServer } from "@framework/index";
import * as appDbSchema from "./db/schema";
import defineChatRoutes from "./routes/tenant/[tenantId]/chat";
import defineWikiRoutes from "./routes/tenant/[tenantId]/wiki";

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
  customHonoAppsWithAuth: [
    {
      baseRoute: "",
      app: (app) => {
        defineChatRoutes(app);
        defineWikiRoutes(app);
      },
    },
  ],
});

export default server;
