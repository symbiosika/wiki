CREATE TABLE "app_collection_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_collection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"knowledge_text_id" uuid NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_collections_knowledge_text_id_unique" UNIQUE("knowledge_text_id")
);
--> statement-breakpoint
ALTER TABLE "app_collection_fields" ADD CONSTRAINT "app_collection_fields_collection_id_app_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."app_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_collection_records" ADD CONSTRAINT "app_collection_records_collection_id_app_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."app_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_collections" ADD CONSTRAINT "app_collections_knowledge_text_id_base_knowledge_text_id_fk" FOREIGN KEY ("knowledge_text_id") REFERENCES "public"."base_knowledge_text"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_fields_collection_idx" ON "app_collection_fields" USING btree ("collection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_fields_collection_key_idx" ON "app_collection_fields" USING btree ("collection_id","key");--> statement-breakpoint
CREATE INDEX "collection_records_collection_idx" ON "app_collection_records" USING btree ("collection_id","position");--> statement-breakpoint
CREATE INDEX "collection_records_data_idx" ON "app_collection_records" USING gin ("data");--> statement-breakpoint
CREATE INDEX "collections_tenant_idx" ON "app_collections" USING btree ("tenant_id");