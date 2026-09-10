/**
 * Splitting one long wiki page into a parent page plus one subpage per section.
 *
 * A document imported in one piece becomes one page, however long it is. That
 * is fine for a handbook chapter and wrong for a 230.000-character price list:
 * the page is opened as a whole, embedded as a whole, and carried through
 * every editor save as a whole, and past a few hundred kilobytes of tables it
 * stops being usable in a browser at all. The wiki's own answer to that is the
 * page tree — a section per page, navigable in the sidebar, loaded on demand —
 * so this module turns the flat page into exactly that.
 *
 * What it does:
 *   - it picks the split level itself: the shallowest heading level that occurs
 *     more than once, which is the level a document is actually structured by
 *     (an H1 title followed by H2 chapters splits at the H2s),
 *   - everything above the first heading of that level stays on the parent as
 *     its introduction, and the parent gets an index of `[[wikilinks]]` to its
 *     new children — the wiki's own reference syntax, so the links show up in
 *     the link graph and in "outgoing links" like any other reference,
 *   - each section becomes a child page whose title is the heading (the heading
 *     line itself is dropped from the content: the page title is that heading),
 *   - the children keep the parent's scope and ownership, and are ordered in
 *     document order via the sidebar's fractional-index `position`.
 *
 * The children are created BEFORE the parent is rewritten. The two steps are
 * not one transaction, so if the second half fails the content exists twice
 * rather than not at all — recoverable in the direction that matters.
 *
 * Everything downstream follows from the block sync: the parent's and the
 * children's `text` caches are re-materialized, history is written, links are
 * re-extracted and the embeddings are re-synced.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import {
  createKnowledgeText,
  getKnowledgeTextById,
  checkKnowledgeTextWritePermission,
} from "@framework/lib/knowledge/knowledge-texts";
import {
  getKnowledgeTextBlocks,
  syncKnowledgeTextBlocks,
  type KnowledgeTextBlockInput,
} from "@framework/lib/knowledge/knowledge-text-blocks";
import { assignPositions } from "@framework/lib/utils/fractional-index";
import {
  MAX_SUBPAGES,
  NOTHING_TO_SPLIT_MESSAGE,
  TOO_MANY_SECTIONS_MESSAGE,
  planPageSplit,
  type SplitBlock,
} from "./split-plan";

export type SplitPageResult = {
  pageId: string;
  level: number;
  created: { id: string; title: string }[];
};

/** The parent's index of its new children, as one markdown block. */
const indexBlock = (titles: string[]): KnowledgeTextBlockInput => ({
  type: "markdown",
  content: titles.map((title) => `- [[${title}]]`).join("\n"),
});

const toBlockInput = (block: SplitBlock): KnowledgeTextBlockInput => ({
  type: block.type,
  content: block.content,
});

/**
 * Give the parent's children their sidebar order.
 *
 * A page created without a `position` sorts by title, which would scramble the
 * document order the sections were in. Existing children keep their place and
 * the new ones are appended in section order; only the rows whose key actually
 * changes are written.
 */
const orderChildren = async (
  parentId: string,
  tenantId: string,
  newChildIds: string[]
): Promise<void> => {
  const db = getDb();
  const existing = await db
    .select({ id: knowledgeText.id, position: knowledgeText.position })
    .from(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, tenantId),
        eq(knowledgeText.parentId, parentId)
      )
    )
    .orderBy(asc(knowledgeText.position), asc(knowledgeText.title));

  const newIds = new Set(newChildIds);
  const ordered = [
    ...existing.filter((row) => !newIds.has(row.id)),
    ...newChildIds.map(
      (id) => existing.find((row) => row.id === id) ?? { id, position: null }
    ),
  ];

  const positions = assignPositions(ordered);
  await Promise.all(
    ordered.map((row, index) =>
      row.position === positions[index]
        ? Promise.resolve()
        : db
            .update(knowledgeText)
            .set({ position: positions[index] })
            .where(eq(knowledgeText.id, row.id))
    )
  );
};

/**
 * Split a page into one child page per section.
 *
 * Requires read and write access to the page — the children inherit its scope,
 * so no further check is needed for them. Throws when the page has no repeated
 * heading level (nothing to split) or would produce more than `MAX_SUBPAGES`.
 */
export const splitPageIntoSubpages = async (
  pageId: string,
  context: { tenantId: string; userId?: string }
): Promise<SplitPageResult> => {
  const page = await getKnowledgeTextById(pageId, context);
  await checkKnowledgeTextWritePermission(page, context);

  const stored = await getKnowledgeTextBlocks(pageId, context);
  const blocks: SplitBlock[] =
    stored.length > 0
      ? stored.map((block) => ({
          id: block.id,
          type: block.type === "html" ? "html" : "markdown",
          content: block.content,
        }))
      : // a page still in `contentMode = "text"` has no blocks; its whole text
        // is one markdown block for the purpose of the split
        [{ type: "markdown", content: page.text ?? "" }];

  const plan = planPageSplit(blocks);
  if (!plan || plan.sections.length < 2) {
    throw new Error(NOTHING_TO_SPLIT_MESSAGE);
  }
  if (plan.sections.length > MAX_SUBPAGES) {
    throw new Error(TOO_MANY_SECTIONS_MESSAGE);
  }

  // children first: a failure here leaves the parent's content untouched
  const created: { id: string; title: string }[] = [];
  for (const section of plan.sections) {
    const child = await createKnowledgeText(
      {
        tenantId: page.tenantId,
        userId: page.userId ?? undefined,
        teamId: page.teamId ?? undefined,
        tenantWide: page.tenantWide,
        parentId: page.id,
        createdBy: context.userId,
        updatedBy: context.userId,
        title: section.title,
        text: "",
      },
      { skipEmbeddingSync: true }
    );
    // the section's blocks are new rows on a new page, so they are inserted
    // without ids rather than carrying the parent's block ids along
    await syncKnowledgeTextBlocks(
      child.id,
      section.blocks.map(toBlockInput),
      context
    );
    created.push({ id: child.id, title: section.title });
  }

  await orderChildren(
    page.id,
    page.tenantId,
    created.map((child) => child.id)
  );

  await syncKnowledgeTextBlocks(
    pageId,
    [
      ...plan.intro.map(toBlockInput),
      indexBlock(created.map((child) => child.title)),
    ],
    context
  );

  return { pageId, level: plan.level, created };
};
