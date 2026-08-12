import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import {
  knowledgeText,
  knowledgeTextBlock,
} from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import {
  DEFAULT_REBALANCE_THRESHOLD,
  rebalanceBlockPositions,
} from "./rebalance-positions";

const TENANT = TEST_ORGANISATION_1.id;
const OWNER = TEST_ORG1_USER_1.id;

/** Ids created here, so cleanup removes exactly those (the tenant is shared). */
const created: string[] = [];

const deleteTestPages = () =>
  created.length > 0
    ? getDb().delete(knowledgeText).where(inArray(knowledgeText.id, created))
    : Promise.resolve();

/**
 * A page whose block keys are already over-long, i.e. the state a page reaches
 * after a few hundred appends. Written directly so the fixture does not depend
 * on how the keys got that long.
 */
const pageWithLongKeys = async (
  title: string,
  contents: string[]
): Promise<string> => {
  const page = await createKnowledgeText({
    title,
    text: contents.join("\n\n"),
    tenantId: TENANT,
    userId: OWNER,
    tenantWide: true,
    contentMode: "blocks",
  });
  created.push(page.id);

  await getDb()
    .insert(knowledgeTextBlock)
    .values(
      contents.map((content, i) => ({
        knowledgeTextId: page.id,
        tenantId: TENANT,
        type: "markdown" as const,
        content,
        // strictly ascending and well past the threshold
        position: "z".repeat(40) + String.fromCharCode(98 + i),
        meta: {},
      }))
    );
  return page.id;
};

const blocksOf = (pageId: string) =>
  getDb()
    .select({
      id: knowledgeTextBlock.id,
      content: knowledgeTextBlock.content,
      position: knowledgeTextBlock.position,
    })
    .from(knowledgeTextBlock)
    .where(eq(knowledgeTextBlock.knowledgeTextId, pageId))
    .orderBy(asc(knowledgeTextBlock.position));

const pageRow = async (pageId: string) => {
  const [row] = await getDb()
    .select()
    .from(knowledgeText)
    .where(eq(knowledgeText.id, pageId));
  return row!;
};

/**
 * Guards the one-off repair for the 400-on-save bug: pages whose fractional
 * index keys outgrew varchar(64) (~257 blocks). The rewrite has to compact the
 * keys without changing block order, block content, or any of the page state
 * that would trigger re-embedding / summary regeneration.
 */
describe("rebalanceBlockPositions", () => {
  beforeAll(async () => {
    await initTests();
  });

  afterAll(() => {
    deleteTestPages().catch((error) =>
      console.warn("afterAll cleanup failed:", error)
    );
  });

  /**
   * Migration 0008 is hand-written (it widens framework columns from the app's
   * migration folder). If it ever stops being applied, block keys silently get
   * a 64-character ceiling back and long pages start failing on save with 400.
   */
  test("migration 0008 widened the position columns to text", async () => {
    const rows = await getDb().execute<{
      table_name: string;
      data_type: string;
      character_maximum_length: number | null;
    }>(sql`
      SELECT table_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name IN ('base_knowledge_text', 'base_knowledge_text_block')
        AND column_name = 'position'
      ORDER BY table_name
    `);
    const columns = Array.isArray(rows) ? rows : Array.from(rows as any);
    expect(columns.length).toBe(2);
    for (const column of columns as { data_type: string }[]) {
      expect(column.data_type).toBe("text");
    }
  });

  test("compacts long keys, preserving order and content", async () => {
    const contents = ["first", "second", "third", "fourth", "fifth"];
    const pageId = await pageWithLongKeys("rebalance: long keys", contents);

    const before = await blocksOf(pageId);
    const pageBefore = await pageRow(pageId);
    expect(before.map((b) => b.content)).toEqual(contents);
    expect(Math.max(...before.map((b) => b.position.length))).toBeGreaterThan(
      DEFAULT_REBALANCE_THRESHOLD
    );

    const result = await rebalanceBlockPositions({ tenantId: TENANT });
    expect(result.rebalanced).toBeGreaterThanOrEqual(1);

    const after = await blocksOf(pageId);
    // same blocks, same order, same text — only the keys changed
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(after.map((b) => b.content)).toEqual(contents);
    expect(Math.max(...after.map((b) => b.position.length))).toBeLessThanOrEqual(
      DEFAULT_REBALANCE_THRESHOLD
    );
    // keys stay strictly ascending, or the page order would be undefined
    for (let i = 1; i < after.length; i++) {
      expect(after[i - 1]!.position < after[i]!.position).toBe(true);
    }
    // no real key may survive from the temporary pass
    expect(after.every((b) => /^[a-z]+$/.test(b.position))).toBe(true);

    // a pure position rewrite must not look like a content change
    const pageAfter = await pageRow(pageId);
    expect(pageAfter.updatedAt).toBe(pageBefore.updatedAt);
    expect(pageAfter.summaryStale).toBe(pageBefore.summaryStale);
    expect(pageAfter.text).toBe(pageBefore.text);
  });

  test("is idempotent — a second run finds nothing to do", async () => {
    await pageWithLongKeys("rebalance: idempotent", ["one", "two", "three"]);

    const first = await rebalanceBlockPositions({ tenantId: TENANT });
    expect(first.rebalanced).toBeGreaterThanOrEqual(1);

    const second = await rebalanceBlockPositions({ tenantId: TENANT });
    expect(second.candidates).toBe(0);
    expect(second.rebalanced).toBe(0);
  });

  test("dry run reports candidates without writing", async () => {
    const pageId = await pageWithLongKeys("rebalance: dry run", ["a", "b"]);
    const before = await blocksOf(pageId);

    const result = await rebalanceBlockPositions({
      tenantId: TENANT,
      dryRun: true,
    });
    expect(result.candidates).toBeGreaterThanOrEqual(1);
    expect(result.rebalanced).toBe(0);
    expect(result.pages.some((p) => p.knowledgeTextId === pageId)).toBe(true);

    const after = await blocksOf(pageId);
    expect(after.map((b) => b.position)).toEqual(
      before.map((b) => b.position)
    );
  });

  test("leaves pages below the threshold alone", async () => {
    const page = await createKnowledgeText({
      title: "rebalance: short keys",
      text: "short",
      tenantId: TENANT,
      userId: OWNER,
      tenantWide: true,
      contentMode: "blocks",
    });
    created.push(page.id);
    await getDb()
      .insert(knowledgeTextBlock)
      .values([
        {
          knowledgeTextId: page.id,
          tenantId: TENANT,
          type: "markdown" as const,
          content: "short",
          position: "n",
          meta: {},
        },
      ]);

    await rebalanceBlockPositions({ tenantId: TENANT });

    const [block] = await blocksOf(page.id);
    expect(block!.position).toBe("n"); // untouched
  });
});
