CREATE TABLE "app_organisation_logos" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
