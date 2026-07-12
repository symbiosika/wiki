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
