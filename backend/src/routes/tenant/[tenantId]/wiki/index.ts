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
import { isTenantAdmin, isTenantMember } from "@framework/routes/tenant";
import { describeRoute } from "hono-openapi";
import { resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { validateScope } from "@framework/lib/utils/validate-scope";
import { buildWikiTree } from "../../../../lib/wiki/tree";
import { getPageTypeUsage } from "../../../../lib/wiki/page-type-usage";
import { movePage } from "../../../../lib/wiki/move";
import { getWikiPageImage } from "../../../../lib/wiki/images";
import { upgradeWebSocket } from "../../../../lib/ws/bun-ws";
import {
  wikiPresence,
  type PresenceConnection,
} from "../../../../lib/wiki/presence";

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

  /**
   * GET /tenant/:tenantId/wiki/page-type-usage
   * How many pages carry each page type, organisation-wide.
   *
   * Feeds the page-type editor in the administration area: removing or
   * renaming a page type that pages still use would leave those pages with a
   * value the facet validation rejects on the next save, so the editor needs
   * the count to guard the edit. Admin-only, like the config it guards.
   */
  app.get(
    `${baseRoute}/page-type-usage`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["wiki"],
      summary: "Count pages per page type (organisation-wide)",
      responses: {
        200: {
          description: 'Page type to page count, e.g. { "FAQ": 12 }',
          content: {
            "application/json": {
              schema: resolver(v.any()),
            },
          },
        },
      },
    }),
    validateScope("knowledge:read"),
    validator("param", v.object({ tenantId: v.pipe(v.string(), v.uuid()) })),
    isTenantAdmin,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        return c.json({ success: true, data: await getPageTypeUsage(tenantId) });
      } catch (error) {
        console.error("Failed to count page type usage", error);
        return c.json(
          { success: false, error: "Failed to count page type usage" },
          500
        );
      }
    }
  );

  /**
   * POST /tenant/:tenantId/wiki/:pageId/move
   * Re-parent and/or re-order a page within its sidebar section (drag & drop).
   * The body carries the new parent (null = section root) and the desired order
   * of the destination sibling list; positions are (re)derived server-side.
   */
  app.post(
    `${baseRoute}/:pageId/move`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["wiki"],
      summary: "Move a wiki page (re-parent / re-order) in the tree",
      responses: {
        200: {
          description: "The move result",
          content: {
            "application/json": {
              schema: resolver(v.any()),
            },
          },
        },
      },
    }),
    validator(
      "param",
      v.object({
        tenantId: v.pipe(v.string(), v.uuid()),
        pageId: v.pipe(v.string(), v.uuid()),
      })
    ),
    validator(
      "json",
      v.object({
        parentId: v.nullable(v.pipe(v.string(), v.uuid())),
        orderedIds: v.array(v.pipe(v.string(), v.uuid())),
      })
    ),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      const { parentId, orderedIds } = c.req.valid("json");
      const userId = c.get("usersId");
      try {
        const writes = await movePage(
          pageId,
          { parentId, orderedIds },
          { tenantId, userId }
        );
        return c.json({ success: true, data: { writes } });
      } catch (error) {
        return c.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Failed to move page",
          },
          400
        );
      }
    }
  );

  /**
   * GET /tenant/:tenantId/wiki/:pageId/images/:filename
   *
   * Serve an image that is embedded in a wiki page — gated by PAGE visibility
   * (`knowledge:read`) instead of the generic `files:read` scope. This is what
   * lets OAuth clients of the MCP server (claude.ai & co, which only get the
   * knowledge scopes) load the images of pages the user is allowed to read.
   * The file must actually be referenced by the page's content.
   */
  app.get(
    `${baseRoute}/:pageId/images/:filename`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["wiki"],
      summary: "Get an image embedded in a wiki page (page-scoped access)",
      responses: {
        200: { description: "The image bytes" },
      },
    }),
    validateScope("knowledge:read"),
    validator(
      "param",
      v.object({
        tenantId: v.pipe(v.string(), v.uuid()),
        pageId: v.pipe(v.string(), v.uuid()),
        filename: v.string(),
      })
    ),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId, filename } = c.req.valid("param");
      const userId = c.get("usersId");
      try {
        const file = await getWikiPageImage(tenantId, userId, pageId, filename);
        const bytes = await file.arrayBuffer();
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Length": bytes.byteLength.toString(),
            // page permissions can change at any time — keep caching private
            "Cache-Control": "private, max-age=300",
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load image";
        return c.json({ success: false, error: message }, 404);
      }
    }
  );

  /**
   * GET /tenant/:tenantId/wiki/:pageId/presence  (WebSocket)
   *
   * Editing presence & lock for a single page. On connect the client is told
   * the current lock state ({type:"state", locked, lockedBy, youHoldLock}).
   * The client sends control frames:
   *   {type:"acquire"} — request the edit lock (granted only if free)
   *   {type:"release"} — give up the lock (page becomes editable for others)
   *   {type:"ping"}    — keepalive (keeps the socket under Bun's idle timeout)
   * Any change to the lock is broadcast to all clients on the page, so viewers
   * immediately see when a page becomes read-only or free again.
   *
   * Auth: the global auth middleware validates the session cookie on the
   * same-origin upgrade request; `isTenantMember` scopes it to the tenant.
   */
  app.get(
    `${baseRoute}/:pageId/presence`,
    authAndSetUsersInfo,
    checkUserPermission,
    validator(
      "param",
      v.object({
        tenantId: v.pipe(v.string(), v.uuid()),
        pageId: v.pipe(v.string(), v.uuid()),
      })
    ),
    isTenantMember,
    upgradeWebSocket((c) => {
      const tenantId = c.req.param("tenantId");
      const pageId = c.req.param("pageId");
      const userId = c.get("usersId") ?? "";
      const userName = c.get("usersEmail") ?? userId;

      let conn: PresenceConnection | null = null;
      let closed = false;

      return {
        onOpen: (_event, ws) => {
          conn = { ws, userId, userName };
          wikiPresence.join(tenantId, pageId, conn);
        },
        onMessage: (event) => {
          if (!conn || typeof event.data !== "string") return;
          let msg: { type?: string };
          try {
            msg = JSON.parse(event.data) as { type?: string };
          } catch {
            return;
          }
          if (msg.type === "acquire") {
            wikiPresence.acquire(tenantId, pageId, conn);
          } else if (msg.type === "release") {
            wikiPresence.release(tenantId, pageId, conn);
          }
          // {type:"ping"} needs no action — receiving it already reset the
          // idle timer.
        },
        onClose: () => {
          if (closed || !conn) return;
          closed = true;
          wikiPresence.leave(tenantId, pageId, conn);
        },
        onError: () => {
          if (closed || !conn) return;
          closed = true;
          wikiPresence.leave(tenantId, pageId, conn);
        },
      };
    })
  );
}
