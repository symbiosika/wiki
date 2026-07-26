import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  createDatabaseClient,
  waitForDbConnection,
  getDb,
} from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { eq } from "drizzle-orm";
import { ideaBoards } from "../../../../db/schema";
import defineIdeaBoardRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
/** TEST_ORG1_USER_1 — creates the boards below */
let token: string;
/** TEST_ORG2_USER_1 — member of a different tenant */
let foreignToken: string;
/** TEST_ADMIN_USER — a second user inside the same tenant */
let otherToken: string;

const org = TEST_ORGANISATION_1.id;
const boardsPath = `/tenant/${org}/idea-boards`;

/** Board ids created by the tests, cleaned up at the end. */
const createdBoards: string[] = [];
const createdPages: string[] = [];

const createBoard = async (
  body: Record<string, unknown> = {},
  as: string = token,
) => {
  const res = await testFetcher.post(app, boardsPath, as, {
    title: "Retro",
    ...body,
  });
  if (res.status === 200) createdBoards.push(res.jsonResponse.id);
  return res;
};

describe("Idea board routes", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    const tokens = await initTests();
    token = tokens.user1Token;
    foreignToken = tokens.user2Token;
    otherToken = tokens.adminToken;
    app = new Hono();
    defineIdeaBoardRoutes(app);
  });

  afterAll(() => {
    // fire and forget (Bun limitation); cards/comments/links cascade
    Promise.all([
      ...createdBoards.map((id) =>
        getDb().delete(ideaBoards).where(eq(ideaBoards.id, id)),
      ),
      ...createdPages.map((id) =>
        getDb().delete(knowledgeText).where(eq(knowledgeText.id, id)),
      ),
    ]).then(() => {});
  });

  test("unauthenticated access is rejected", async () => {
    const res = await testFetcher.get(app, boardsPath, undefined);
    expect(res.status).toBe(401);
  });

  test("cross-tenant access is rejected", async () => {
    const res = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_2.id}/idea-boards`,
      token,
    );
    expect(res.status).toBe(403);
  });

  test("an empty title is rejected", async () => {
    const res = await createBoard({ title: "" });
    expect(res.status).toBe(400);
  });

  test("board CRUD", async () => {
    const created = await createBoard({
      title: "Kickoff",
      description: "first board",
      tenantWide: true,
    });
    expect(created.status).toBe(200);
    const boardId = created.jsonResponse.id as string;
    expect(boardId).toBeTruthy();

    const list = await testFetcher.get(app, boardsPath, token);
    expect(list.status).toBe(200);
    expect(list.jsonResponse.some((b: any) => b.id === boardId)).toBe(true);

    const updated = await testFetcher.put(
      app,
      `${boardsPath}/${boardId}`,
      token,
      { title: "Kickoff 2", settings: { background: "grid" } },
    );
    expect(updated.status).toBe(200);
    expect(updated.jsonResponse.title).toBe("Kickoff 2");
    expect(updated.jsonResponse.settings.background).toBe("grid");

    const detail = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(detail.status).toBe(200);
    expect(detail.jsonResponse.board.id).toBe(boardId);
    expect(detail.jsonResponse.cards).toEqual([]);
    expect(detail.jsonResponse.comments).toEqual([]);
    expect(detail.jsonResponse.links).toEqual([]);

    const deleted = await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(deleted.status).toBe(200);

    const gone = await testFetcher.get(app, `${boardsPath}/${boardId}`, token);
    expect(gone.status).toBe(404);
  });

  test("a board that is not visible behaves as if it did not exist", async () => {
    // no team, not tenant-wide => personal to its creator
    const created = await createBoard({ title: "Private notes" });
    const boardId = created.jsonResponse.id as string;

    const list = await testFetcher.get(app, boardsPath, otherToken);
    expect(list.status).toBe(200);
    expect(list.jsonResponse.some((b: any) => b.id === boardId)).toBe(false);

    const detail = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      otherToken,
    );
    expect(detail.status).toBe(404);

    // and it cannot be mutated either
    const card = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      otherToken,
      { text: "sneaky" },
    );
    expect(card.status).toBe(404);
  });

  test("cards: create, move, stack and delete", async () => {
    const created = await createBoard({ title: "Canvas", tenantWide: true });
    const boardId = created.jsonResponse.id as string;

    const heading = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "1) Warum bin ich hier?", kind: "heading", x: 20, y: 10 },
    );
    expect(heading.status).toBe(200);
    expect(heading.jsonResponse.kind).toBe("heading");

    const first = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "Besseren Fokus finden", x: 40, y: 120, color: "yellow" },
    );
    expect(first.status).toBe(200);
    const firstId = first.jsonResponse.id as string;
    // the author label is snapshotted from the session
    expect(first.jsonResponse.authorLabel).toBeTruthy();

    const second = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "Zweite Karte", x: 260, y: 120 },
    );
    const secondId = second.jsonResponse.id as string;
    // later cards stack above earlier ones
    expect(second.jsonResponse.z > first.jsonResponse.z).toBe(true);

    // fractional pixels from a pointer drag are accepted and rounded
    const moved = await testFetcher.put(
      app,
      `${boardsPath}/${boardId}/cards/${firstId}`,
      token,
      { x: 133.7, y: 240.2, text: "Besseren Fokus finden (BE)" },
    );
    expect(moved.status).toBe(200);
    expect(moved.jsonResponse.x).toBe(134);
    expect(moved.jsonResponse.y).toBe(240);

    // bringing the lower card to the front puts it above the other one
    const fronted = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${firstId}/front`,
      token,
      {},
    );
    expect(fronted.status).toBe(200);
    expect(fronted.jsonResponse.z > second.jsonResponse.z).toBe(true);

    // the board index returns cards bottom-to-top
    const detail = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    const ids = detail.jsonResponse.cards.map((c: any) => c.id);
    expect(ids[ids.length - 1]).toBe(firstId);
    expect(ids).toContain(secondId);

    const deleted = await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}/cards/${secondId}`,
      token,
    );
    expect(deleted.status).toBe(200);

    const afterDelete = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(afterDelete.jsonResponse.cards.length).toBe(2);
  });

  test("out-of-range coordinates are rejected", async () => {
    const created = await createBoard({ title: "Bounds", tenantWide: true });
    const boardId = created.jsonResponse.id as string;
    const res = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "far away", x: 10_000_000, y: 0 },
    );
    expect(res.status).toBe(400);
  });

  test("comments are per user and only the author may edit", async () => {
    const created = await createBoard({ title: "Comments", tenantWide: true });
    const boardId = created.jsonResponse.id as string;
    const card = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "Kernursache?" },
    );
    const cardId = card.jsonResponse.id as string;

    const mine = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/comments`,
      token,
      { text: "Das sehe ich auch so" },
    );
    expect(mine.status).toBe(200);
    const myCommentId = mine.jsonResponse.id as string;

    // a second user in the same tenant comments on the same card
    const theirs = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/comments`,
      otherToken,
      { text: "Ich widerspreche" },
    );
    expect(theirs.status).toBe(200);
    const theirCommentId = theirs.jsonResponse.id as string;
    expect(theirs.jsonResponse.createdBy).not.toBe(mine.jsonResponse.createdBy);

    // the same user may comment more than once
    const again = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/comments`,
      token,
      { text: "Nachtrag" },
    );
    expect(again.status).toBe(200);

    const list = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/comments`,
      token,
    );
    expect(list.status).toBe(200);
    expect(list.jsonResponse.length).toBe(3);

    // comments come back with the board, without a per-card round trip
    const detail = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(detail.jsonResponse.comments.length).toBe(3);

    // empty comments are rejected
    const empty = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/comments`,
      token,
      { text: "   " },
    );
    expect(empty.status).toBe(400);

    // editing someone else's comment is refused
    const foreignEdit = await testFetcher.put(
      app,
      `${boardsPath}/${boardId}/comments/${theirCommentId}`,
      token,
      { text: "umgeschrieben" },
    );
    expect(foreignEdit.status).toBe(403);

    // editing your own works
    const ownEdit = await testFetcher.put(
      app,
      `${boardsPath}/${boardId}/comments/${myCommentId}`,
      token,
      { text: "Präzisiert" },
    );
    expect(ownEdit.status).toBe(200);
    expect(ownEdit.jsonResponse.text).toBe("Präzisiert");

    // the board owner may delete a foreign comment
    const ownerDelete = await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}/comments/${theirCommentId}`,
      token,
    );
    expect(ownerDelete.status).toBe(200);

    // a non-owner may not delete someone else's comment
    const foreignDelete = await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}/comments/${myCommentId}`,
      otherToken,
    );
    expect(foreignDelete.status).toBe(403);

    // deleting a card takes its comments with it
    await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}`,
      token,
    );
    const afterCardDelete = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(afterCardDelete.jsonResponse.comments).toEqual([]);
  });

  test("links between cards and to wiki pages", async () => {
    const created = await createBoard({ title: "Links", tenantWide: true });
    const boardId = created.jsonResponse.id as string;
    const a = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "Karte A" },
    );
    const b = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "Karte B" },
    );
    const aId = a.jsonResponse.id as string;
    const bId = b.jsonResponse.id as string;
    const linksPath = `${boardsPath}/${boardId}/cards/${aId}/links`;

    const link = await testFetcher.post(app, linksPath, token, {
      targetCardId: bId,
      type: "duplicate",
    });
    expect(link.status).toBe(200);
    const linkId = link.jsonResponse.id as string;

    // the same link twice is refused by the partial unique index
    const dupe = await testFetcher.post(app, linksPath, token, {
      targetCardId: bId,
      type: "duplicate",
    });
    expect(dupe.status).toBe(400);

    // ... but a different relation type between the same cards is fine
    const otherType = await testFetcher.post(app, linksPath, token, {
      targetCardId: bId,
      type: "relates",
    });
    expect(otherType.status).toBe(200);

    // self-links, two targets and no target at all are all rejected
    expect(
      (await testFetcher.post(app, linksPath, token, { targetCardId: aId }))
        .status,
    ).toBe(400);
    expect(
      (
        await testFetcher.post(app, linksPath, token, {
          targetCardId: bId,
          targetPageId: "00000000-0000-4000-8000-000000000000",
        })
      ).status,
    ).toBe(400);
    expect((await testFetcher.post(app, linksPath, token, {})).status).toBe(400);

    // a card outside this board cannot be linked
    const otherBoard = await createBoard({
      title: "Elsewhere",
      tenantWide: true,
    });
    const foreignCard = await testFetcher.post(
      app,
      `${boardsPath}/${otherBoard.jsonResponse.id}/cards`,
      token,
      { text: "fremd" },
    );
    const foreignLink = await testFetcher.post(app, linksPath, token, {
      targetCardId: foreignCard.jsonResponse.id,
    });
    expect(foreignLink.status).toBe(404);

    // page links carry a title snapshot so they survive the page's deletion
    const pageLink = await testFetcher.post(app, linksPath, token, {
      targetPageId: "11111111-1111-4111-8111-111111111111",
      targetPageTitle: "Onboarding",
      type: "answers",
    });
    expect(pageLink.status).toBe(200);
    expect(pageLink.jsonResponse.targetPageTitle).toBe("Onboarding");

    const detail = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(detail.jsonResponse.links.length).toBe(3);

    const removed = await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}/links/${linkId}`,
      token,
    );
    expect(removed.status).toBe(200);

    // deleting a card removes the links pointing at it
    await testFetcher.delete(
      app,
      `${boardsPath}/${boardId}/cards/${bId}`,
      token,
    );
    const afterDelete = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(
      afterDelete.jsonResponse.links.some((l: any) => l.targetCardId === bId),
    ).toBe(false);
  });

  test("a locked board refuses content changes but stays readable", async () => {
    const created = await createBoard({ title: "Frozen", tenantWide: true });
    const boardId = created.jsonResponse.id as string;
    const card = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "vor dem Einfrieren" },
    );
    const cardId = card.jsonResponse.id as string;

    await testFetcher.put(app, `${boardsPath}/${boardId}`, token, {
      settings: { locked: true },
    });

    const blocked = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "danach" },
    );
    expect(blocked.status).toBe(403);

    const blockedComment = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/comments`,
      token,
      { text: "noch ein Gedanke" },
    );
    expect(blockedComment.status).toBe(403);

    // reading still works, and the board can be unlocked again
    const detail = await testFetcher.get(
      app,
      `${boardsPath}/${boardId}`,
      token,
    );
    expect(detail.status).toBe(200);
    expect(detail.jsonResponse.cards.length).toBe(1);

    await testFetcher.put(app, `${boardsPath}/${boardId}`, token, {
      settings: { locked: false },
    });
    const afterUnlock = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "danach" },
    );
    expect(afterUnlock.status).toBe(200);
  });

  test("a card can be promoted to a wiki page", async () => {
    // personal board => the page is created in the user's own scope
    const created = await createBoard({ title: "Ideas to write up" });
    const boardId = created.jsonResponse.id as string;
    const card = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards`,
      token,
      { text: "Retro-Format überarbeiten\n\nMehr Zeit für Ursachen." },
    );
    const cardId = card.jsonResponse.id as string;

    const promoted = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/promote`,
      token,
      {},
    );
    expect(promoted.status).toBe(200);
    const pageId = promoted.jsonResponse.pageId as string;
    expect(pageId).toBeTruthy();
    createdPages.push(pageId);
    expect(promoted.jsonResponse.card.pageId).toBe(pageId);

    // the page exists, titled after the card's first line
    const page = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, pageId))
      .limit(1);
    expect(page[0]?.title).toBe("Retro-Format überarbeiten");
    expect(page[0]?.text).toContain("Mehr Zeit für Ursachen.");

    // promoting twice is refused — the card already has its page
    const again = await testFetcher.post(
      app,
      `${boardsPath}/${boardId}/cards/${cardId}/promote`,
      token,
      {},
    );
    expect(again.status).toBe(400);
  });

  test("unknown ids yield 404", async () => {
    const missing = "22222222-2222-4222-8222-222222222222";
    expect(
      (await testFetcher.get(app, `${boardsPath}/${missing}`, token)).status,
    ).toBe(404);

    const created = await createBoard({ title: "Probing", tenantWide: true });
    const boardId = created.jsonResponse.id as string;
    expect(
      (
        await testFetcher.put(
          app,
          `${boardsPath}/${boardId}/cards/${missing}`,
          token,
          { text: "x" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await testFetcher.delete(
          app,
          `${boardsPath}/${boardId}/links/${missing}`,
          token,
        )
      ).status,
    ).toBe(404);
  });
});
