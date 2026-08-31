/**
 * Page links: every page a tool result talks about also carries its full URL.
 *
 * Tool results identify pages by an opaque `pageId`. That is enough for the
 * model to keep reading, but not for the answer it gives the user: a chat
 * client that only knows an id cannot link to the source, so answers end up
 * citing a title with no way to open it. The fix is generic instead of
 * per-tool: EVERY tool result passes through `withPageUrls()` (wired into
 * `defineTool`), which walks the returned JSON and adds a `url` next to every
 * page identity it finds — search hits, tree nodes, batch reads, outline
 * sections, link targets, freshly created pages, view results.
 *
 * URL shape (the wiki SPA route):
 *   `<APP_BASE_URL>/tenant/<tenantId>/wiki/<pageId>[#<anchor>]`
 *
 * What counts as "a page" is deliberately conservative, so team/organisation
 * rows and config vocabularies never get a bogus page link:
 *   - an explicit `pageId` / `knowledgeTextId` field, or
 *   - an `id` on an object that also carries a page-ish field (title, content,
 *     text, summary, parentId, children, outline, …).
 * Objects with only an `anchor` (outline headings) inherit the page id of the
 * object they live in, so each heading links straight to its section.
 */

import { APP_BASE_URL } from "./config.ts";
import type { ToolResult } from "./app-api.ts";

/** Link to a page in the wiki web app (optionally to one heading anchor). */
export const pageUrl = (
  tenantId: string,
  pageId: string,
  anchor?: string,
): string =>
  `${APP_BASE_URL}/tenant/${tenantId}/wiki/${pageId}` +
  (anchor ? `#${anchor}` : "");

/**
 * Fields that make an object with an `id` a wiki PAGE. Kept narrow on purpose:
 * teams (`teamId`/`name`/`role`), organisations and the facet vocabularies
 * carry none of these and therefore stay unlinked.
 */
const PAGE_MARKERS = [
  "title",
  "content",
  "text",
  "heading",
  "snippet",
  "summary",
  "parentId",
  "children",
  "outline",
  "pageType",
  "anchor",
];

/** Keys after which the `url` is inserted, so it sits next to the identity. */
const ID_KEYS = ["pageId", "knowledgeTextId", "id", "anchor"];

type Row = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** The page id this object is ABOUT, or undefined if it is not a page. */
const pageIdOf = (row: Row): string | undefined => {
  const explicit = str(row.pageId) ?? str(row.knowledgeTextId);
  if (explicit) return explicit;
  const id = str(row.id);
  if (id && PAGE_MARKERS.some((key) => key in row)) return id;
  return undefined;
};

const annotate = (
  node: unknown,
  tenantId: string,
  inheritedPageId: string | undefined,
): unknown => {
  if (Array.isArray(node)) {
    return node.map((entry) => annotate(entry, tenantId, inheritedPageId));
  }
  if (!node || typeof node !== "object") return node;

  const row = node as Row;
  const ownPageId = pageIdOf(row);
  const anchor = str(row.anchor);
  // A bare heading (outline entry) links into the page it was listed for.
  const target = ownPageId ?? (anchor ? inheritedPageId : undefined);
  const childContext = ownPageId ?? inheritedPageId;

  const out: Row = {};
  let placed = "url" in row || !target;
  const placeUrl = () => {
    if (placed) return;
    out.url = pageUrl(tenantId, target!, anchor);
    placed = true;
  };

  for (const [key, value] of Object.entries(row)) {
    out[key] = annotate(value, tenantId, childContext);
    if (ID_KEYS.includes(key)) placeUrl();
  }
  placeUrl(); // pages identified by something other than an id key

  return out;
};

/** Add `url` to every page-shaped object inside an arbitrary JSON structure. */
export const annotatePageUrls = (data: unknown, tenantId: string): unknown =>
  annotate(data, tenantId, undefined);

/**
 * Annotate a finished tool result: the structured content AND the JSON text
 * block stay in sync, non-JSON text (plain messages) and image blocks are
 * passed through untouched. Errors and results without a resolvable
 * organisation are returned unchanged.
 */
export const withPageUrls = (
  result: ToolResult,
  tenantId: string | undefined,
): ToolResult => {
  if (!tenantId || result.isError) return result;

  const content = result.content.map((block) => {
    if (block.type !== "text") return block;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return block; // plain text (e.g. a confirmation message)
    }
    if (!parsed || typeof parsed !== "object") return block;
    return {
      ...block,
      text: JSON.stringify(annotatePageUrls(parsed, tenantId), null, 2),
    };
  });

  const structuredContent = result.structuredContent
    ? (annotatePageUrls(result.structuredContent, tenantId) as Row)
    : undefined;

  return {
    ...result,
    content,
    ...(structuredContent ? { structuredContent } : {}),
  };
};
