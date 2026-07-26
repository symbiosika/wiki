CREATE TABLE "app_idea_board_card_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid,
	"author_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_idea_board_card_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"source_card_id" uuid NOT NULL,
	"target_card_id" uuid,
	"target_page_id" uuid,
	"target_page_title" text,
	"type" text DEFAULT 'relates' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idea_board_card_links_one_target" CHECK (("app_idea_board_card_links"."target_card_id" IS NULL) <> ("app_idea_board_card_links"."target_page_id" IS NULL)),
	CONSTRAINT "idea_board_card_links_no_self" CHECK ("app_idea_board_card_links"."target_card_id" IS NULL OR "app_idea_board_card_links"."target_card_id" <> "app_idea_board_card_links"."source_card_id")
);
--> statement-breakpoint
CREATE TABLE "app_idea_board_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"author_label" text,
	"created_by" uuid,
	"color" text,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL,
	"width" integer DEFAULT 220 NOT NULL,
	"height" integer,
	"z" varchar(64) NOT NULL,
	"page_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_idea_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"team_id" uuid,
	"tenant_wide" boolean DEFAULT false NOT NULL,
	"page_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_idea_board_card_comments" ADD CONSTRAINT "app_idea_board_card_comments_card_id_app_idea_board_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."app_idea_board_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_idea_board_card_comments" ADD CONSTRAINT "app_idea_board_card_comments_board_id_app_idea_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."app_idea_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_idea_board_card_links" ADD CONSTRAINT "app_idea_board_card_links_board_id_app_idea_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."app_idea_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_idea_board_card_links" ADD CONSTRAINT "app_idea_board_card_links_source_card_id_app_idea_board_cards_id_fk" FOREIGN KEY ("source_card_id") REFERENCES "public"."app_idea_board_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_idea_board_card_links" ADD CONSTRAINT "app_idea_board_card_links_target_card_id_app_idea_board_cards_id_fk" FOREIGN KEY ("target_card_id") REFERENCES "public"."app_idea_board_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_idea_board_cards" ADD CONSTRAINT "app_idea_board_cards_board_id_app_idea_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."app_idea_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_board_card_comments_card_idx" ON "app_idea_board_card_comments" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "idea_board_card_comments_board_idx" ON "app_idea_board_card_comments" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "idea_board_card_links_source_idx" ON "app_idea_board_card_links" USING btree ("source_card_id");--> statement-breakpoint
CREATE INDEX "idea_board_card_links_target_idx" ON "app_idea_board_card_links" USING btree ("target_card_id");--> statement-breakpoint
CREATE INDEX "idea_board_card_links_board_idx" ON "app_idea_board_card_links" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_board_card_links_card_unique_idx" ON "app_idea_board_card_links" USING btree ("source_card_id","target_card_id","type") WHERE "app_idea_board_card_links"."target_card_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idea_board_card_links_page_unique_idx" ON "app_idea_board_card_links" USING btree ("source_card_id","target_page_id","type") WHERE "app_idea_board_card_links"."target_page_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idea_board_cards_board_idx" ON "app_idea_board_cards" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "idea_board_cards_tenant_idx" ON "app_idea_board_cards" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_board_cards_z_idx" ON "app_idea_board_cards" USING btree ("board_id","z");--> statement-breakpoint
CREATE INDEX "idea_boards_tenant_idx" ON "app_idea_boards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idea_boards_page_idx" ON "app_idea_boards" USING btree ("page_id");