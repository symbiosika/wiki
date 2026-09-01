/**
 * Page images as an AI client sees them: the reference it can load, the alt
 * text, and the description a human (or a document parser) wrote for it.
 *
 * The description itself lives in the page content as an
 * `<image-description src="…">…</image-description>` marker directly below the
 * image — written there by the block editor's materialization and by the
 * document import (framework `src/lib/knowledge/image-descriptions.ts` is the
 * source of truth for that format). This module is the READING half used by
 * the wiki app:
 *
 *   - `extractPageImages` — what the MCP tools attach to a page result, so a
 *     model does not have to parse markdown to learn which images exist, what
 *     they show, and how to load them
 *   - `compactImagesForSnippet` — search snippets are cut to a few hundred
 *     characters; a 60-character image path would eat a quarter of that budget
 *     and say nothing, so an image collapses to `[image: <description>]`
 *   - `stripImageDescriptions` — for anything rendering the text for a HUMAN
 *     that shows the description its own way (a caption, an expander)
 *
 * The format constants are deliberately duplicated from the framework module
 * rather than imported: this package pins the framework as a submodule, and a
 * one-regex duplicate (like `IMAGE_REF_RE` in ../../mcp/tools/_shapes.ts) is
 * cheaper than coupling the app build to an unreleased framework symbol. Keep
 * the two in sync — the format is described in the framework module's header.
 */

/** The marker as it appears in page content. Tolerant about attribute order. */
const IMAGE_DESCRIPTION_RE =
  /<image-description\b([^>]*)>([\s\S]*?)<\/image-description\s*>/gi;

/** An opening marker whose closing tag was cut off (truncated snippet). */
const DANGLING_DESCRIPTION_RE = /<image-description\b([^>]*)>([\s\S]*)$/i;

/** A closing marker whose opening tag was cut off. */
const ORPHAN_CLOSE_RE = /^[\s\S]*?<\/image-description\s*>/i;

const SRC_ATTRIBUTE_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * A page image reference as embedded in content — `/files/db/<bucket>/<uuid>.<ext>`
 * for either bucket that holds page images ("knowledge" for an editor upload,
 * "images" for a picture extracted from an imported document).
 */
const IMAGE_REF_RE =
  /\/files\/db\/(?:knowledge|images)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}/gi;

/** A markdown image: `![alt](<target> "title")`. */
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** {@link IMAGE_REF_RE} without `g`, so `.test()` cannot carry a `lastIndex`. */
const IMAGE_REF_ONE = new RegExp(IMAGE_REF_RE.source, "i");

/** An html image tag (a page written as an html block, or a raw-html page). */
const HTML_IMAGE_RE = /<img\b([^>]*)>/gi;

const ALT_ATTRIBUTE_RE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const decodeHtmlText = (value: string): string =>
  value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&");

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * The key two mentions of the same image agree on.
 *
 * An image is embedded with the full API path
 * (`/api/v1/tenant/<t>/files/db/knowledge/<uuid>.png`), while a reference
 * handed to `get_page_image` is the `/files/db/…` tail — so the marker's `src`
 * and the extracted reference are the same picture written two ways. Reducing
 * both to the tail is what lets a description find its image.
 */
const imageKey = (src: string): string => {
  const match = IMAGE_REF_ONE.exec(src);
  return (match?.[0] ?? src).trim().toLowerCase();
};

/** All unique page-image references embedded in a piece of content. */
export const extractEmbeddedImageRefs = (content: string): string[] => [
  ...new Set(content.match(IMAGE_REF_RE) ?? []),
];

/** The descriptions in a piece of content, keyed by {@link imageKey}. */
const descriptionsByImage = (content: string): Map<string, string> => {
  const found = new Map<string, string>();
  if (!/<image-description\b/i.test(content)) return found;

  for (const match of content.matchAll(IMAGE_DESCRIPTION_RE)) {
    const src = SRC_ATTRIBUTE_RE.exec(match[1] ?? "");
    const path = decodeHtmlText(src?.[1] ?? src?.[2] ?? "").trim();
    if (!path) continue;
    const key = imageKey(path);
    if (found.has(key)) continue;
    const description = oneLine(decodeHtmlText(match[2] ?? ""));
    if (description) found.set(key, description);
  }
  return found;
};

/** The alt texts in a piece of content, keyed by {@link imageKey}. */
const altTextsByImage = (content: string): Map<string, string> => {
  const found = new Map<string, string>();

  for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
    const key = imageKey(match[2] ?? "");
    const alt = oneLine(match[1] ?? "");
    if (alt && !found.has(key)) found.set(key, alt);
  }
  for (const match of content.matchAll(HTML_IMAGE_RE)) {
    const attributes = match[1] ?? "";
    const src = SRC_ATTRIBUTE_RE.exec(attributes);
    const path = decodeHtmlText(src?.[1] ?? src?.[2] ?? "");
    if (!path) continue;
    const key = imageKey(path);
    const altAttribute = ALT_ATTRIBUTE_RE.exec(attributes);
    const alt = oneLine(decodeHtmlText(altAttribute?.[1] ?? altAttribute?.[2] ?? ""));
    if (alt && !found.has(key)) found.set(key, alt);
  }
  return found;
};

export type PageImage = {
  /** Pass this to `get_page_image` / `view_image` verbatim. */
  ref: string;
  /** The image's alt text, when it carries one that is not just a file name. */
  alt?: string;
  /** What the picture shows, when someone described it. */
  description?: string;
};

/**
 * An alt text that is only the uploaded file name says nothing a model can use
 * ("Screenshot 2026-01-02 10.11.12.png") — and every editor upload gets one.
 * Dropping it keeps the annotation honest about what is actually known.
 */
const isFileNameAlt = (alt: string, ref: string): boolean => {
  if (/\.[a-z0-9]{1,8}$/i.test(alt) && !/\s/.test(alt)) return true;
  return ref.toLowerCase().endsWith(alt.toLowerCase());
};

/**
 * The images a page embeds, in the order they appear: reference, alt text and
 * description. Images without any of the extras still come back — knowing an
 * image exists (and can be loaded) is the minimum.
 */
export const extractPageImages = (content: string): PageImage[] => {
  const refs = extractEmbeddedImageRefs(content);
  if (refs.length === 0) return [];

  const descriptions = descriptionsByImage(content);
  const alts = altTextsByImage(content);

  return refs.map((ref) => {
    const key = imageKey(ref);
    const alt = alts.get(key);
    const description = descriptions.get(key);
    return {
      ref,
      ...(alt && !isFileNameAlt(alt, ref) ? { alt } : {}),
      ...(description ? { description } : {}),
    };
  });
};

/** Remove every description marker, taking a line that held only one with it. */
export const stripImageDescriptions = (content: string): string => {
  if (!/<image-description\b/i.test(content)) return content;
  return content
    .replace(
      new RegExp(`^[^\\S\\n]*${IMAGE_DESCRIPTION_RE.source}[^\\S\\n]*\\n?`, "gim"),
      "",
    )
    .replace(IMAGE_DESCRIPTION_RE, "");
};

/**
 * Collapse the images in a search snippet to `[image: …]`.
 *
 * A snippet is a few hundred characters of budget in which an image currently
 * spends ~60 on a uuid path that means nothing to a model. What matters is
 * that there IS an image and what it shows, so the path, the alt text and the
 * marker become one short label. Both truncated halves of a marker are handled
 * too: the snippet is cut blind by the search, so an opening tag without its
 * closing tag (and vice versa) is the normal case, not an edge case.
 */
export const compactImagesForSnippet = (snippet: string): string => {
  if (!snippet) return snippet;

  const label = (description: string, alt: string): string => {
    const text = oneLine(description) || oneLine(alt);
    return text ? `[image: ${text}]` : "[image]";
  };
  /** Compose one of the patterns above with another. */
  const re = (source: string, flags: string): RegExp => new RegExp(source, flags);

  let out = snippet;

  // 1. an image with its complete marker: one label carrying the description
  out = out.replace(
    re(`${MARKDOWN_IMAGE_RE.source}\\s*${IMAGE_DESCRIPTION_RE.source}`, "gi"),
    (_match, alt: string, _target: string, _attrs: string, text: string) =>
      label(decodeHtmlText(text ?? ""), alt ?? ""),
  );

  // 2. an image whose marker the snippet cut open at the end — before the bare
  //    image rule below, which would otherwise label the image separately and
  //    leave the description dangling as a second label
  out = out.replace(
    re(
      `${MARKDOWN_IMAGE_RE.source}\\s*${DANGLING_DESCRIPTION_RE.source}`,
      "i",
    ),
    (_match, alt: string, _target: string, _attrs: string, text: string) =>
      label(decodeHtmlText(text ?? ""), alt ?? ""),
  );

  // 3. a complete marker on its own (the image sat above the snippet's start)
  out = out.replace(IMAGE_DESCRIPTION_RE, (_match, _attrs: string, text: string) =>
    label(decodeHtmlText(text ?? ""), ""),
  );

  // 4. a marker cut open at the end, with no image in front of it
  out = out.replace(
    DANGLING_DESCRIPTION_RE,
    (_match, _attrs: string, text: string) =>
      label(decodeHtmlText(text ?? ""), ""),
  );

  // 5. a closing tag whose opening half is gone: everything before it is the
  //    tail of the description
  if (/<\/image-description/i.test(out)) {
    out = out.replace(ORPHAN_CLOSE_RE, (match) =>
      label(decodeHtmlText(match.replace(/<\/image-description\s*>/i, "")), ""),
    );
  }

  // 6. a page image nobody described
  return out.replace(MARKDOWN_IMAGE_RE, (match, alt: string, target: string) =>
    IMAGE_REF_ONE.test(target) ? label("", alt ?? "") : match,
  );
};
