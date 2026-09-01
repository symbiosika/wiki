CREATE TABLE "app_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_chat_messages" ADD CONSTRAINT "app_chat_messages_session_id_app_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_session_idx" ON "app_chat_messages" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_session_message_idx" ON "app_chat_messages" USING btree ("session_id","message_id");--> statement-breakpoint
CREATE INDEX "chat_sessions_tenant_user_idx" ON "app_chat_sessions" USING btree ("tenant_id","user_id","updated_at");