/**
 * Maintenance: compact the fractional-index keys of block pages.
 *
 * Blocks are ordered by `knowledge_text_block.position`, a fractional-index key
 * (see framework/src/lib/utils/fractional-index.ts). `assignPositions` only ever
 * generates a key *between* two neighbours, and appending at the end means
 * "between the last key and infinity" — which grows the key by roughly one
 * character per four appended blocks. A page therefore accumulates keys of
 * ~N/4 characters, and used to hit the old `varchar(64)` ceiling at ~257 blocks:
 * from there on every save failed with "value too long for type character
 * varying(64)", surfacing as HTTP 400 in the editor.
 *
 * Migration 0008 widened the column to `text`, so long keys are storable again
 * and no page is blocked. This module is the second half: it rewrites the keys
 * of already-affected pages compactly (`generateNKeysBetween` produces 3-4
 * characters for thousands of blocks), so the index stays small and the keys
 * start growing again from a clean base.
 *
 * It is a one-off repair for existing data. New growth is bounded by the
 * on-save rebalance in `assignPositions` — a framework-side change that ships
 * separately (see FRAMEWORK_CHANGES_POSITION_REBALANCE.md); until that release
 * lands, re-running this script occasionally keeps keys short.
 *
 * Safety: a position rewrite is invisible to everything else. Block order is
 * preserved, so the materialized page text is byte-identical; chunk provenance
 * keys on block id, not position; `knowledge_text.updatedAt` / `summaryStale`
 * are untouched, so no re-embedding, no summary regeneration and no webhook are
 * triggered. Each page is rewritten in its own transaction that first takes a
 * row lock on the page, so a concurrent editor save cannot interleave.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import {
  knowledgeText,
  knowledgeTextBlock,
} from "@framework/lib/db/schema/knowledge";
import { generateNKeysBetween } from "@framework/lib/utils/fractional-index";

/**
 * Rewrite a page once its longest key passes this many characters. Matches the
 * on-save threshold in the framework's `assignPositions`, so both halves of the
 * fix agree on what "too long" means.
 */
export const DEFAULT_REBALANCE_THRESHOLD = 32;

export type RebalanceOptions = {
  /** restrict to one tenant; omitted = every tenant */
  tenantId?: string;
  /** rewrite pages whose longest key exceeds this (default 32) */
  threshold?: number;
  /** report what would change without writing */
  dryRun?: boolean;
};

export type RebalancedPage = {
  knowledgeTextId: string;
  tenantId: string;
  title: string;
  blocks: number;
  maxKeyLengthBefore: number;
  maxKeyLengthAfter: number;
};

export type RebalanceResult = {
  /** pages found above the threshold */
  candidates: number;
  /** pages actually rewritten (always 0 for a dry run) */
  rebalanced: number;
  pages: RebalancedPage[];
};

/**
 * Temporary keys used between the two update passes.
 *
 * A page's keys are unique per page (`knowledge_text_block_page_position_idx`),
 * and that index is not deferrable — so moving row B onto row A's old key fails
 * mid-statement even though the final state is conflict-free. Both passes
 * therefore park every row on a value that cannot collide with a real key
 * (`^[a-z]+$`) nor with a concurrent run: `~` sorts outside the key alphabet and
 * the random token keeps two overlapping transactions apart.
 */
const tempKeys = (count: number): string[] => {
  const token = Math.random().toString(36).slice(2, 8);
  return Array.from({ length: count }, (_, i) => `~${token}-${i}`);
};

/** Longest key currently stored for a page, 0 for a page without blocks. */
const maxKeyLength = (positions: string[]): number =>
  positions.reduce((max, key) => Math.max(max, key.length), 0);

/**
 * Rewrite one page's block positions compactly. Returns the page's before/after
 * key lengths, or null when it turned out not to need the rewrite after all
 * (another run or an editor save got there first — this makes the whole
 * operation idempotent and safe to repeat).
 */
const rebalancePage = async (
  knowledgeTextId: string,
  threshold: number
): Promise<{ blocks: number; before: number; after: number } | null> =>
  await getDb().transaction(async (trx) => {
    // Fence concurrent saves of this page: syncKnowledgeTextBlocks writes its
    // blocks under the page row, so locking it here serialises us against it.
    const [page] = await trx
      .select({ id: knowledgeText.id })
      .from(knowledgeText)
      .where(eq(knowledgeText.id, knowledgeTextId))
      .for("update");
    if (!page) return null;

    const blocks = await trx
      .select({ id: knowledgeTextBlock.id, position: knowledgeTextBlock.position })
      .from(knowledgeTextBlock)
      .where(eq(knowledgeTextBlock.knowledgeTextId, knowledgeTextId))
      .orderBy(asc(knowledgeTextBlock.position));

    const before = maxKeyLength(blocks.map((b) => b.position));
    // re-checked inside the lock: the page may have been fixed meanwhile
    if (blocks.length === 0 || before <= threshold) return null;

    const finalKeys = generateNKeysBetween(null, null, blocks.length);
    const temps = tempKeys(blocks.length);

    // pass 1: park every row outside the key alphabet
    for (let i = 0; i < blocks.length; i++) {
      await trx
        .update(knowledgeTextBlock)
        .set({ position: temps[i]! })
        .where(eq(knowledgeTextBlock.id, blocks[i]!.id));
    }
    // pass 2: write the compact keys, preserving the read order
    for (let i = 0; i < blocks.length; i++) {
      await trx
        .update(knowledgeTextBlock)
        .set({ position: finalKeys[i]! })
        .where(eq(knowledgeTextBlock.id, blocks[i]!.id));
    }

    return { blocks: blocks.length, before, after: maxKeyLength(finalKeys) };
  });

/**
 * Find every page whose block keys have grown past `threshold` and compact
 * them. Idempotent: a second run finds nothing left to do.
 */
export const rebalanceBlockPositions = async (
  options: RebalanceOptions = {}
): Promise<RebalanceResult> => {
  const threshold = options.threshold ?? DEFAULT_REBALANCE_THRESHOLD;
  const db = getDb();

  const candidates = await db
    .select({
      knowledgeTextId: knowledgeTextBlock.knowledgeTextId,
      tenantId: knowledgeTextBlock.tenantId,
      title: knowledgeText.title,
      blocks: sql<number>`count(*)::int`,
      maxKeyLength: sql<number>`max(length(${knowledgeTextBlock.position}))::int`,
    })
    .from(knowledgeTextBlock)
    .innerJoin(
      knowledgeText,
      eq(knowledgeText.id, knowledgeTextBlock.knowledgeTextId)
    )
    .where(
      options.tenantId
        ? eq(knowledgeTextBlock.tenantId, options.tenantId)
        : undefined
    )
    .groupBy(
      knowledgeTextBlock.knowledgeTextId,
      knowledgeTextBlock.tenantId,
      knowledgeText.title
    )
    .having(sql`max(length(${knowledgeTextBlock.position})) > ${threshold}`);

  const pages: RebalancedPage[] = [];
  let rebalanced = 0;

  for (const candidate of candidates) {
    if (options.dryRun) {
      pages.push({
        knowledgeTextId: candidate.knowledgeTextId,
        tenantId: candidate.tenantId,
        title: candidate.title,
        blocks: candidate.blocks,
        maxKeyLengthBefore: candidate.maxKeyLength,
        maxKeyLengthAfter: candidate.maxKeyLength,
      });
      continue;
    }

    const result = await rebalancePage(candidate.knowledgeTextId, threshold);
    if (!result) continue;

    rebalanced++;
    pages.push({
      knowledgeTextId: candidate.knowledgeTextId,
      tenantId: candidate.tenantId,
      title: candidate.title,
      blocks: result.blocks,
      maxKeyLengthBefore: result.before,
      maxKeyLengthAfter: result.after,
    });
  }

  return { candidates: candidates.length, rebalanced, pages };
};
