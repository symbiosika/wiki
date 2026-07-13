CREATE TABLE "app_url_import_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"started_by" uuid,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_url_import_job_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_imported_at" timestamp,
	"knowledge_text_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_url_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"team_id" uuid,
	"tenant_wide" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"created_by" uuid,
	"last_run_id" uuid,
	"last_run_at" timestamp,
	"last_run_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_url_import_job_runs" ADD CONSTRAINT "app_url_import_job_runs_job_id_app_url_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."app_url_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_url_import_job_urls" ADD CONSTRAINT "app_url_import_job_urls_job_id_app_url_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."app_url_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "url_import_job_runs_job_idx" ON "app_url_import_job_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "url_import_job_runs_started_idx" ON "app_url_import_job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "url_import_job_urls_job_idx" ON "app_url_import_job_urls" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "url_import_jobs_org_idx" ON "app_url_import_jobs" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "url_import_jobs_enabled_idx" ON "app_url_import_jobs" USING btree ("enabled");