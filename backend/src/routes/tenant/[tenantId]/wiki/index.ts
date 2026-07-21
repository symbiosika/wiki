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
import { movePage } from "../../../../lib/wiki/move";
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
