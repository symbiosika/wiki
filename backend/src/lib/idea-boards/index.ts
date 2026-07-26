/**
 * Idea boards — business logic.
 *
 * A board is a free-form canvas of text cards ("sticky notes"). Cards carry
 * their own x/y position, so there are no sections or columns: structure comes
 * from where things are placed, plus standalone "heading" cards. Every card is
 * its own row, which is what makes a board safe to work on with several people
 * at once — two users moving two cards never touch the same record.
 *
 * Everything is scoped by `tenantId` and additionally filtered by visibility
 * (tenant-wide / team / personal), so a member of tenant A can never read or
 * mutate tenant B's boards, and a team board stays inside its team.
 */
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { generateKeyBetween } from "@framework/lib/utils/fractional-index";
import { getTeamsByUser } from "@framework/lib/usermanagement/teams";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import {
  ideaBoards,
  ideaBoardCards,
  ideaBoardCardComments,
  ideaBoardCardLinks,
  IDEA_CARD_KINDS,
  IDEA_LINK_TYPES,
  type IdeaBoardSelect,
  type IdeaBoardSettings,
  type IdeaBoardCardSelect,
  type IdeaBoardCardCommentSelect,
  type IdeaBoardCardLinkSelect,
  type IdeaCardKind,
  type IdeaLinkType,
} from "../../db/schema";

export interface BoardContext {
  tenantId: string;
  userId: string;
  /**
   * Display name/email of the acting user, stored as a snapshot on cards and
   * comments so an author stays attributable after the account is deleted.
   */
  userLabel?: string;
}

const nowIso = () => new Date().toISOString();

/** Raised for expected, user-facing failures; routes map these to 4xx. */
export class IdeaBoardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = "IdeaBoardError";
  }
}

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose message is only
 * the failed SQL, so the postgres error (with its `code` and constraint name)
 * sits on `cause`. Pattern-matching the top-level message would silently miss
 * every constraint violation, so walk the chain instead.
 */
const isUniqueViolation = (e: unknown, constraintName?: string): boolean => {
  let current: unknown = e;
  for (let depth = 0; current != null && depth < 5; depth++) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505") {
      return constraintName === undefined
        ? true
        : candidate.constraint_name === constraintName;
    }
    current = candidate.cause;
  }
  return false;
};

// ---- visibility -------------------------------------------------------------

/**
 * A board is visible when it is tenant-wide, when it belongs to one of the
 * user's teams, or when the user created it (the personal scope — a board with
 * no team that is not tenant-wide belongs to its creator alone). This mirrors
 * how knowledge_text scopes pages.
 */
const visibleBoardsWhere = async (ctx: BoardContext) => {
  const teams = await getTeamsByUser(ctx.userId, ctx.tenantId);
  const teamIds = teams.map((t) => t.teamId);
  return and(
    eq(ideaBoards.tenantId, ctx.tenantId),
    or(
      eq(ideaBoards.tenantWide, true),
      eq(ideaBoards.createdBy, ctx.userId),
      // `or` drops undefined, so a user without teams simply gets the two
      // predicates above instead of an `IN ()` that matches nothing
      teamIds.length > 0 ? inArray(ideaBoards.teamId, teamIds) : undefined,
    ),
  );
};

// ---- boards -----------------------------------------------------------------

export interface CreateBoardInput {
  title: string;
  description?: string | null;
  teamId?: string | null;
  tenantWide?: boolean;
  pageId?: string | null;
  settings?: IdeaBoardSettings;
}

export const createBoard = async (
  ctx: BoardContext,
  input: CreateBoardInput,
): Promise<IdeaBoardSelect> => {
  const title = input.title.trim();
  if (!title) throw new IdeaBoardError("Title must not be empty");
  const rows = await getDb()
    .insert(ideaBoards)
    .values({
      tenantId: ctx.tenantId,
      title,
      description: input.description ?? null,
      teamId: input.teamId ?? null,
      tenantWide: input.tenantWide ?? false,
      pageId: input.pageId ?? null,
      settings: input.settings ?? {},
      createdBy: ctx.userId,
    })
    .returning();
  return rows[0]!;
};

export const listBoards = async (
  ctx: BoardContext,
): Promise<IdeaBoardSelect[]> =>
  getDb()
    .select()
    .from(ideaBoards)
    .where(await visibleBoardsWhere(ctx))
    .orderBy(desc(ideaBoards.updatedAt));

export const getBoard = async (
  ctx: BoardContext,
  boardId: string,
): Promise<IdeaBoardSelect | null> => {
  const rows = await getDb()
    .select()
    .from(ideaBoards)
    .where(and(eq(ideaBoards.id, boardId), await visibleBoardsWhere(ctx)))
    .limit(1);
  return rows[0] ?? null;
};

/** Load a board or fail — the guard every card/comment/link operation runs. */
const requireBoard = async (
  ctx: BoardContext,
  boardId: string,
): Promise<IdeaBoardSelect> => {
  const board = await getBoard(ctx, boardId);
  if (!board) throw new IdeaBoardError("Board not found", 404);
  return board;
};

/** Content changes are refused while a board is frozen. */
const requireUnlockedBoard = async (
  ctx: BoardContext,
  boardId: string,
): Promise<IdeaBoardSelect> => {
  const board = await requireBoard(ctx, boardId);
  if (board.settings?.locked) {
    throw new IdeaBoardError("Board is locked", 403);
  }
  return board;
};

export interface BoardDetail {
  board: IdeaBoardSelect;
  cards: IdeaBoardCardSelect[];
  comments: IdeaBoardCardCommentSelect[];
  links: IdeaBoardCardLinkSelect[];
}

/**
 * Everything needed to render a board, in four queries. Comments are loaded
 * per board (not per card) — that is what the denormalized `boardId` on the
 * comment row is for, and why no comment counter has to be kept in sync.
 *
 * The three content queries run one after another on purpose. Firing them
 * concurrently through `Promise.all` shares one postgres.js connection, and
 * from the second call onwards the pipelined prepared statements come back
 * empty instead of erroring — a board would silently render as blank. Four
 * sequential round trips against a board that is loaded once are not worth
 * that failure mode.
 */
export const getBoardDetail = async (
  ctx: BoardContext,
  boardId: string,
): Promise<BoardDetail | null> => {
  const board = await getBoard(ctx, boardId);
  if (!board) return null;
  const db = getDb();
  const cards = await db
    .select()
    .from(ideaBoardCards)
    .where(eq(ideaBoardCards.boardId, boardId))
    .orderBy(asc(ideaBoardCards.z));
  const comments = await db
    .select()
    .from(ideaBoardCardComments)
    .where(eq(ideaBoardCardComments.boardId, boardId))
    .orderBy(asc(ideaBoardCardComments.createdAt));
  const links = await db
    .select()
    .from(ideaBoardCardLinks)
    .where(eq(ideaBoardCardLinks.boardId, boardId));
  return { board, cards, comments, links };
};

export interface UpdateBoardInput {
  title?: string;
  description?: string | null;
  teamId?: string | null;
  tenantWide?: boolean;
  pageId?: string | null;
  settings?: IdeaBoardSettings;
}

export const updateBoard = async (
  ctx: BoardContext,
  boardId: string,
  input: UpdateBoardInput,
): Promise<IdeaBoardSelect> => {
  await requireBoard(ctx, boardId);
  if (input.title !== undefined && !input.title.trim()) {
    throw new IdeaBoardError("Title must not be empty");
  }
  const rows = await getDb()
    .update(ideaBoards)
    .set({
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.teamId !== undefined && { teamId: input.teamId }),
      ...(input.tenantWide !== undefined && { tenantWide: input.tenantWide }),
      ...(input.pageId !== undefined && { pageId: input.pageId }),
      ...(input.settings !== undefined && { settings: input.settings }),
      updatedAt: nowIso(),
    })
    .where(eq(ideaBoards.id, boardId))
    .returning();
  return rows[0]!;
};

export const deleteBoard = async (
  ctx: BoardContext,
  boardId: string,
): Promise<boolean> => {
  const board = await getBoard(ctx, boardId);
  if (!board) return false;
  // cards, comments and links cascade via FK
  await getDb().delete(ideaBoards).where(eq(ideaBoards.id, boardId));
  return true;
};

/** Touch the board so `updatedAt` reflects activity on its cards. */
const touchBoard = async (boardId: string): Promise<void> => {
  await getDb()
    .update(ideaBoards)
    .set({ updatedAt: nowIso() })
    .where(eq(ideaBoards.id, boardId));
};

// ---- cards ------------------------------------------------------------------

const assertKind = (kind: string): IdeaCardKind => {
  if (!(IDEA_CARD_KINDS as readonly string[]).includes(kind)) {
    throw new IdeaBoardError(`Unknown card kind "${kind}"`);
  }
  return kind as IdeaCardKind;
};

/** Highest stacking key currently on the board, or null when it is empty. */
const topZ = async (boardId: string): Promise<string | null> => {
  const rows = await getDb()
    .select({ z: ideaBoardCards.z })
    .from(ideaBoardCards)
    .where(eq(ideaBoardCards.boardId, boardId))
    .orderBy(desc(ideaBoardCards.z))
    .limit(1);
  return rows[0]?.z ?? null;
};

/**
 * Two clients adding a card at the same moment both read the same top key and
 * would generate the same next one, which the unique (board_id, z) index
 * rejects. Retrying re-reads the top key, so the loser of the race simply
 * lands one slot higher.
 */
const withZRetry = async <T>(fn: () => Promise<T>, attempts = 5): Promise<T> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isUniqueViolation(e, "idea_board_cards_z_idx")) throw e;
      lastError = e;
    }
  }
  throw lastError;
};

export interface CreateCardInput {
  text?: string;
  kind?: string;
  color?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number | null;
}

export const createCard = async (
  ctx: BoardContext,
  boardId: string,
  input: CreateCardInput,
): Promise<IdeaBoardCardSelect> => {
  await requireUnlockedBoard(ctx, boardId);
  const kind = assertKind(input.kind ?? "note");
  const card = await withZRetry(async () => {
    const z = generateKeyBetween(await topZ(boardId), null);
    const rows = await getDb()
      .insert(ideaBoardCards)
      .values({
        boardId,
        tenantId: ctx.tenantId,
        kind,
        text: input.text ?? "",
        authorLabel: ctx.userLabel ?? null,
        createdBy: ctx.userId,
        color: input.color ?? null,
        x: Math.round(input.x ?? 0),
        y: Math.round(input.y ?? 0),
        width: Math.round(input.width ?? 220),
        height: input.height == null ? null : Math.round(input.height),
        z,
      })
      .returning();
    return rows[0]!;
  });
  await touchBoard(boardId);
  return card;
};

export const getCard = async (
  boardId: string,
  cardId: string,
): Promise<IdeaBoardCardSelect | null> => {
  const rows = await getDb()
    .select()
    .from(ideaBoardCards)
    .where(
      and(eq(ideaBoardCards.id, cardId), eq(ideaBoardCards.boardId, boardId)),
    )
    .limit(1);
  return rows[0] ?? null;
};

export interface UpdateCardInput {
  text?: string;
  kind?: string;
  color?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number | null;
  pageId?: string | null;
}

export const updateCard = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
  input: UpdateCardInput,
): Promise<IdeaBoardCardSelect> => {
  await requireUnlockedBoard(ctx, boardId);
  const existing = await getCard(boardId, cardId);
  if (!existing) throw new IdeaBoardError("Card not found", 404);
  const rows = await getDb()
    .update(ideaBoardCards)
    .set({
      ...(input.text !== undefined && { text: input.text }),
      ...(input.kind !== undefined && { kind: assertKind(input.kind) }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.x !== undefined && { x: Math.round(input.x) }),
      ...(input.y !== undefined && { y: Math.round(input.y) }),
      ...(input.width !== undefined && { width: Math.round(input.width) }),
      ...(input.height !== undefined && {
        height: input.height == null ? null : Math.round(input.height),
      }),
      ...(input.pageId !== undefined && { pageId: input.pageId }),
      updatedAt: nowIso(),
    })
    .where(eq(ideaBoardCards.id, cardId))
    .returning();
  await touchBoard(boardId);
  return rows[0]!;
};

/** Move a card to the top of the stack — one row update, no renumbering. */
export const bringCardToFront = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
): Promise<IdeaBoardCardSelect> => {
  await requireUnlockedBoard(ctx, boardId);
  const existing = await getCard(boardId, cardId);
  if (!existing) throw new IdeaBoardError("Card not found", 404);
  return withZRetry(async () => {
    const top = await topZ(boardId);
    if (top === null || top === existing.z) return existing; // already on top
    const rows = await getDb()
      .update(ideaBoardCards)
      .set({ z: generateKeyBetween(top, null), updatedAt: nowIso() })
      .where(eq(ideaBoardCards.id, cardId))
      .returning();
    return rows[0]!;
  });
};

export const deleteCard = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
): Promise<boolean> => {
  await requireUnlockedBoard(ctx, boardId);
  const existing = await getCard(boardId, cardId);
  if (!existing) return false;
  // comments and links cascade via FK
  await getDb().delete(ideaBoardCards).where(eq(ideaBoardCards.id, cardId));
  await touchBoard(boardId);
  return true;
};

// ---- comments ---------------------------------------------------------------

export const listCardComments = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
): Promise<IdeaBoardCardCommentSelect[]> => {
  await requireBoard(ctx, boardId);
  const card = await getCard(boardId, cardId);
  if (!card) throw new IdeaBoardError("Card not found", 404);
  return getDb()
    .select()
    .from(ideaBoardCardComments)
    .where(eq(ideaBoardCardComments.cardId, cardId))
    .orderBy(asc(ideaBoardCardComments.createdAt));
};

export const createComment = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
  text: string,
): Promise<IdeaBoardCardCommentSelect> => {
  await requireUnlockedBoard(ctx, boardId);
  const card = await getCard(boardId, cardId);
  if (!card) throw new IdeaBoardError("Card not found", 404);
  const trimmed = text.trim();
  if (!trimmed) throw new IdeaBoardError("Comment must not be empty");
  const rows = await getDb()
    .insert(ideaBoardCardComments)
    .values({
      cardId,
      boardId,
      tenantId: ctx.tenantId,
      text: trimmed,
      createdBy: ctx.userId,
      authorLabel: ctx.userLabel ?? null,
    })
    .returning();
  await touchBoard(boardId);
  return rows[0]!;
};

const getComment = async (
  boardId: string,
  commentId: string,
): Promise<IdeaBoardCardCommentSelect | null> => {
  const rows = await getDb()
    .select()
    .from(ideaBoardCardComments)
    .where(
      and(
        eq(ideaBoardCardComments.id, commentId),
        eq(ideaBoardCardComments.boardId, boardId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

/** Editing is the author's alone; deleting is also allowed for the board owner. */
export const updateComment = async (
  ctx: BoardContext,
  boardId: string,
  commentId: string,
  text: string,
): Promise<IdeaBoardCardCommentSelect> => {
  await requireUnlockedBoard(ctx, boardId);
  const comment = await getComment(boardId, commentId);
  if (!comment) throw new IdeaBoardError("Comment not found", 404);
  if (comment.createdBy !== ctx.userId) {
    throw new IdeaBoardError("Only the author can edit a comment", 403);
  }
  const trimmed = text.trim();
  if (!trimmed) throw new IdeaBoardError("Comment must not be empty");
  const rows = await getDb()
    .update(ideaBoardCardComments)
    .set({ text: trimmed, updatedAt: nowIso() })
    .where(eq(ideaBoardCardComments.id, commentId))
    .returning();
  return rows[0]!;
};

export const deleteComment = async (
  ctx: BoardContext,
  boardId: string,
  commentId: string,
): Promise<boolean> => {
  const board = await requireUnlockedBoard(ctx, boardId);
  const comment = await getComment(boardId, commentId);
  if (!comment) return false;
  const mayDelete =
    comment.createdBy === ctx.userId || board.createdBy === ctx.userId;
  if (!mayDelete) {
    throw new IdeaBoardError(
      "Only the author or the board owner can delete a comment",
      403,
    );
  }
  await getDb()
    .delete(ideaBoardCardComments)
    .where(eq(ideaBoardCardComments.id, commentId));
  return true;
};

// ---- links ------------------------------------------------------------------

export interface CreateCardLinkInput {
  targetCardId?: string | null;
  targetPageId?: string | null;
  targetPageTitle?: string | null;
  type?: string;
}

export const createCardLink = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
  input: CreateCardLinkInput,
): Promise<IdeaBoardCardLinkSelect> => {
  await requireUnlockedBoard(ctx, boardId);
  const source = await getCard(boardId, cardId);
  if (!source) throw new IdeaBoardError("Card not found", 404);

  const targetCardId = input.targetCardId ?? null;
  const targetPageId = input.targetPageId ?? null;
  if ((targetCardId === null) === (targetPageId === null)) {
    throw new IdeaBoardError(
      "Provide exactly one of targetCardId or targetPageId",
    );
  }
  if (targetCardId === cardId) {
    throw new IdeaBoardError("A card cannot be linked to itself");
  }
  const type = input.type ?? "relates";
  if (!(IDEA_LINK_TYPES as readonly string[]).includes(type)) {
    throw new IdeaBoardError(`Unknown link type "${type}"`);
  }
  // a card link must stay inside the board, otherwise the board view would
  // render an edge to something it never loaded
  if (targetCardId) {
    const target = await getCard(boardId, targetCardId);
    if (!target) throw new IdeaBoardError("Target card not found", 404);
  }

  try {
    const rows = await getDb()
      .insert(ideaBoardCardLinks)
      .values({
        tenantId: ctx.tenantId,
        boardId,
        sourceCardId: cardId,
        targetCardId,
        targetPageId,
        targetPageTitle: input.targetPageTitle ?? null,
        type: type as IdeaLinkType,
        createdBy: ctx.userId,
      })
      .returning();
    return rows[0]!;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new IdeaBoardError("This link already exists");
    }
    throw e;
  }
};

export const deleteCardLink = async (
  ctx: BoardContext,
  boardId: string,
  linkId: string,
): Promise<boolean> => {
  await requireUnlockedBoard(ctx, boardId);
  const rows = await getDb()
    .select()
    .from(ideaBoardCardLinks)
    .where(
      and(
        eq(ideaBoardCardLinks.id, linkId),
        eq(ideaBoardCardLinks.boardId, boardId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return false;
  await getDb()
    .delete(ideaBoardCardLinks)
    .where(eq(ideaBoardCardLinks.id, linkId));
  return true;
};

// ---- wiki bridge ------------------------------------------------------------

/** First non-empty line of a card, clipped — used as the page title. */
const titleFromCardText = (text: string): string => {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return "Untitled idea";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
};

/**
 * Turn a card into a wiki page and remember the page on the card. This is the
 * step from "loose idea" to documented knowledge — and the only way a card's
 * content becomes searchable, since search and embeddings only ever see
 * knowledge_text, never these tables.
 */
export const promoteCardToPage = async (
  ctx: BoardContext,
  boardId: string,
  cardId: string,
  input: { title?: string; parentId?: string | null } = {},
): Promise<{ card: IdeaBoardCardSelect; pageId: string }> => {
  const board = await requireBoard(ctx, boardId);
  const card = await getCard(boardId, cardId);
  if (!card) throw new IdeaBoardError("Card not found", 404);
  if (card.pageId) {
    throw new IdeaBoardError("Card is already linked to a page");
  }

  const page = await createKnowledgeText({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    createdBy: ctx.userId,
    teamId: board.teamId ?? undefined,
    tenantWide: board.tenantWide,
    // default to nesting under the board's own page when it has one
    parentId: input.parentId ?? board.pageId ?? undefined,
    title: input.title?.trim() || titleFromCardText(card.text),
    text: card.text,
  });

  const rows = await getDb()
    .update(ideaBoardCards)
    .set({ pageId: page.id, updatedAt: nowIso() })
    .where(eq(ideaBoardCards.id, cardId))
    .returning();
  await touchBoard(boardId);
  return { card: rows[0]!, pageId: page.id };
};
