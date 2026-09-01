/**
 * The data migration that consolidates page images into one bucket
 * (`drizzle-sql/0010_consolidate_page_image_bucket.sql`).
 *
 * The migration itself has already run against the empty test database by the
 * time this file starts, so the SQL is loaded and executed again here, on
 * fixtures. That doubles as the idempotency check the real deployment relies
 * on: a second run must not duplicate reference rows or touch anything else.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { files } from "@framework/lib/db/schema/files";
import {
  knowledgeText,
  knowledgeTextBlock,
  knowledgeTextFile,
  knowledgeTextHistory,
} from "@framework/lib/db/schema/knowledge";
import { saveFileToDb } from "@framework/lib/storage/db";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { syncKnowledgeTextBlocks } from "@framework/lib/knowledge/knowledge-text-blocks";
import { getWikiPageImage } from "./images";

const MIGRATION_FILE =
  `${import.meta.dir}/../../../drizzle-sql/0010_consolidate_page_image_bucket.sql`;

const TENANT = TEST_ORGANISATION_1.id;
const OWNER = TEST_ORG1_USER_1.id;
const context = { tenantId: TENANT, userId: OWNER };

/** tiny valid PNG (1x1 transparent pixel) */
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

/** Run the migration exactly as `drizzle-kit migrate` would. */
const runMigration = async () => {
  const file = await Bun.file(MIGRATION_FILE).text();
  const statements = file
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.replace(/--[^\n]*/g, "").trim().length > 0);
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    await getDb().execute(sql.raw(statement));
  }
};

const createdPages: string[] = [];
const createdFiles: string[] = [];

const storeImage = async (bucket: string, name: string) => {
  const saved = await saveFileToDb(
    new File([PNG_BYTES], name, { type: "image/png" }),
    bucket,
    TENANT
  );
  createdFiles.push(saved.id);
  return {
    id: saved.id,
    path: saved.path,
    filename: saved.path.split("/").pop()!,
  };
};

const createPage = async (text: string) => {
  const page = await createKnowledgeText({
    title: `Bucket migration ${crypto.randomUUID()}`,
    text,
    tenantId: TENANT,
    userId: OWNER,
    tenantWide: true,
  });
  createdPages.push(page.id);
  return page;
};

const bucketOf = async (fileId: string) => {
  const rows = await getDb()
    .select({ bucket: files.bucket })
    .from(files)
    .where(eq(files.id, fileId));
  return rows[0]?.bucket ?? null;
};

const textOf = async (pageId: string) => {
  const rows = await getDb()
    .select({ text: knowledgeText.text })
    .from(knowledgeText)
    .where(eq(knowledgeText.id, pageId));
  return rows[0]!.text;
};

const referencesOf = async (pageId: string, fileId: string) =>
  await getDb()
    .select({ id: knowledgeTextFile.id })
    .from(knowledgeTextFile)
    .where(
      and(
        eq(knowledgeTextFile.knowledgeTextId, pageId),
        eq(knowledgeTextFile.fileId, fileId)
      )
    );

describe("page image bucket consolidation (data migration)", () => {
  beforeAll(async () => {
    await initTests();
  });

  afterAll(() => {
    Promise.all([
      createdPages.length > 0
        ? getDb()
            .delete(knowledgeText)
            .where(inArray(knowledgeText.id, createdPages))
        : Promise.resolve(),
      createdFiles.length > 0
        ? getDb().delete(files).where(inArray(files.id, createdFiles))
        : Promise.resolve(),
    ]).catch(() => {});
  });

  test("moves an imported image into the page bucket and rewrites the page", async () => {
    const image = await storeImage("images", "img-0.jpeg");
    const page = await createPage(`# Datenblatt\n\n![img-0.jpeg](${image.path})`);

    await runMigration();

    expect(await bucketOf(image.id)).toBe("knowledge");
    expect(await textOf(page.id)).toContain(
      `/files/db/knowledge/${image.filename}`
    );
    expect(await textOf(page.id)).not.toContain("/files/db/images/");

    // the whole point: the page-scoped image read now serves it
    const file = await getWikiPageImage(TENANT, OWNER, page.id, image.filename);
    expect(file.size).toBe(PNG_BYTES.byteLength);
  });

  test("rewrites blocks and history, and registers the file with the page", async () => {
    const image = await storeImage("images", "img-1.jpeg");
    const page = await createPage("placeholder");
    await syncKnowledgeTextBlocks(
      page.id,
      [{ type: "markdown", content: `![img-1.jpeg](${image.path})` }],
      context
    );
    // a second save writes a history snapshot of the state above
    await syncKnowledgeTextBlocks(
      page.id,
      [
        { type: "markdown", content: `![img-1.jpeg](${image.path})` },
        { type: "markdown", content: "Nachtrag" },
      ],
      context,
      { historyCoalesceMinutes: 0 }
    );

    await runMigration();

    const blocks = await getDb()
      .select({ content: knowledgeTextBlock.content })
      .from(knowledgeTextBlock)
      .where(eq(knowledgeTextBlock.knowledgeTextId, page.id));
    expect(blocks.some((b) => b.content.includes("/files/db/knowledge/"))).toBe(
      true
    );
    expect(blocks.some((b) => b.content.includes("/files/db/images/"))).toBe(
      false
    );

    const history = await getDb()
      .select({
        text: knowledgeTextHistory.text,
        blocks: knowledgeTextHistory.blocks,
      })
      .from(knowledgeTextHistory)
      .where(eq(knowledgeTextHistory.knowledgeTextId, page.id));
    expect(history.length).toBeGreaterThan(0);
    expect(JSON.stringify(history)).not.toContain("/files/db/images/");

    // the moved file is now tracked as a page reference (expiry, cleanup)
    expect((await referencesOf(page.id, image.id)).length).toBe(1);
  });

  test("is idempotent — running it again changes nothing", async () => {
    const image = await storeImage("images", "img-2.jpeg");
    const page = await createPage(`![img-2.jpeg](${image.path})`);

    await runMigration();
    const afterFirst = await textOf(page.id);

    await runMigration();

    expect(await textOf(page.id)).toBe(afterFirst);
    expect(await bucketOf(image.id)).toBe("knowledge");
    // no duplicate reference row from the second run
    expect((await referencesOf(page.id, image.id)).length).toBe(1);
  });

  test("does not invent a reference for a file that no longer exists", async () => {
    const missing = crypto.randomUUID();
    const page = await createPage(
      `![gone](/api/v1/tenant/${TENANT}/files/db/images/${missing}.jpeg)`
    );

    await runMigration();

    // the path is rewritten with everything else, but no reference row is
    // created for a file that is not in the bucket
    const refs = await getDb()
      .select({ id: knowledgeTextFile.id })
      .from(knowledgeTextFile)
      .where(eq(knowledgeTextFile.knowledgeTextId, page.id));
    expect(refs.length).toBe(0);
  });

  test("clears the expiry of a file a page references", async () => {
    const image = await storeImage("images", "img-3.jpeg");
    await getDb()
      .update(files)
      .set({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
      .where(eq(files.id, image.id));
    const page = await createPage(`![img-3.jpeg](${image.path})`);

    await runMigration();

    const rows = await getDb()
      .select({ expiresAt: files.expiresAt })
      .from(files)
      .where(eq(files.id, image.id));
    expect(rows[0]!.expiresAt).toBeNull();
    expect((await referencesOf(page.id, image.id)).length).toBe(1);
  });
});
