/**
 * Writing an image description — the counterpart to the reading half in
 * ./image-descriptions.ts.
 *
 * A description ("what is ON this picture") is the only thing that makes an
 * image readable for anything that sees text: search, embeddings, and every AI
 * client of the MCP server. Until now it could only be written by a human in
 * the block editor, or — knowing the exact syntax — by an agent that hand-wrote
 * the `<image-description src="…">…</image-description>` marker into the page
 * with `edit_page_content`. That marker is an implementation detail of the
 * storage format, not an API: a client reading `embeddedImages[].description`
 * had no way to find out how to FILL that field, and neither a markdown alt
 * text nor a markdown title is picked up for it (they are different things, and
 * deliberately so — see `extractPageImages`).
 *
 * This module is the explicit write path behind the `set_image_description`
 * MCP tool and `PUT /wiki/:pageId/images/:filename/description`:
 *
 *   - it addresses the image the way every other image endpoint does, by the
 *     `<uuid>.<ext>` filename (or any reference containing it — the
 *     `/files/db/…` path from the content works verbatim), instead of by
 *     string-matching the page text,
 *   - it writes the description where the page actually keeps it: as
 *     `data-description` on the `<img>` of an html block (the form the block
 *     editor renders as a caption and a human keeps editing), and as the
 *     marker line below the image in markdown blocks and plain-text pages,
 *   - and it replaces or removes an existing description instead of stacking a
 *     second one, so the operation is idempotent.
 *
 * Everything downstream follows on its own: the block sync re-materializes the
 * page text (which is what carries the marker into the full-text index and the
 * embedding), writes history and fires the webhooks.
 */

import {
  getKnowledgeTextById,
  updateKnowledgeText,
} from "@framework/lib/knowledge/knowledge-texts";
import {
  getKnowledgeTextBlocks,
  syncKnowledgeTextBlocks,
  type KnowledgeTextBlockInput,
} from "@framework/lib/knowledge/knowledge-text-blocks";
import {
  IMAGE_DESCRIPTION_ATTRIBUTE,
  IMAGE_DESCRIPTION_PATTERN,
  imageDescriptionMarker,
  normalizeImageDescription,
} from "@framework/lib/knowledge/image-descriptions";
import { extractPageImages, type PageImage } from "./image-descriptions";

/** The uuid of a stored file, as it appears in every image reference. */
const FILE_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The image to describe, addressed as `<uuid>.<ext>`, as the full
 * `/files/db/<bucket>/<uuid>.<ext>` reference from the page content, or as the
 * complete API url of the image — all three name the same file, and a client
 * copies whichever of them it has in front of it.
 */
const IMAGE_REF_PATTERN = new RegExp(
  `(?:^|/)(${FILE_ID})(?:\\.[a-z0-9]{1,8})?(?:[?#]|$)`,
  "i"
);

/** A markdown image: `![alt](<target> "title")`; group 1 is the target. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** An html image tag, as stored in an html block. */
const HTML_IMAGE = /<img\b[^>]*>/gi;

const SRC_ATTRIBUTE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** The stored `data-description="…"` attribute, for replacing/removing it. */
const DESCRIPTION_ATTRIBUTE = new RegExp(
  `\\s${IMAGE_DESCRIPTION_ATTRIBUTE}\\s*=\\s*(?:"[^"]*"|'[^']*')`,
  "gi"
);

/**
 * A marker together with the line break that separates it from the image
 * above: removing the marker alone would leave the blank line behind, and a
 * page that gets its description cleared should read exactly like a page that
 * never had one.
 */
const MARKER_WITH_LEADING_BREAK = new RegExp(
  `[ \\t]*\\n?[ \\t]*${IMAGE_DESCRIPTION_PATTERN.source}`,
  "gi"
);

/** Raised when the page does not embed the requested image. */
export const IMAGE_NOT_FOUND_MESSAGE =
  "This page does not embed that image. Read the page and use one of the " +
  "references it lists under `embeddedImages`.";

/** Raised for a reference that is not an image reference at all. */
export const INVALID_IMAGE_REF_MESSAGE =
  "Invalid image reference: pass the image filename (`<uuid>.<ext>`) or the " +
  "`/files/db/…` path from the page content.";

/** The file id an image reference points at, or null if it names no file. */
export const parseImageFileId = (imageRef: string): string | null => {
  const match = IMAGE_REF_PATTERN.exec(imageRef.trim());
  return match ? match[1]!.toLowerCase() : null;
};

const mentionsFile = (value: string, fileId: string): boolean =>
  value.toLowerCase().includes(fileId);

const escapeHtmlAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Where an image ends in a piece of text, and how it is written there. */
type ImagePosition = { end: number; src: string };

/**
 * The FIRST embed of a file in a piece of text — markdown image or html tag,
 * whichever comes first. `end` is where the marker goes (the line below the
 * image), `src` is the reference as this page writes it, which is what the
 * marker has to repeat so the two can be paired up again on reading.
 */
const findImage = (content: string, fileId: string): ImagePosition | null => {
  const candidates: ImagePosition[] = [];

  for (const match of content.matchAll(MARKDOWN_IMAGE)) {
    const target = match[1] ?? "";
    if (mentionsFile(target, fileId)) {
      candidates.push({ end: match.index + match[0].length, src: target });
    }
  }
  for (const match of content.matchAll(HTML_IMAGE)) {
    if (!mentionsFile(match[0], fileId)) continue;
    const src = SRC_ATTRIBUTE.exec(match[0]);
    candidates.push({
      end: match.index + match[0].length,
      src: src?.[1] ?? src?.[2] ?? "",
    });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((first, next) => (next.end < first.end ? next : first));
};

/** Drop every marker that describes this file (there should be exactly one). */
const stripMarkers = (content: string, fileId: string): string =>
  content.replace(MARKER_WITH_LEADING_BREAK, (match, attributes: string) => {
    const src = SRC_ATTRIBUTE.exec(attributes ?? "");
    const path = src?.[1] ?? src?.[2] ?? "";
    return mentionsFile(path, fileId) ? "" : match;
  });

/**
 * Set (or clear) the description in markdown / plain text: the marker goes on
 * its own line directly below the image, replacing whatever marker was there.
 * Returns null when this piece of text does not embed the image.
 */
const describeInText = (
  content: string,
  fileId: string,
  description: string | null
): { content: string; src: string } | null => {
  const stripped = stripMarkers(content, fileId);
  const image = findImage(stripped, fileId);
  if (!image) return null;
  if (!description) return { content: stripped, src: image.src };

  const marker = imageDescriptionMarker(image.src, description);
  return {
    content:
      stripped.slice(0, image.end) + "\n" + marker + stripped.slice(image.end),
    src: image.src,
  };
};

/**
 * Set (or clear) the description on the `<img>` itself — the form the block
 * editor stores and renders as a caption. Materialization turns it back into
 * the marker for every text reader (see the framework's materialize-blocks).
 * Returns null when this block holds no such image tag.
 */
const describeInHtml = (
  content: string,
  fileId: string,
  description: string | null
): { content: string; src: string } | null => {
  const sources: string[] = [];

  const next = content.replace(HTML_IMAGE, (tag) => {
    if (!mentionsFile(tag, fileId)) return tag;
    const attribute = SRC_ATTRIBUTE.exec(tag);
    sources.push(attribute?.[1] ?? attribute?.[2] ?? "");

    const without = tag.replace(DESCRIPTION_ATTRIBUTE, "");
    if (!description) return without;
    const selfClosing = /\/>$/.test(without.trim());
    const head = without.replace(/\s*\/?>$/, "");
    return (
      `${head} ${IMAGE_DESCRIPTION_ATTRIBUTE}=` +
      `"${escapeHtmlAttribute(description)}"${selfClosing ? " />" : ">"}`
    );
  });

  return sources.length === 0 ? null : { content: next, src: sources[0]! };
};

export type SetImageDescriptionResult = {
  pageId: string;
  /** The image, as `embeddedImages[].ref` names it. */
  ref: string;
  /** The description now stored (null = the image has none any more). */
  description: string | null;
  /** False when the image already carried exactly this description. */
  changed: boolean;
  /** Every image of the page after the write, with its description. */
  images: PageImage[];
};

/** The `/files/db/…` tail of a reference — how a read result names an image. */
const asPageImageRef = (src: string, fileId: string): string => {
  const tail = new RegExp(
    `/files/db/[a-z0-9_-]+/${fileId}(?:\\.[a-z0-9]{1,8})?`,
    "i"
  ).exec(src);
  return tail ? tail[0] : src;
};

/**
 * Set, replace or remove the description of one image embedded in a wiki page.
 *
 * Writing is scoped by the page: the caller must be allowed to read the page
 * (`getKnowledgeTextById`) and to write it (checked by the block sync /
 * `updateKnowledgeText`), and the image must be embedded in that page — the
 * same rule that governs reading an image through `getWikiPageImage`.
 *
 * Passing an empty description (or null) removes it again. Writing the
 * description an image already has is a no-op: no history entry, no
 * re-embedding, `changed: false`.
 */
export const setWikiImageDescription = async (
  pageId: string,
  imageRef: string,
  description: string | null | undefined,
  context: { tenantId: string; userId?: string }
): Promise<SetImageDescriptionResult> => {
  const fileId = parseImageFileId(imageRef);
  if (!fileId) throw new Error(INVALID_IMAGE_REF_MESSAGE);

  const text = normalizeImageDescription(description);
  const page = await getKnowledgeTextById(pageId, context);

  const done = (
    src: string,
    changed: boolean,
    content: string
  ): SetImageDescriptionResult => ({
    pageId,
    ref: asPageImageRef(src, fileId),
    description: text,
    changed,
    images: extractPageImages(content),
  });

  // ----- plain text pages -------------------------------------------------
  if (page.contentMode !== "blocks") {
    const current = page.text ?? "";
    const edited = describeInText(current, fileId, text);
    if (!edited) throw new Error(IMAGE_NOT_FOUND_MESSAGE);
    if (edited.content === current) return done(edited.src, false, current);

    const updated = await updateKnowledgeText(
      pageId,
      { text: edited.content },
      context
    );
    return done(edited.src, true, updated.text ?? edited.content);
  }

  // ----- block pages ------------------------------------------------------
  const blocks = await getKnowledgeTextBlocks(pageId, context);
  const sources: string[] = [];
  let changed = false;

  const inputs: KnowledgeTextBlockInput[] = blocks.map((block) => {
    const edited =
      block.type === "html"
        ? describeInHtml(block.content, fileId, text)
        : describeInText(block.content, fileId, text);
    if (edited) {
      sources.push(edited.src);
      if (edited.content !== block.content) changed = true;
    }
    return {
      id: block.id,
      type: block.type,
      content: edited?.content ?? block.content,
      meta: (block.meta ?? {}) as Record<string, unknown>,
    };
  });

  const src = sources[0];
  if (src === undefined) throw new Error(IMAGE_NOT_FOUND_MESSAGE);
  if (!changed) return done(src, false, page.text ?? "");

  const result = await syncKnowledgeTextBlocks(pageId, inputs, context);
  return done(src, true, result.knowledgeText.text ?? "");
};
