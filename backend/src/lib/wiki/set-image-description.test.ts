/**
 * The write path for image descriptions, against the real page storage: what a
 * client gets when it fills `embeddedImages[].description` through the API /
 * the `set_image_description` MCP tool.
 *
 * The assertions are deliberately made through `extractPageImages` — the
 * READING half every consumer sees — plus the stored form, because the two
 * halves only work together: a description that lands in the page but not in
 * the materialized text is invisible to search, embeddings and every AI reader.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import {
  createKnowledgeText,
  getKnowledgeTextById,
} from "@framework/lib/knowledge/knowledge-texts";
import {
  getKnowledgeTextBlocks,
  syncKnowledgeTextBlocks,
} from "@framework/lib/knowledge/knowledge-text-blocks";
import { extractPageImages } from "./image-descriptions";
import {
  parseImageFileId,
  setWikiImageDescription,
} from "./set-image-description";

const TENANT = TEST_ORGANISATION_1.id;
const OWNER = TEST_ORG1_USER_1.id;
const context = { tenantId: TENANT, userId: OWNER };

const FILE_ID = "11111111-1111-1111-1111-111111111111";
const FILENAME = `${FILE_ID}.png`;
/** The `/files/db/…` tail — how a read result names the image (`ref`). */
const REF = `/files/db/knowledge/${FILENAME}`;
/** How the image is really embedded: the full API path. */
const FULL = `/api/v1/tenant/${TENANT}${REF}`;

const createdPages: string[] = [];

const createPage = async (text: string) => {
  const page = await createKnowledgeText({
    title: `Image description test ${crypto.randomUUID()}`,
    text,
    tenantId: TENANT,
    userId: OWNER,
    tenantWide: true,
  });
  createdPages.push(page.id);
  return page;
};

const pageText = async (id: string) =>
  (await getKnowledgeTextById(id, context)).text ?? "";

const describedAs = async (id: string) =>
  extractPageImages(await pageText(id)).find((image) => image.ref === REF)
    ?.description;

describe("setWikiImageDescription", () => {
  beforeAll(async () => {
    await initTests();
  });

  afterAll(() => {
    if (createdPages.length === 0) return;
    getDb()
      .delete(knowledgeText)
      .where(inArray(knowledgeText.id, createdPages))
      .catch(() => {});
  });

  test("accepts every form of image reference a client has at hand", () => {
    expect(parseImageFileId(REF)).toBe(FILE_ID);
    expect(parseImageFileId(FULL)).toBe(FILE_ID);
    expect(parseImageFileId(FILENAME)).toBe(FILE_ID);
    expect(parseImageFileId(FILE_ID)).toBe(FILE_ID);
    expect(parseImageFileId("schaltplan.png")).toBeNull();
  });

  test("describes an image on a plain-text page, readable as page content", async () => {
    const page = await createPage(`# Technikmodul\n\n![](${FULL})\n\nText.`);

    const result = await setWikiImageDescription(
      page.id,
      FILENAME,
      "Klemmleiste mit zwei Ausgängen, links die Zugentlastung",
      context
    );

    expect(result.changed).toBe(true);
    expect(result.ref).toBe(REF);
    expect(result.images).toContainEqual({
      ref: REF,
      description: "Klemmleiste mit zwei Ausgängen, links die Zugentlastung",
    });
    // the marker sits on the line directly below the image
    expect(await pageText(page.id)).toContain(
      `![](${FULL})\n<image-description src="${FULL}">` +
        "Klemmleiste mit zwei Ausgängen, links die Zugentlastung" +
        "</image-description>"
    );
  });

  test("replaces an existing description instead of stacking a second one", async () => {
    const page = await createPage(`![](${FULL})`);

    await setWikiImageDescription(page.id, REF, "Erste Fassung", context);
    await setWikiImageDescription(page.id, REF, "Zweite Fassung", context);

    const text = await pageText(page.id);
    expect(text.match(/<image-description/g)).toHaveLength(1);
    expect(await describedAs(page.id)).toBe("Zweite Fassung");
  });

  test("an empty description removes it and leaves the page as it was", async () => {
    const original = `# Titel\n\n![Schaltplan](${FULL})\n\nMehr Text.`;
    const page = await createPage(original);

    await setWikiImageDescription(page.id, REF, "Zu löschen", context);
    const removed = await setWikiImageDescription(page.id, REF, "", context);

    expect(removed.changed).toBe(true);
    expect(removed.description).toBeNull();
    expect(await pageText(page.id)).toBe(original);
  });

  test("writing the description an image already has changes nothing", async () => {
    const page = await createPage(`![](${FULL})`);
    await setWikiImageDescription(page.id, REF, "Unverändert", context);
    const before = await pageText(page.id);

    const again = await setWikiImageDescription(
      page.id,
      REF,
      "  Unverändert  ",
      context
    );

    expect(again.changed).toBe(false);
    expect(await pageText(page.id)).toBe(before);
  });

  test("stores it on the img of an html block — the form the editor edits", async () => {
    const page = await createPage("placeholder");
    await syncKnowledgeTextBlocks(
      page.id,
      [
        { type: "html", content: "<h1>Technikmodul</h1>" },
        { type: "html", content: `<p><img src="${FULL}" alt="pixel.png"></p>` },
      ],
      context
    );

    const result = await setWikiImageDescription(
      page.id,
      REF,
      "Zwei Ausgänge, rechts der Anschluss",
      context
    );
    expect(result.changed).toBe(true);

    const blocks = await getKnowledgeTextBlocks(page.id, context);
    expect(blocks[1]!.type).toBe("html");
    expect(blocks[1]!.content).toContain(
      'data-description="Zwei Ausgänge, rechts der Anschluss"'
    );
    // …and it reaches every text reader through the materialized page text
    expect(await describedAs(page.id)).toBe(
      "Zwei Ausgänge, rechts der Anschluss"
    );

    await setWikiImageDescription(page.id, REF, "", context);
    const cleared = await getKnowledgeTextBlocks(page.id, context);
    expect(cleared[1]!.content).not.toContain("data-description");
    expect(await describedAs(page.id)).toBeUndefined();
  });

  test("describes an image in a markdown block of a block page", async () => {
    const page = await createPage("placeholder");
    await syncKnowledgeTextBlocks(
      page.id,
      [
        { type: "markdown", content: "# Anleitung" },
        { type: "markdown", content: `![pixel](${FULL})` },
      ],
      context
    );

    await setWikiImageDescription(page.id, REF, "Gerät von vorne", context);

    expect(await describedAs(page.id)).toBe("Gerät von vorne");
  });

  test("a multi-line description is stored as one line", async () => {
    const page = await createPage(`![](${FULL})`);

    const result = await setWikiImageDescription(
      page.id,
      REF,
      "Erste Zeile\n\n  zweite Zeile ",
      context
    );

    expect(result.description).toBe("Erste Zeile zweite Zeile");
    expect(await describedAs(page.id)).toBe("Erste Zeile zweite Zeile");
  });

  test("rejects an image the page does not embed, and a junk reference", async () => {
    const page = await createPage(`![](${FULL})`);

    expect(
      setWikiImageDescription(
        page.id,
        "22222222-2222-2222-2222-222222222222.png",
        "Fremdes Bild",
        context
      )
    ).rejects.toThrow(/does not embed/);

    expect(
      setWikiImageDescription(page.id, "schaltplan.png", "Kein Bild", context)
    ).rejects.toThrow(/Invalid image reference/);
  });
});
