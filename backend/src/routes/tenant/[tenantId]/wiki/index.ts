/**
 * Wiki routes.
 *
 * The wiki itself is powered by the framework's knowledge-text endpoints
 * (/tenant/:tenantId/knowledge/texts...). This file only adds the
 * app-specific convenience endpoint that assembles the sidebar tree
 * (personal / teams / organisation) in a single call.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { describeRoute } from "hono-openapi";
import { resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { buildWikiTree } from "../../../../lib/wiki/tree";

export default function defineWikiRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  const baseRoute = `${API_BASE_PATH}/tenant/:tenantId/wiki`;

  /**
   * GET /tenant/:tenantId/wiki/tree
   * Returns the wiki sidebar tree for the current user, partitioned into
   * personal pages, one section per team, and organisation-wide pages.
   */
  app.get(
    `${baseRoute}/tree`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["wiki"],
      summary: "Get the wiki page tree (personal / teams / organisation)",
      responses: {
        200: {
          description: "The wiki tree",
          content: {
            "application/json": {
              schema: resolver(v.any()),
            },
          },
        },
      },
    }),
    validator("param", v.object({ tenantId: v.pipe(v.string(), v.uuid()) })),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const userId = c.get("usersId");
      try {
        const tree = await buildWikiTree(tenantId, userId);
        return c.json({ success: true, data: tree });
      } catch (error) {
        console.error(
          "Failed to build wiki tree",
          error,
          (error as { cause?: unknown })?.cause
        );
        return c.json({ success: false, error: "Failed to build wiki tree" }, 500);
      }
    }
  );
}
