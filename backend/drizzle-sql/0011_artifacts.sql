CREATE TABLE "app_artifact_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"entry_path" text NOT NULL,
	"file_count" integer NOT NULL,
	"total_bytes" integer NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_name" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_artifact_files" ADD CONSTRAINT "app_artifact_files_version_id_app_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."app_artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_artifact_versions" ADD CONSTRAINT "app_artifact_versions_page_id_base_knowledge_text_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."base_knowledge_text"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_files_tenant_idx" ON "app_artifact_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_files_version_path_idx" ON "app_artifact_files" USING btree ("version_id","path");--> statement-breakpoint
CREATE INDEX "artifact_versions_tenant_idx" ON "app_artifact_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_page_version_idx" ON "app_artifact_versions" USING btree ("page_id","version");