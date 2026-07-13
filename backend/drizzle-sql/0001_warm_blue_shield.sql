CREATE TABLE "app_post_processing_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"prompt" text NOT NULL,
	"model_id" text,
	"max_steps" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "post_processing_agents_org_idx" ON "app_post_processing_agents" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_processing_agents_org_name_idx" ON "app_post_processing_agents" USING btree ("organisation_id","name");