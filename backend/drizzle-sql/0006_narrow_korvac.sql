-- Align the index names with the organisation_id -> tenant_id column rename.
--
-- drizzle-kit generates DROP INDEX + CREATE INDEX for a pure name change, which
-- rebuilds the index and takes an ACCESS EXCLUSIVE lock for the duration. These
-- are catalog-only renames, so ALTER INDEX ... RENAME TO does the same thing
-- instantly and keeps the unique index enforcing its constraint throughout.
ALTER INDEX "ai_test_suites_org_idx" RENAME TO "ai_test_suites_tenant_idx";--> statement-breakpoint
ALTER INDEX "post_processing_agents_org_idx" RENAME TO "post_processing_agents_tenant_idx";--> statement-breakpoint
ALTER INDEX "post_processing_agents_org_name_idx" RENAME TO "post_processing_agents_tenant_name_idx";--> statement-breakpoint
ALTER INDEX "url_import_jobs_org_idx" RENAME TO "url_import_jobs_tenant_idx";
