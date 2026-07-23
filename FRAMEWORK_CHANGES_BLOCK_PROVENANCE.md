# Framework change — chunk → block provenance (jump-to-spot)

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented + tested locally in this environment
>
> The change is **applied in the local `backend/framework` submodule working
> tree** and verified — `bun test
> framework/src/lib/knowledge/block-provenance.test.ts` → 7 pass, framework +
> app `tsc --noEmit` clean. The wiki-side consumers (search deep-link, page
> scroll-to-block) are committed in `symbiosika/wiki` and work against this
> change end-to-end.
>
> **Line-precise export:** `framework-block-provenance.patch` at the wiki repo
> root is a `git diff` of exactly these changes (8 modified files, 3 new
> files). Apply it in a clean framework checkout:
> ```bash
> cd backend/framework
> git checkout -b claude/chunk-block-provenance
> git apply ../../framework-block-provenance.patch
> bun test src/lib/knowledge/block-provenance.test.ts   # 7 pass
> git add -A && git commit -m "feat(knowledge): tag chunks with source block id (jump-to-spot)"
> git push -u origin claude/chunk-block-provenance
> ```
>
> **⚠️ Submodule pointer:** I cannot push to the framework repo (session scope
> is `symbiosika/wiki` only), so the wiki submodule pointer is **left
> untouched** (still at the current upstream SHA). After you land the framework
> commit upstream, bump the pointer:
> ```bash
> cd backend/framework && git fetch origin && git checkout <new-sha>
> cd ../.. && git add backend/framework \
>   && git commit -m "chore: bump framework to chunk-block-provenance"
> ```

**Why:** A search hit or RAG citation could only navigate to the *page*, never
to the *spot* inside it — chunks stored no back-reference to the source
document beyond a heading string and a sequence number. This change records,
per chunk, the id of the content block it starts in, so the UI can scroll
straight to that block (`?block=<id>` deep-link + highlight, already wired in
the wiki app).

**Design guarantee:** chunk **boundaries, text and embeddings are byte-for-byte
unchanged.** Provenance is a purely additive post-processing step over the
already-produced chunks — the chunkers themselves are untouched. So no
re-embedding is forced; pages pick up `blockId` the next time their embedding
mirror is (re)synced after an edit. (To backfill eagerly, trigger a re-sync of
embedding-enabled pages.)

Everything is backward compatible: `blockSpans` is optional throughout, and
non-block sources (PDF/URL/file imports) never pass it, so their chunks are
unaffected.

---

## Files

### New — `src/lib/knowledge/materialize-blocks.ts`
Pure, DB-free extraction of the block → `text` materialization (moved out of
`knowledge-text-blocks.ts` so it can be unit-tested and reused). Adds
`materializeBlocksTextWithSpans(blocks)` which returns the **identical** text
as `materializeBlocksText` plus the half-open character span each block
occupies in it.

### New — `src/lib/knowledge/block-provenance.ts`
`assignBlockProvenance(chunks, text, spans)` — walks the chunks in reading
order with a forward cursor, locates each chunk's start offset in `text`, and
sets `chunk.meta.blockId` to the block whose span contains that offset. Offset
based, so it is independent of the chunking strategy. Degrades gracefully: a
chunk whose anchor can't be located inherits the previous chunk's block, and it
no-ops when no spans are given.

### New — `src/lib/knowledge/block-provenance.test.ts`
Unit tests: exact span materialization, empty-block dropping, correct mapping
under both the simple and smart splitters, boundary-preservation, and the
no-span / unlocatable-anchor fallbacks.

### Modified
- `src/lib/types/chunks.ts` — `Chunk.meta.blockId?: string`.
- `src/lib/db/schema/knowledge.ts` — `KnowledgeChunkMeta.blockId?: string`
  (persisted in the existing `knowledge_chunks.meta` jsonb — **no migration**).
- `src/lib/knowledge/knowledge-text-blocks.ts` — materialization moved to the
  pure module; re-exported for the unchanged historical import site.
- `src/lib/knowledge/add-knowledge.ts` /
  `src/lib/knowledge/upsert-knowledge.ts` — accept optional `blockSpans` and
  call `assignBlockProvenance` right after chunking (insert + replace paths).
  Text-based only; ignored for `pages` input.
- `src/lib/knowledge/knowledge-text-embedding.ts` — the wiki embedding sync
  builds the block spans from the page's blocks and passes them down. Spans are
  used only when the freshly materialized text matches the stored `text` cache,
  so a drifted legacy page skips provenance instead of mis-mapping.
- `src/lib/knowledge/knowledge-text-search.ts` — the semantic leg selects
  `meta->>'blockId'`; `KnowledgeTextSearchResult.blockId: string | null` is
  surfaced (null for fulltext-only hits).
- `src/lib/knowledge/knowledge-text-chunks.ts` — `PageChunkContextItem.blockId`
  added, so `getPageChunkContext` (MCP `get_page_chunk_context`) exposes it too.

## Wiki-app consumers (already in `symbiosika/wiki`, this branch)
- `backend/src/ai/tools/wiki/index.ts` — passes `blockId` through the search /
  chunk-context tool outputs so agents/MCP can deep-link as well.
- `frontend/src/types/wiki.ts` — `WikiSearchResult` widened
  (`blockId`, `chunkOrder`, `sourcePage`, `path`).
- `frontend/src/components/wiki/WikiSidebar.vue` — `openSearchResult`
  deep-links with `?block=<id>` (exact) and `?match=<query>` (fallback).
- `frontend/src/views/wiki/page.vue` — after the editor renders, scrolls to the
  target block (or the first block matching the query) and pulses a highlight.
