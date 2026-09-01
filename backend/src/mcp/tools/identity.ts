/**
 * Identity & context tools: "who am I" and "which organisations can I reach".
 * These let the assistant know in whose name and in which organisation it acts
 * before reading or writing wiki pages.
 */

import type { McpToolDefinition } from "@framework/types";
import { defineTool, READ_ONLY } from "./_define";
import { callApi, resolveTenantId } from "../api";

export const identityTools: McpToolDefinition[] = [
  defineTool(
    {
      name: "whoami",
      title: "Who am I",
      description:
        "Returns the profile of the signed-in user (sub, email, name) via the " +
        "OIDC userinfo endpoint, plus the active organisation (tenant) id the " +
        "wiki tools operate on. Call this first to confirm identity and " +
        "context before other actions.",
      annotations: READ_ONLY,
    },
    async (_args, ctx) => {
      const result = await callApi(ctx, "/oauth/userinfo");
      if (result.isError) return result;
      let tenantId: string | null = null;
      try {
        tenantId = resolveTenantId(ctx);
      } catch {
        tenantId = null;
      }
      const profile = result.structuredContent ?? {};
      const merged = { ...profile, activeOrganisationId: tenantId };
      return {
        content: [
          { type: "text", text: JSON.stringify(merged, null, 2) },
        ],
        structuredContent: merged,
      };
    },
  ),

  defineTool(
    {
      name: "list_organisations",
      title: "List my organisations",
      description:
        "Lists the organisations (tenants) the signed-in user is a member of, " +
        "with id, name and role. The wiki tools operate on the organisation " +
        "bound to the current token; this is mainly informational.",
      annotations: READ_ONLY,
    },
    async (_args, ctx) => callApi(ctx, "/api/v1/user/tenants"),
  ),
];
