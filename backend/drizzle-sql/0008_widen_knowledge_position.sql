-- Widen the fractional-index ordering keys of the knowledge tables from
-- varchar(64) to text.
--
-- WHY: `assignPositions` (framework/src/lib/utils/fractional-index.ts) grows a
-- key by ~1 character per 4 appended siblings, so a page reaching ~257 blocks
-- produces a 65-character key. Postgres then rejects the INSERT in
-- `syncKnowledgeTextBlocks` with "value too long for type character
-- varying(64)", the route's catch-all turns it into HTTP 400, and that page can
-- never be saved again. Observed in production on a 461-block page.
--
-- WHY HERE, ON `base_*` TABLES: the columns belong to the framework submodule,
-- which releases on its own cadence, and pages are broken today. The framework
-- carries the same widening in its own schema (symbiosika/symbiosika-framework#122);
-- applying it twice is a no-op. `drizzle.config.ts` filters on `app_*`, so
-- `drizzle-kit generate` never diffs these tables and cannot revert this migration.
--
-- COST: varchar(64) -> text is binary-coercible — no table rewrite and no index
-- rebuild (varchar already uses text's btree opclass), only a brief ACCESS
-- EXCLUSIVE lock. `lock_timeout` stops that lock from queuing production
-- traffic behind a long-running reader; on "canceling statement due to lock
-- timeout" simply run the migration again.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE IF EXISTS "base_knowledge_text_block" ALTER COLUMN "position" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE IF EXISTS "base_knowledge_text" ALTER COLUMN "position" SET DATA TYPE text;
