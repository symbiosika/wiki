/**
 * Organisation logo routes.
 *
 *   GET    /tenant/:tenantId/logo         get the raw logo image (tenant members)
 *   GET    /tenant/:tenantId/logo/info    existence + updatedAt (tenant members)
 *   POST   /tenant/:tenantId/logo         upload / replace the logo (admins/owners)
 *   DELETE /tenant/:tenantId/logo         remove the logo (admins/owners)
 *
 * Reads are open to all tenant members (the header shows the logo to everyone);
 * writes require an admin or owner. Every operation is scoped by organisationId
 * in the store layer, so a member of tenant A can never touch tenant B's logo.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember, isTenantAdmin } from "@framework/routes/tenant";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import {
  upsertOrganisationLogo,
  getOrganisationLogo,
  getOrganisationLogoInfo,
  deleteOrganisationLogo,
} from "../../../../lib/organisation-logo/store";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });

const ok = { 200: { description: "Successful response" } };

export default function defineOrganisationLogoRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/logo`;

  // get raw image ------------------------------------------------------------
  app.get(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["organisation-logo"],
      summary: "Get the organisation logo",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        const logo = await getOrganisationLogo(tenantId);
        return new Response(logo.file, {
          status: 200,
          headers: {
            "Content-Type": logo.contentType,
            // logos rarely change and are always fetched with a ?v= buster
            "Cache-Control": "private, max-age=86400",
          },
        });
      } catch {
        throw new HTTPException(404, { message: "Logo not found" });
      }
    }
  );

  // existence + cache-busting metadata --------------------------------------
  app.get(
    `${base}/info`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["organisation-logo"],
      summary: "Get organisation logo metadata (existence + updatedAt)",
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": {
              schema: resolver(
                v.object({
                  exists: v.boolean(),
                  updatedAt: v.nullable(v.string()),
                })
              ),
            },
          },
        },
      },
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const info = await getOrganisationLogoInfo(tenantId);
      return c.json(info);
    }
  );

  // upload / replace ---------------------------------------------------------
  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["organisation-logo"],
      summary: "Upload or replace the organisation logo",
      responses: ok,
    }),
    validator("param", tenantParam),
    validator("form", v.object({ file: v.any() })),
    isTenantAdmin,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const form = c.req.valid("form");
      const file = form.file as File | undefined;
      if (!file) {
        throw new HTTPException(400, { message: "No file provided" });
      }
      try {
        await upsertOrganisationLogo(tenantId, file);
        return c.json({ success: true, message: "Logo set successfully" });
      } catch (err) {
        throw new HTTPException(400, { message: err + "" });
      }
    }
  );

  // delete -------------------------------------------------------------------
  app.delete(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["organisation-logo"],
      summary: "Remove the organisation logo",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantAdmin,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const deleted = await deleteOrganisationLogo(tenantId);
      if (!deleted) {
        throw new HTTPException(404, { message: "Logo not found" });
      }
      return c.json({ success: true });
    }
  );
}
