/**
 * One-time consolidation of a tenant's page images into a single bucket.
 *
 * Historically a page's pictures could end up in either of two buckets: the
 * block editor uploads into "knowledge", while a parsing service extracting
 * images from an imported document (PDF / URL import) stored them in
 * "images". Only the first bucket takes part in the page's file bookkeeping —
 * reference rows, expiry, cleanup when the page or the last reference goes
 * away — and only the first was readable through the page-scoped image
 * endpoints, which is why images on imported pages 404'd for MCP clients.
 *
 * The framework parser now writes new imports straight into the page bucket
 * (`PdfParserOptions.imageBucket`). This migration is the other half: it moves
 * the images already sitting in the parser bucket, rewrites the references
 * that point at them, and hands the moved files to the page's reference
 * tracking. Both halves are needed — without the parser change every new
 * import recreates the split, without this one the existing pages keep it.
 *
 * Properties worth knowing:
 *
 *   - The file keeps its id, so a move is a bucket column plus a path rewrite;
 *     no bytes are copied and no reference changes meaning.
 *   - Idempotent: a second run finds nothing left in the parser bucket.
 *   - References whose file no longer exists are left untouched and reported
 *     as `danglingReferences` — rewriting them would turn a visibly broken
 *     image into one that merely looks like it should work.
 *   - Page content is written directly, so `updatedAt` does not move and no
 *     re-embedding is triggered. Chunks keep the old paths in their mirrored
 *     text; image paths are noise for retrieval, and re-embedding a whole
 *     wiki to tidy them up would be real money for no gain.
 */
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { files } from "@framework/lib/db/schema/files";
import {
  knowledgeText,
  knowledgeTextBlock,
  knowledgeTextHistory,
  type KnowledgeTextBlockSnapshot,
} from "@framework/lib/db/schema/knowledge";
import {
  KNOWLEDGE_FILES_BUCKET,
  syncKnowledgeTextFileReferences,
} from "@framework/lib/knowledge/knowledge-text-files";
import log from "@framework/lib/log";
import { PARSED_IMAGES_BUCKET } from "./images";

/** Path prefix of an image still living in the parser's bucket. */
const PARSED_IMAGE_PATH = `/files/db/${PARSED_IMAGES_BUCKET}/`;
const PAGE_IMAGE_PATH = `/files/db/${KNOWLEDGE_FILES_BUCKET}/`;
const LIKE_PARSED_IMAGE = `%${PARSED_IMAGE_PATH}%`;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PARSED_IMAGE_REFERENCE = new RegExp(`${PARSED_IMAGE_PATH}(${UUID})`, "gi");

export type ImageBucketMigrationResult = {
  /** Files moved from the parser bucket into the page bucket. */
  movedFiles: number;
  /** Pages whose content (text cache) was rewritten. */
  rewrittenPages: number;
  /** Blocks whose content was rewritten. */
  rewrittenBlocks: number;
  /** History versions whose snapshot was rewritten. */
  rewrittenVersions: number;
  /** File reference rows added by the page bookkeeping afterwards. */
  addedReferences: number;
  /** References to files that no longer exist — left as they are. */
  danglingReferences: number;
  /** True when nothing was written (report only). */
  dryRun: boolean;
};

const EMPTY = (dryRun: boolean): ImageBucketMigrationResult => ({
  movedFiles: 0,
  rewrittenPages: 0,
  rewrittenBlocks: 0,
  rewrittenVersions: 0,
  addedReferences: 0,
  danglingReferences: 0,
  dryRun,
});

/** Every parser-bucket file id a piece of content references. */
const referencedIds = (content: string): string[] =>
  [...content.matchAll(PARSED_IMAGE_REFERENCE)].map((m) => m[1]!.toLowerCase());

/**
 * Point the references of moved files at the page bucket, leaving every other
 * reference — a file that was not moved, another bucket entirely — untouched.
 */
const rewrite = (content: string, moved: Set<string>): string =>
  content.replace(PARSED_IMAGE_REFERENCE, (whole, id: string) =>
    moved.has(id.toLowerCase()) ? `${PAGE_IMAGE_PATH}${id}` : whole
  );

/** Rewrite a history snapshot's blocks, or return null when nothing changes. */
const rewriteSnapshots = (
  blocks: KnowledgeTextBlockSnapshot[] | null,
  moved: Set<string>
): KnowledgeTextBlockSnapshot[] | null => {
  if (!blocks) return null;
  let changed = false;
  const out = blocks.map((block) => {
    const content = rewrite(block.content ?? "", moved);
    if (content === block.content) return block;
    changed = true;
    return { ...block, content };
  });
  return changed ? out : null;
};

/**
 * Move a tenant's parser-bucket page images into the page bucket.
 *
 * With `dryRun` the same work is computed and reported, but nothing is
 * written — the counts say exactly what a real run would change.
 */
export const migrateParsedImagesIntoPageBucket = async (
  tenantId: string,
  options?: { dryRun?: boolean }
): Promise<ImageBucketMigrationResult> => {
  const db = getDb();
  const dryRun = options?.dryRun ?? false;

  const pages = await db
    .select({ id: knowledgeText.id, text: knowledgeText.text })
    .from(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, tenantId),
        like(knowledgeText.text, LIKE_PARSED_IMAGE)
      )
    );

  const blocks = await db
    .select({
      id: knowledgeTextBlock.id,
      knowledgeTextId: knowledgeTextBlock.knowledgeTextId,
      content: knowledgeTextBlock.content,
    })
    .from(knowledgeTextBlock)
    .where(
      and(
        eq(knowledgeTextBlock.tenantId, tenantId),
        like(knowledgeTextBlock.content, LIKE_PARSED_IMAGE)
      )
    );

  const versions = await db
    .select({
      id: knowledgeTextHistory.id,
      text: knowledgeTextHistory.text,
      blocks: knowledgeTextHistory.blocks,
    })
    .from(knowledgeTextHistory)
    .where(
      and(
        eq(knowledgeTextHistory.tenantId, tenantId),
        or(
          like(knowledgeTextHistory.text, LIKE_PARSED_IMAGE),
          sql`${knowledgeTextHistory.blocks}::text LIKE ${LIKE_PARSED_IMAGE}`
        )
      )
    );

  const candidates = new Set<string>();
  for (const page of pages) referencedIds(page.text).forEach((id) => candidates.add(id));
  for (const block of blocks)
    referencedIds(block.content).forEach((id) => candidates.add(id));
  for (const version of versions) {
    referencedIds(version.text).forEach((id) => candidates.add(id));
    for (const snapshot of version.blocks ?? [])
      referencedIds(snapshot.content ?? "").forEach((id) => candidates.add(id));
  }

  if (candidates.size === 0) return EMPTY(dryRun);

  const movable = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.tenantId, tenantId),
        eq(files.bucket, PARSED_IMAGES_BUCKET),
        inArray(files.id, [...candidates])
      )
    );
  const moved = new Set(movable.map((file) => file.id.toLowerCase()));

  const result = EMPTY(dryRun);
  result.movedFiles = moved.size;
  result.danglingReferences = candidates.size - moved.size;
  if (moved.size === 0) return result;

  // Compute every rewrite first, so a dry run reports exactly what a real run
  // would touch instead of a rough estimate.
  const pageUpdates = pages
    .map((page) => ({
      id: page.id,
      text: rewrite(page.text, moved),
      before: page.text,
    }))
    .filter((update) => update.text !== update.before);
  const blockUpdates = blocks
    .map((block) => ({
      id: block.id,
      pageId: block.knowledgeTextId,
      content: rewrite(block.content, moved),
      before: block.content,
    }))
    .filter((update) => update.content !== update.before);
  const versionUpdates = versions
    .map((version) => ({
      id: version.id,
      text: rewrite(version.text, moved),
      before: version.text,
      blocks: rewriteSnapshots(version.blocks, moved),
    }))
    .filter((update) => update.text !== update.before || update.blocks !== null);

  result.rewrittenPages = pageUpdates.length;
  result.rewrittenBlocks = blockUpdates.length;
  result.rewrittenVersions = versionUpdates.length;
  if (dryRun) return result;

  await db
    .update(files)
    .set({ bucket: KNOWLEDGE_FILES_BUCKET })
    .where(inArray(files.id, [...moved]));

  for (const update of pageUpdates) {
    await db
      .update(knowledgeText)
      .set({ text: update.text })
      .where(eq(knowledgeText.id, update.id));
  }
  for (const update of blockUpdates) {
    await db
      .update(knowledgeTextBlock)
      .set({ content: update.content })
      .where(eq(knowledgeTextBlock.id, update.id));
  }
  for (const update of versionUpdates) {
    await db
      .update(knowledgeTextHistory)
      .set({
        text: update.text,
        ...(update.blocks ? { blocks: update.blocks } : {}),
      })
      .where(eq(knowledgeTextHistory.id, update.id));
  }

  // Hand the moved files to the page bookkeeping: reference rows, expiry
  // cleared. Read the pages back rather than reusing the in-memory text — a
  // page reached only through one of its blocks has no entry above.
  const affectedPageIds = [
    ...new Set([
      ...pageUpdates.map((update) => update.id),
      ...blockUpdates.map((update) => update.pageId),
    ]),
  ];
  if (affectedPageIds.length > 0) {
    const affected = await db
      .select({
        id: knowledgeText.id,
        tenantId: knowledgeText.tenantId,
        text: knowledgeText.text,
      })
      .from(knowledgeText)
      .where(inArray(knowledgeText.id, affectedPageIds));

    for (const page of affected) {
      const { added } = await syncKnowledgeTextFileReferences(page);
      result.addedReferences += added;
    }
  }

  log.info(
    `Wiki image bucket migration for tenant ${tenantId}: ` +
      `${result.movedFiles} file(s) moved, ${result.rewrittenPages} page(s), ` +
      `${result.rewrittenBlocks} block(s), ${result.rewrittenVersions} version(s) ` +
      `rewritten, ${result.addedReferences} reference(s) added, ` +
      `${result.danglingReferences} dangling reference(s) left as they are.`
  );

  return result;
};
