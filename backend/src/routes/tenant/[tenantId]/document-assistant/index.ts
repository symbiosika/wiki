/**
 * Document Assistant route — interact with a wiki page by voice/text.
 *
 * POST /tenant/:tenantId/document-assistant
 *   body: { entryId, instruction }
 *   → the agent works the instruction into the page (see
 *     lib/knowledge/document-agent) and returns a short summary. Applied
 *     directly; the framework records a version snapshot, so the change is
 *     revertable via the page history.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { runDocumentAssistant } from "../../../../lib/knowledge/document-agent";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });

export default function defineDocumentAssistantRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/document-assistant`;

  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["document-assistant"],
      summary: "Work a natural-language instruction into a wiki page",
      responses: {
        200: {
          description: "Assistant result",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    validator("param", tenantParam),
    validator(
      "json",
      v.object({
        entryId: v.pipe(v.string(), v.uuid()),
        instruction: v.pipe(v.string(), v.minLength(1)),
      }),
    ),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const { entryId, instruction } = c.req.valid("json");
      const userId = c.get("usersId");
      try {
        const result = await runDocumentAssistant(
          { tenantId, userId },
          entryId,
          instruction,
        );
        return c.json(result);
      } catch (error) {
        console.error("Document assistant failed", error);
        return c.json(
          { success: false, error: "Document assistant failed" },
          500,
        );
      }
    },
  );
}
