import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { files } from "@framework/lib/db/schema/files";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { saveFileToDb } from "@framework/lib/storage/db";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { syncKnowledgeTextBlocks } from "@framework/lib/knowledge/knowledge-text-blocks";
import { setKnowledgeTextPublicMode } from "@framework/lib/knowledge/knowledge-text-public";
import { getWikiPageImage, getPublicWikiPageImage } from "./images";

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

/** Store an image in a bucket and return its `<uuid>.<ext>` filename + path. */
const storeImage = async (bucket: string, name: string) => {
  const saved = await saveFileToDb(
    new File([PNG_BYTES], name, { type: "image/png" }),
    bucket,
    TENANT
  );
  createdFiles.push(saved.id);
  return { id: saved.id, path: saved.path, filename: saved.path.split("/").pop()! };
};

const createPage = async (text: string) => {
  const page = await createKnowledgeText({
    title: `Wiki image test ${crypto.randomUUID()}`,
    text,
    tenantId: TENANT,
    userId: OWNER,
    tenantWide: true,
  });
  createdPages.push(page.id);
  return page;
};

describe("wiki page images", () => {
  beforeAll(async () => {
    await initTests();
  });

  afterAll(() => {
    Promise.all([
      createdPages.length > 0
        ? getDb().delete(knowledgeText).where(inArray(knowledgeText.id, createdPages))
        : Promise.resolve(),
      createdFiles.length > 0
        ? getDb().delete(files).where(inArray(files.id, createdFiles))
        : Promise.resolve(),
    ]).catch(() => {});
  });

  test("serves an image uploaded through the block editor (knowledge bucket)", async () => {
    const image = await storeImage("knowledge", "pixel.png");
    const page = await createPage(`# Title\n\n![pixel](${image.path})`);

    const file = await getWikiPageImage(TENANT, OWNER, page.id, image.filename);
    expect(file.size).toBe(PNG_BYTES.byteLength);
  });

  test("serves an image extracted by the PDF/URL import (images bucket)", async () => {
    const image = await storeImage("images", "img-0.jpeg");
    const page = await createPage(`# Title\n\n![img-0.jpeg](${image.path})`);

    const file = await getWikiPageImage(TENANT, OWNER, page.id, image.filename);
    expect(file.size).toBe(PNG_BYTES.byteLength);
  });

  test("block pages were never the problem: editor image on a block page", async () => {
    const image = await storeImage("knowledge", "pixel.png");
    const page = await createPage("placeholder");
    await syncKnowledgeTextBlocks(
      page.id,
      [
        { type: "markdown", content: "# Zimmer-Funkruf über Funkbox" },
        { type: "markdown", content: `![pixel](${image.path})` },
      ],
      context
    );

    const file = await getWikiPageImage(TENANT, OWNER, page.id, image.filename);
    expect(file.size).toBe(PNG_BYTES.byteLength);
  });

  test("content mode does not matter: imported image on a block page", async () => {
    const image = await storeImage("images", "img-1.jpeg");
    const page = await createPage("placeholder");
    await syncKnowledgeTextBlocks(
      page.id,
      [
        { type: "markdown", content: "# Zimmer-Funkruf über Funkbox" },
        { type: "html", content: `<p><img src="${image.path}" alt="funkbox"></p>` },
      ],
      context
    );

    const file = await getWikiPageImage(TENANT, OWNER, page.id, image.filename);
    expect(file.size).toBe(PNG_BYTES.byteLength);
  });

  test("rejects a file the page does not reference", async () => {
    const image = await storeImage("images", "img-2.jpeg");
    const page = await createPage("# No images here");

    expect(
      getWikiPageImage(TENANT, OWNER, page.id, image.filename)
    ).rejects.toThrow();
  });

  test("rejects a bucket a page may not read from", async () => {
    const image = await storeImage("chat", "leak.png");
    const page = await createPage(`![leak](${image.path})`);

    expect(
      getWikiPageImage(TENANT, OWNER, page.id, image.filename)
    ).rejects.toThrow();
  });

  test("rejects a malformed filename", async () => {
    const page = await createPage("# Anything");
    expect(
      getWikiPageImage(TENANT, OWNER, page.id, "../../etc/passwd")
    ).rejects.toThrow();
  });

  test("public read follows the same rules for imported images", async () => {
    const image = await storeImage("images", "img-3.jpeg");
    const page = await createPage(`![img-3.jpeg](${image.path})`);

    expect(getPublicWikiPageImage(TENANT, page.id, image.filename)).rejects.toThrow();

    await setKnowledgeTextPublicMode(page.id, "public", context);
    const file = await getPublicWikiPageImage(TENANT, page.id, image.filename);
    expect(file.size).toBe(PNG_BYTES.byteLength);
  });
});
