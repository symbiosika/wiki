/**
 * Public app-info route.
 *
 *   GET /app-info   display name (and optional logo URL) of this installation
 *
 * Deliberately unauthenticated: the static auth pages (login, logout, verify
 * mail, …) render the app name before anyone is signed in. Only values that are
 * public anyway are exposed — the name comes from `appName` in `defineServer`
 * (APP_NAME env var), the logo URL from `logoUrl`.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { describeRoute, resolver } from "hono-openapi";
import * as v from "valibot";

const appInfoResponse = v.object({
  appName: v.string(),
  logoUrl: v.optional(v.string()),
});

export default function defineAppInfoRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  app.get(
    `${API_BASE_PATH}/app-info`,
    describeRoute({
      tags: ["app-info"],
      summary: "Public display name of this installation",
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": { schema: resolver(appInfoResponse) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(
        {
          appName: _GLOBAL_SERVER_CONFIG.appName,
          ...(_GLOBAL_SERVER_CONFIG.logoUrl
            ? { logoUrl: _GLOBAL_SERVER_CONFIG.logoUrl }
            : {}),
        },
        200,
        // static per deployment; a short cache keeps the login page snappy
        { "Cache-Control": "public, max-age=300" }
      );
    }
  );
}
