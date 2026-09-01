ALTER TABLE "app_ai_test_questions" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_ai_test_results" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_ai_test_runs" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_ai_test_suites" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_organisation_logos" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_post_processing_agents" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_url_import_job_runs" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_url_import_job_urls" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
ALTER TABLE "app_url_import_jobs" RENAME COLUMN "organisation_id" TO "tenant_id";--> statement-breakpoint
DROP INDEX "ai_test_suites_org_idx";--> statement-breakpoint
DROP INDEX "post_processing_agents_org_idx";--> statement-breakpoint
DROP INDEX "post_processing_agents_org_name_idx";--> statement-breakpoint
DROP INDEX "url_import_jobs_org_idx";--> statement-breakpoint
CREATE INDEX "ai_test_suites_org_idx" ON "app_ai_test_suites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "post_processing_agents_org_idx" ON "app_post_processing_agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_processing_agents_org_name_idx" ON "app_post_processing_agents" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "url_import_jobs_org_idx" ON "app_url_import_jobs" USING btree ("tenant_id");