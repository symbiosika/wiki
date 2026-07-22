CREATE TABLE "app_ai_test_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"question" text NOT NULL,
	"type" text DEFAULT 'answerable' NOT NULL,
	"expected_page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_ai_test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"question_id" uuid,
	"question_text" text NOT NULL,
	"question_type" text NOT NULL,
	"expected_page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" text,
	"trajectory" jsonb,
	"scores" jsonb,
	"judge_report" jsonb,
	"verdict" text,
	"tool_usage_score" real,
	"groundedness_score" real,
	"relevance_score" real,
	"reference_score" real,
	"total_score" real,
	"duration_ms" integer,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_ai_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_by" uuid NOT NULL,
	"judge_model_id" text,
	"total" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"warned" integer DEFAULT 0 NOT NULL,
	"hard_gate_fails" integer DEFAULT 0 NOT NULL,
	"aggregates" jsonb,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_ai_test_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"judge_model_id" text,
	"step_limit" integer,
	"created_by" uuid,
	"last_run_id" uuid,
	"last_run_at" timestamp,
	"last_run_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_ai_test_questions" ADD CONSTRAINT "app_ai_test_questions_suite_id_app_ai_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."app_ai_test_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ai_test_results" ADD CONSTRAINT "app_ai_test_results_run_id_app_ai_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."app_ai_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ai_test_results" ADD CONSTRAINT "app_ai_test_results_question_id_app_ai_test_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."app_ai_test_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ai_test_runs" ADD CONSTRAINT "app_ai_test_runs_suite_id_app_ai_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."app_ai_test_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_test_questions_suite_idx" ON "app_ai_test_questions" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "ai_test_results_run_idx" ON "app_ai_test_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_test_results_question_idx" ON "app_ai_test_results" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "ai_test_runs_suite_idx" ON "app_ai_test_runs" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "ai_test_runs_started_idx" ON "app_ai_test_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_test_suites_org_idx" ON "app_ai_test_suites" USING btree ("organisation_id");