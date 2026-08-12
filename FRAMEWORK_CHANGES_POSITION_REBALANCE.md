# Framework change — bound the growth of fractional-index ordering keys

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented + tested locally in this environment
>
> The change is **applied in the local `backend/framework` submodule working
> tree** and verified:
> `bun run test:local ./framework/src/lib/utils/fractional-index.test.ts` → 20 pass,
> `bun run test:local "./framework/src/routes/tenant/[tenantId]/knowledge/texts/blocks.test.ts"` → 11 pass,
> `bun run test:local ./framework/src/lib/knowledge/` → 409 pass / 9 skip / 0 fail,
> `bun run typecheck` clean.
>
> **Line-precise export:** `framework-position-rebalance.patch` at the wiki repo
> root is a `git diff` of exactly these changes (5 files, source only — the
> migration is generated, see below).
>
> **⚠️ Submodule pointer:** the session scope is `symbiosika/wiki` only, so the
> framework commit was not pushed and the wiki submodule pointer is **left
> untouched**. Until this lands upstream and the pointer is bumped, the
> deployed backend does **not** contain this change — CI builds the pinned
> submodule SHA. What ships from the wiki repo today is the column widening
> (app migration `0008_widen_knowledge_position.sql`), which is what actually
> unblocks the broken pages; this change is what keeps them from getting there
> again.

## The bug

Wiki page content is stored as `base_knowledge_text_block` rows ordered by
`position`, a fractional-index key from `assignPositions`
(`src/lib/utils/fractional-index.ts`). New keys are only ever generated
*between* two neighbours, and appending means "between the last key and the end
of the list" — which lengthens the key by roughly one character per four
appended blocks.

`position` was `varchar(64)`. So at ~257 blocks the generated key reached 65
characters, Postgres rejected the INSERT in `syncKnowledgeTextBlocks`
("value too long for type character varying(64)"), and the route's catch-all
turned it into **HTTP 400 on every subsequent save** — the page became
permanently uneditable. Measured against the real implementation:

| blocks | longest key |
|---|---|
| 200 | 50 chars |
| 256 | 64 chars — exactly at the old limit |
| 257 | 65 chars — first failing block |
| 461 | 116 chars |

Reported in production on a 461-block page (tenant `c96798ed…`). The same
growth applies to `base_knowledge_text.position` (wiki tree ordering), where a
parent with 257+ children would hit it.

## The change

1. **`src/lib/db/schema/knowledge.ts`** — both `position` columns become `text`
   instead of `varchar(64)`. A length cap on a monotonically growing key turns
   growth into a hard write failure; the cap bought nothing.

2. **`src/lib/utils/fractional-index.ts`** — new exported constant
   `MAX_KEY_LENGTH_BEFORE_REBALANCE = 32`. When the keys `assignPositions`
   would return exceed it, the whole list is re-keyed compactly with
   `generateNKeysBetween` instead (3 characters for 1000 items, 4 for 5000).
   Growth restarts from a small base; measured, a rebalance then recurs about
   once per 120 appended blocks.

   This deliberately breaks the "unchanged list ⇒ zero writes" property *above
   the threshold*: the caller writes every row once. Documented in the
   docstring.

3. **`src/lib/knowledge/knowledge-text-blocks.ts`** — the block save now
   survives a full re-key:
   - **Temporary-key pass.** `knowledge_text_block_page_position_idx` is a plain
     (non-deferrable) unique index, so it is enforced per row. A permutation —
     two blocks swapping, or a rebalance rewriting everything — cannot be
     applied row by row, because the first row lands on a key its neighbour
     still holds. Every row whose position changes is therefore first parked on
     `~<token>-<i>`: `~` is outside the key alphabet (`^[a-z]+$`) so it can
     never collide with a real key, and the random token keeps two overlapping
     transactions apart.
   - **Per-page row lock.** The transaction opens with `SELECT … FOR UPDATE` on
     the `knowledge_text` row, so two concurrent saves of the same page
     serialise instead of racing on the unique index.

4. Tests for both (`fractional-index.test.ts`, `blocks.test.ts`), including an
   end-to-end save of a 300-block page and a save of a page whose stored keys
   are already over-long.

## Applying it upstream

```bash
cd backend/framework
git checkout -b claude/position-key-rebalance
git apply ../../framework-position-rebalance.patch
bun run generate          # emits the migration + snapshot for the schema change
bun test src/lib/utils/fractional-index.test.ts
git add -A && git commit -m "fix(knowledge): bound fractional-index key growth (blocks + page order)"
git push -u origin claude/position-key-rebalance
```

The generated migration is exactly:

```sql
ALTER TABLE "base_knowledge_text" ALTER COLUMN "position" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "base_knowledge_text_block" ALTER COLUMN "position" SET DATA TYPE text;
```

which is the same DDL the wiki repo already ships in
`backend/drizzle-sql/0008_widen_knowledge_position.sql`. Re-applying it is a
no-op, so the two can land in either order.

After the framework commit is merged, bump the submodule pointer in
`symbiosika/wiki` and drop this file plus the patch.

## What the wiki repo carries in the meantime

- `backend/drizzle-sql/0008_widen_knowledge_position.sql` — the widening, so
  broken pages become saveable on the next deploy without waiting for a
  framework release.
- `backend/src/lib/wiki/rebalance-positions.ts` + `bun run wiki:rebalance-positions`
  — one-off compaction of pages whose keys already grew long.
- `backend/src/lib/wiki/move.ts` — the sibling re-ordering writes now run in one
  transaction, since a rebalance can rewrite every sibling at once and a partial
  write would scramble the order.
