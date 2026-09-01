/**
 * Response shaping for context economy.
 *
 * The app API returns full DB rows (every column except `text` for list-type
 * responses). Most of that is internal bookkeeping an LLM client never needs
 * (summary generation state, embedding wiring, audit uuids, …) but it costs
 * context window on every call. The helpers here reduce rows to what an agent
 * acts on, and drop null/empty fields entirely so quiet pages stay cheap.
 */

import {
  compactImagesForSnippet,
  extractPageImages,
} from "../../lib/wiki/image-descriptions";

type Row = Record<string, unknown>;

/** Remove null/undefined entries so unset fields cost no context. */
export const stripEmpty = (row: Row): Row => {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
};

/**
 * If a piece of content embeds wiki images, list them explicitly — with the
 * description of each image where one exists — and say how to load one.
 *
 * Two things make this worth its context. The reference list lands at exactly
 * the moment the model sees the (otherwise dead) image paths; without it,
 * models tend to assume the images are unreachable instead of reaching for
 * `get_page_image`. And the description is the only thing that tells a
 * text-only reader what is ON a picture — a page whose knowledge sits in a
 * diagram is otherwise unanswerable, no matter how well it is written.
 *
 * Applied to every read path that returns page content: whole page, batch,
 * section, line range, subtree (recursively, `children` included) and a
 * historical version. Annotating only `get_page` — as this did — meant a model
 * reading a long page section by section never learned that it contains
 * pictures at all.
 */
export const annotateEmbeddedImages = (data: unknown): unknown => {
  if (!data || typeof data !== "object") return data;

  // A payload that gains nothing is returned as-is (same object), so wrapping
  // every read path in this costs nothing for the pages without pictures.
  if (Array.isArray(data)) {
    const rows = data.map(annotateEmbeddedImages);
    return rows.some((row, index) => row !== data[index]) ? rows : data;
  }

  const row = data as Row;
  const children = Array.isArray(row.children)
    ? row.children.map(annotateEmbeddedImages)
    : null;
  const childrenChanged =
    children !== null &&
    children.some(
      (child, index) => child !== (row.children as unknown[])[index],
    );

  const images =
    typeof row.content === "string" ? extractPageImages(row.content) : [];
  if (images.length === 0) {
    return childrenChanged ? { ...row, children } : data;
  }

  const described = images.filter((image) => image.description).length;
  return {
    ...row,
    ...(childrenChanged ? { children } : {}),
    embeddedImages: images,
    embeddedImagesHint:
      "This page embeds image(s). Call get_page_image with this pageId and " +
      "one of the references above to actually view/show an image; " +
      "view_page renders them all automatically." +
      (described > 0
        ? " `description` is what the picture shows (written in the wiki, " +
          "shown as a caption there) — treat it as page content."
        : "") +
      (described < images.length
        ? " Image(s) without a `description` can only be judged by looking " +
          "at them."
        : ""),
  };
};

/**
 * Shrink the images inside a search hit's `snippet`.
 *
 * A snippet is a couple of hundred characters wide; a uuid image path spends a
 * quarter of that on nothing. `[image: <description>]` keeps what a model can
 * act on — that there is a picture here, and what it shows — and costs a
 * fraction of the budget. Also the only place the DESCRIPTION reaches search
 * results at all, which is what makes a picture findable.
 */
export const compactSnippetImages = (data: unknown): unknown => {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(compactSnippetImages);

  const row = { ...(data as Row) };
  if (Array.isArray(row.items)) row.items = row.items.map(compactSnippetImages);
  if (Array.isArray(row.results)) {
    row.results = row.results.map(compactSnippetImages);
  }
  if (typeof row.snippet === "string") {
    row.snippet = compactImagesForSnippet(row.snippet);
  }
  return row;
};

/**
 * Derive the human meaning of the access fields: a page is either in a team,
 * organisation-wide, or personal.
 */
const scopeOf = (row: Row): "team" | "organisation" | "personal" =>
  row.teamId ? "team" : row.tenantWide ? "organisation" : "personal";

/**
 * Compact reference for list-type responses (tree/list/recent/resolve/batch):
 * identity, place in the tree, scope, the summary "docstring" and the curation
 * facets. Everything else (audit uuids, summary/embedding bookkeeping, meta)
 * is available via `get_page_metadata`.
 */
export const slimPageRow = (data: unknown): Row => {
  const row = (data ?? {}) as Row;
  return stripEmpty({
    id: row.id,
    title: row.title,
    parentId: row.parentId,
    scope: scopeOf(row),
    teamId: row.teamId,
    summary: row.summary,
    pageType: row.pageType,
    status: row.status,
    validUntil: row.validUntil,
    supersedesId: row.supersedesId,
    updatedAt: row.updatedAt,
  });
};

export const slimPageRows = (data: unknown): Row[] =>
  Array.isArray(data) ? data.map(slimPageRow) : [];

/**
 * Full metadata view of a page: the complete row minus the (potentially huge)
 * body text and minus purely internal wiring (embedding link, summary
 * generation state). This is the explicit "give me the metadata" answer.
 */
export const pageMetadata = (data: unknown): Row => {
  const {
    text,
    knowledgeEntryId,
    summaryStale,
    summaryContentHash,
    summaryModel,
    deletedAt,
    ...rest
  } = (data ?? {}) as Row;
  return stripEmpty({
    ...rest,
    scope: scopeOf(rest),
    contentChars: typeof text === "string" ? text.length : undefined,
  });
};

/**
 * History list entries are full snapshots (text + blocks). For the overview
 * only the "who changed what when" matters; a specific version can be loaded
 * in full via `get_page_version`.
 */
export const slimHistoryRows = (data: unknown): Row[] =>
  Array.isArray(data)
    ? data.map((entry) => {
        const row = (entry ?? {}) as Row;
        return stripEmpty({
          versionId: row.id,
          title: row.title,
          contentChars:
            typeof row.text === "string" ? row.text.length : undefined,
          updatedBy: row.updatedBy,
          versionUpdatedAt: row.versionUpdatedAt,
          supersededAt: row.createdAt,
        });
      })
    : [];

/** A single history version in full, without the internal block snapshot. */
export const pageVersion = (data: unknown): Row => {
  const row = (data ?? {}) as Row;
  return stripEmpty({
    versionId: row.id,
    pageId: row.knowledgeTextId,
    title: row.title,
    content: row.text,
    updatedBy: row.updatedBy,
    versionUpdatedAt: row.versionUpdatedAt,
    supersededAt: row.createdAt,
  });
};

/** Overview: slim the embedded page lists, keep metrics/instructions as-is. */
export const slimOverview = (data: unknown): Row => {
  const row = (data ?? {}) as Row;
  return {
    ...row,
    topLevel: slimPageRows(row.topLevel),
    recentChanges: slimPageRows(row.recentChanges),
  };
};

/** Batch read: slim rows, but surface the body as `content` when present. */
export const slimBatchRows = (data: unknown): Row[] =>
  Array.isArray(data)
    ? data.map((entry) => {
        const row = (entry ?? {}) as Row;
        const slim = slimPageRow(row);
        if (typeof row.text === "string") slim.content = row.text;
        return slim;
      })
    : [];
