/**
 * Idea board routes — a free-form canvas of text cards.
 *
 *   GET    /idea-boards                              list visible boards
 *   POST   /idea-boards                              create board
 *   GET    /idea-boards/:boardId                     board + cards + comments + links
 *   PUT    /idea-boards/:boardId                     title / visibility / settings
 *   DELETE /idea-boards/:boardId                     delete (cascades)
 *   POST   /idea-boards/:boardId/cards               create card
 *   PUT    /idea-boards/:boardId/cards/:cardId       text, colour, x/y, size
 *   POST   /idea-boards/:boardId/cards/:cardId/front bring to front
 *   DELETE /idea-boards/:boardId/cards/:cardId       delete card
 *   GET    /idea-boards/:boardId/cards/:cardId/comments
 *   POST   /idea-boards/:boardId/cards/:cardId/comments
 *   PUT    /idea-boards/:boardId/comments/:commentId (author only)
 *   DELETE /idea-boards/:boardId/comments/:commentId (author or board owner)
 *   POST   /idea-boards/:boardId/cards/:cardId/links create link
 *   DELETE /idea-boards/:boardId/links/:linkId       remove link
 *   POST   /idea-boards/:boardId/cards/:cardId/promote card → wiki page
 *
 * All routes are authenticated and tenant-scoped (isTenantMember). Visibility
 * (tenant-wide / team / personal) is enforced in the lib layer on every single
 * operation, so a board the user may not see behaves as if it did not exist.
 *
 * There is no dedicated "move" endpoint: without sections a move is just a new
 * x/y on the card, which `PUT .../cards/:cardId` already does.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  createBoard,
  listBoards,
  getBoardDetail,
  updateBoard,
  deleteBoard,
  createCard,
  updateCard,
  bringCardToFront,
  deleteCard,
  listCardComments,
  createComment,
  updateComment,
  deleteComment,
  createCardLink,
  deleteCardLink,
  promoteCardToPage,
  IdeaBoardError,
  type BoardContext,
} from "../../../../lib/idea-boards";
import { IDEA_CARD_KINDS, IDEA_LINK_TYPES } from "../../../../db/schema";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });
const boardParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  boardId: v.pipe(v.string(), v.uuid()),
});
const cardParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  boardId: v.pipe(v.string(), v.uuid()),
  cardId: v.pipe(v.string(), v.uuid()),
});
const commentParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  boardId: v.pipe(v.string(), v.uuid()),
  commentId: v.pipe(v.string(), v.uuid()),
});
const linkParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  boardId: v.pipe(v.string(), v.uuid()),
  linkId: v.pipe(v.string(), v.uuid()),
});

const nullableUuid = v.nullable(v.pipe(v.string(), v.uuid()));

const settingsSchema = v.object({
  showAuthors: v.optional(v.boolean()),
  locked: v.optional(v.boolean()),
  background: v.optional(v.picklist(["grid", "plain"])),
});

const createBoardBody = v.object({
  title: v.pipe(v.string(), v.minLength(1)),
  description: v.optional(v.nullable(v.string())),
  teamId: v.optional(nullableUuid),
  tenantWide: v.optional(v.boolean()),
  pageId: v.optional(nullableUuid),
  settings: v.optional(settingsSchema),
});

const updateBoardBody = v.object({
  title: v.optional(v.pipe(v.string(), v.minLength(1))),
  description: v.optional(v.nullable(v.string())),
  teamId: v.optional(nullableUuid),
  tenantWide: v.optional(v.boolean()),
  pageId: v.optional(nullableUuid),
  settings: v.optional(settingsSchema),
});

/**
 * Canvas geometry is bounded so a stray drag can't park a card at 1e9. Not
 * constrained to integers: pointer events deliver fractional pixels, and the
 * lib layer rounds before storing.
 */
const coordinate = v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000));
const size = v.pipe(v.number(), v.minValue(40), v.maxValue(4_000));

const createCardBody = v.object({
  text: v.optional(v.string()),
  kind: v.optional(v.picklist(IDEA_CARD_KINDS)),
  color: v.optional(v.nullable(v.string())),
  x: v.optional(coordinate),
  y: v.optional(coordinate),
  width: v.optional(size),
  height: v.optional(v.nullable(size)),
});

const updateCardBody = v.object({
  text: v.optional(v.string()),
  kind: v.optional(v.picklist(IDEA_CARD_KINDS)),
  color: v.optional(v.nullable(v.string())),
  x: v.optional(coordinate),
  y: v.optional(coordinate),
  width: v.optional(size),
  height: v.optional(v.nullable(size)),
  pageId: v.optional(nullableUuid),
});

const commentBody = v.object({
  text: v.pipe(v.string(), v.minLength(1)),
});

const createLinkBody = v.object({
  targetCardId: v.optional(nullableUuid),
  targetPageId: v.optional(nullableUuid),
  targetPageTitle: v.optional(v.nullable(v.string())),
  type: v.optional(v.picklist(IDEA_LINK_TYPES)),
});

const promoteBody = v.object({
  title: v.optional(v.string()),
  parentId: v.optional(nullableUuid),
});

const ok = { 200: { description: "Successful response" } };

/**
 * Expected failures carry their own status; anything else is a genuine bug and
 * must not be reported to the client as a 400.
 */
const toHttp = (e: unknown): never => {
  if (e instanceof HTTPException) throw e;
  if (e instanceof IdeaBoardError) {
    throw new HTTPException(e.status, { message: e.message });
  }
  throw e;
};

export default function defineIdeaBoardRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/idea-boards`;

  /** Acting user for the lib layer, including the author-label snapshot. */
  const contextOf = (c: {
    get: (key: "usersId" | "usersEmail") => string | undefined;
  }): Pick<BoardContext, "userId" | "userLabel"> => ({
    userId: c.get("usersId")!,
    userLabel: c.get("usersEmail") ?? undefined,
  });

  // list boards --------------------------------------------------------------
  app.get(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "List idea boards visible to the user",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const boards = await listBoards({ tenantId, ...contextOf(c) });
      return c.json(boards);
    },
  );

  // create board -------------------------------------------------------------
  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Create an idea board",
      responses: ok,
    }),
    validator("param", tenantParam),
    validator("json", createBoardBody),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        const board = await createBoard(
          { tenantId, ...contextOf(c) },
          c.req.valid("json"),
        );
        return c.json(board);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // get board with content ---------------------------------------------------
  app.get(
    `${base}/:boardId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Get a board with its cards, comments and links",
      responses: ok,
    }),
    validator("param", boardParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId } = c.req.valid("param");
      const detail = await getBoardDetail(
        { tenantId, ...contextOf(c) },
        boardId,
      );
      if (!detail) throw new HTTPException(404, { message: "Board not found" });
      return c.json(detail);
    },
  );

  // update board -------------------------------------------------------------
  app.put(
    `${base}/:boardId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Update a board",
      responses: ok,
    }),
    validator("param", boardParam),
    validator("json", updateBoardBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId } = c.req.valid("param");
      try {
        const board = await updateBoard(
          { tenantId, ...contextOf(c) },
          boardId,
          c.req.valid("json"),
        );
        return c.json(board);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // delete board -------------------------------------------------------------
  app.delete(
    `${base}/:boardId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Delete a board",
      responses: ok,
    }),
    validator("param", boardParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId } = c.req.valid("param");
      const deleted = await deleteBoard({ tenantId, ...contextOf(c) }, boardId);
      if (!deleted) throw new HTTPException(404, { message: "Board not found" });
      return c.json({ success: true });
    },
  );

  // create card --------------------------------------------------------------
  app.post(
    `${base}/:boardId/cards`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Create a card",
      responses: ok,
    }),
    validator("param", boardParam),
    validator("json", createCardBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId } = c.req.valid("param");
      try {
        const card = await createCard(
          { tenantId, ...contextOf(c) },
          boardId,
          c.req.valid("json"),
        );
        return c.json(card);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // update card (text, colour, position, size) -------------------------------
  app.put(
    `${base}/:boardId/cards/:cardId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Update a card",
      responses: ok,
    }),
    validator("param", cardParam),
    validator("json", updateCardBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      try {
        const card = await updateCard(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
          c.req.valid("json"),
        );
        return c.json(card);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // bring card to front ------------------------------------------------------
  app.post(
    `${base}/:boardId/cards/:cardId/front`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Bring a card to the front of the stack",
      responses: ok,
    }),
    validator("param", cardParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      try {
        const card = await bringCardToFront(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
        );
        return c.json(card);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // delete card --------------------------------------------------------------
  app.delete(
    `${base}/:boardId/cards/:cardId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Delete a card",
      responses: ok,
    }),
    validator("param", cardParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      try {
        const deleted = await deleteCard(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
        );
        if (!deleted) {
          throw new HTTPException(404, { message: "Card not found" });
        }
        return c.json({ success: true });
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // list comments of a card --------------------------------------------------
  app.get(
    `${base}/:boardId/cards/:cardId/comments`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "List the comments of a card",
      responses: ok,
    }),
    validator("param", cardParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      try {
        const comments = await listCardComments(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
        );
        return c.json(comments);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // add a comment ------------------------------------------------------------
  app.post(
    `${base}/:boardId/cards/:cardId/comments`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Comment on a card",
      responses: ok,
    }),
    validator("param", cardParam),
    validator("json", commentBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      const { text } = c.req.valid("json");
      try {
        const comment = await createComment(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
          text,
        );
        return c.json(comment);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // edit own comment ---------------------------------------------------------
  app.put(
    `${base}/:boardId/comments/:commentId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Edit your own comment",
      responses: ok,
    }),
    validator("param", commentParam),
    validator("json", commentBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, commentId } = c.req.valid("param");
      const { text } = c.req.valid("json");
      try {
        const comment = await updateComment(
          { tenantId, ...contextOf(c) },
          boardId,
          commentId,
          text,
        );
        return c.json(comment);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // delete a comment ---------------------------------------------------------
  app.delete(
    `${base}/:boardId/comments/:commentId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Delete a comment (author or board owner)",
      responses: ok,
    }),
    validator("param", commentParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, commentId } = c.req.valid("param");
      try {
        const deleted = await deleteComment(
          { tenantId, ...contextOf(c) },
          boardId,
          commentId,
        );
        if (!deleted) {
          throw new HTTPException(404, { message: "Comment not found" });
        }
        return c.json({ success: true });
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // link a card to another card or a wiki page -------------------------------
  app.post(
    `${base}/:boardId/cards/:cardId/links`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Link a card to another card or a wiki page",
      responses: ok,
    }),
    validator("param", cardParam),
    validator("json", createLinkBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      try {
        const link = await createCardLink(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
          c.req.valid("json"),
        );
        return c.json(link);
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // remove a link ------------------------------------------------------------
  app.delete(
    `${base}/:boardId/links/:linkId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Remove a card link",
      responses: ok,
    }),
    validator("param", linkParam),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, linkId } = c.req.valid("param");
      try {
        const deleted = await deleteCardLink(
          { tenantId, ...contextOf(c) },
          boardId,
          linkId,
        );
        if (!deleted) {
          throw new HTTPException(404, { message: "Link not found" });
        }
        return c.json({ success: true });
      } catch (e) {
        return toHttp(e);
      }
    },
  );

  // promote a card to a wiki page --------------------------------------------
  app.post(
    `${base}/:boardId/cards/:cardId/promote`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["idea-boards"],
      summary: "Turn a card into a wiki page",
      responses: ok,
    }),
    validator("param", cardParam),
    validator("json", promoteBody),
    isTenantMember,
    async (c) => {
      const { tenantId, boardId, cardId } = c.req.valid("param");
      try {
        const result = await promoteCardToPage(
          { tenantId, ...contextOf(c) },
          boardId,
          cardId,
          c.req.valid("json"),
        );
        return c.json(result);
      } catch (e) {
        return toHttp(e);
      }
    },
  );
}
