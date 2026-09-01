-- Data migration: one bucket for page images.
--
-- A page's images could sit in either of two buckets. The block editor uploads
-- into "knowledge"; a parsing service extracting images from an imported
-- document (PDF / URL import) stored them in "images". Only the first bucket
-- takes part in what a page does for its files — the knowledge_text_file
-- reference rows, the expiry, the cleanup when the page or the last reference
-- goes away — and only the first was readable through the page-scoped image
-- endpoints, which is why images on imported pages answered 404 for MCP
-- clients while the wiki UI displayed them fine.
--
-- The framework parser now writes new imports straight into the page bucket
-- (PdfParserOptions.imageBucket), so this moves what is already there.
--
-- A move is a bucket column plus a path rewrite: the file id never changes, no
-- bytes are copied, and no reference changes meaning. Everything in the
-- "images" bucket is a page image — the wiki page import is the only writer
-- that ever reached it (parseDocument, the other entry point, is unused) — so
-- the bucket is emptied rather than filtered.

--> statement-breakpoint
UPDATE "base_knowledge_text"
SET "text" = replace("text", '/files/db/images/', '/files/db/knowledge/')
WHERE "text" LIKE '%/files/db/images/%';
--> statement-breakpoint
UPDATE "base_knowledge_text_block"
SET "content" = replace("content", '/files/db/images/', '/files/db/knowledge/')
WHERE "content" LIKE '%/files/db/images/%';
--> statement-breakpoint
-- History keeps old versions readable: their images move with the file.
UPDATE "base_knowledge_text_history"
SET "text" = replace("text", '/files/db/images/', '/files/db/knowledge/')
WHERE "text" LIKE '%/files/db/images/%';
--> statement-breakpoint
UPDATE "base_knowledge_text_history"
SET "blocks" = replace("blocks"::text, '/files/db/images/', '/files/db/knowledge/')::jsonb
WHERE "blocks"::text LIKE '%/files/db/images/%';
--> statement-breakpoint
UPDATE "base_files"
SET "bucket" = 'knowledge', "updated_at" = now()
WHERE "bucket" = 'images';
--> statement-breakpoint
-- Give the moved files the page bookkeeping they never had. This is what
-- syncKnowledgeTextFileReferences does on every content write, applied once to
-- the pages that already exist: a reference row per (page, file), and no
-- expiry while a page references the file.
INSERT INTO "base_knowledge_text_file" ("tenant_id", "knowledge_text_id", "file_id")
SELECT DISTINCT "refs"."tenant_id", "refs"."knowledge_text_id", "refs"."file_id"
FROM (
  SELECT
    "kt"."tenant_id",
    "kt"."id" AS "knowledge_text_id",
    (regexp_matches(
      "kt"."text",
      '/files/db/knowledge/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      'g'
    ))[1]::uuid AS "file_id"
  FROM "base_knowledge_text" AS "kt"
  WHERE "kt"."text" LIKE '%/files/db/knowledge/%'
) AS "refs"
JOIN "base_files" AS "f"
  ON "f"."id" = "refs"."file_id"
 AND "f"."tenant_id" = "refs"."tenant_id"
 AND "f"."bucket" = 'knowledge'
WHERE NOT EXISTS (
  SELECT 1
  FROM "base_knowledge_text_file" AS "existing"
  WHERE "existing"."knowledge_text_id" = "refs"."knowledge_text_id"
    AND "existing"."file_id" = "refs"."file_id"
);
--> statement-breakpoint
UPDATE "base_files" AS "f"
SET "expires_at" = NULL
WHERE "f"."expires_at" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "base_knowledge_text_file" AS "ref"
    WHERE "ref"."file_id" = "f"."id"
  );
