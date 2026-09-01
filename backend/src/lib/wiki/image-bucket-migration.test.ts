import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
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
import { migrateParsedImagesIntoPageBucket } from "./image-bucket-migration";

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

describe("wiki image bucket migration", () => {
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

    const result = await migrateParsedImagesIntoPageBucket(TENANT);

    expect(result.movedFiles).toBeGreaterThanOrEqual(1);
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

    await migrateParsedImagesIntoPageBucket(TENANT);

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
    const refs = await getDb()
      .select({ fileId: knowledgeTextFile.fileId })
      .from(knowledgeTextFile)
      .where(
        and(
          eq(knowledgeTextFile.knowledgeTextId, page.id),
          eq(knowledgeTextFile.fileId, image.id)
        )
      );
    expect(refs.length).toBe(1);
  });

  test("is idempotent — a second run has nothing left to do", async () => {
    const image = await storeImage("images", "img-2.jpeg");
    await createPage(`![img-2.jpeg](${image.path})`);

    const first = await migrateParsedImagesIntoPageBucket(TENANT);
    expect(first.movedFiles).toBeGreaterThanOrEqual(1);

    // Everything but `danglingReferences`: a dead reference stays reported on
    // every run by design, and other suites share this test organisation.
    const second = await migrateParsedImagesIntoPageBucket(TENANT);
    expect(second.movedFiles).toBe(0);
    expect(second.rewrittenPages).toBe(0);
    expect(second.rewrittenBlocks).toBe(0);
    expect(second.rewrittenVersions).toBe(0);
    expect(second.addedReferences).toBe(0);
  });

  test("dry run reports the work without writing anything", async () => {
    const image = await storeImage("images", "img-3.jpeg");
    const page = await createPage(`![img-3.jpeg](${image.path})`);

    const result = await migrateParsedImagesIntoPageBucket(TENANT, {
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.movedFiles).toBeGreaterThanOrEqual(1);
    expect(result.rewrittenPages).toBeGreaterThanOrEqual(1);
    expect(await bucketOf(image.id)).toBe("images");
    expect(await textOf(page.id)).toContain("/files/db/images/");
  });

  test("leaves a reference whose file is gone alone, and reports it", async () => {
    const missing = crypto.randomUUID();
    const page = await createPage(
      `![gone](/api/v1/tenant/${TENANT}/files/db/images/${missing}.jpeg)`
    );

    const result = await migrateParsedImagesIntoPageBucket(TENANT);

    expect(result.danglingReferences).toBeGreaterThanOrEqual(1);
    expect(await textOf(page.id)).toContain(`/files/db/images/${missing}`);
  });

  test("does not touch images of another organisation", async () => {
    const image = await storeImage("images", "img-4.jpeg");
    await createPage(`![img-4.jpeg](${image.path})`);

    const result = await migrateParsedImagesIntoPageBucket(crypto.randomUUID());

    expect(result.movedFiles).toBe(0);
    expect(await bucketOf(image.id)).toBe("images");
  });
});
