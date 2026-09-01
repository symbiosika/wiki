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
 * URL shape (the SPA's hash route, see `lib/wiki/page-url.ts`):
 *   `<BASE_URL>/static/app/#/tenant/<tenantId>/wiki/<pageId>[#<anchor>]`
 *
 * What counts as "a page" is deliberately conservative, so team rows,
 * organisations and the facet vocabularies never get a bogus page link:
 *   - an explicit `pageId` / `knowledgeTextId` field, or
 *   - an `id` on an object that also carries a page-ish field (title, content,
 *     text, summary, parentId, children, outline, …).
 * Objects with only an `anchor` (outline headings) inherit the page id of the
 * object they live in, so each heading links straight to its section.
 *
 * Tools whose rows carry ids that are NOT page ids — collection records, whose
 * user-defined columns may well be called "title" or "text" — opt out of the
 * `id` heuristic with `opaqueIds` (see `tools/_define.ts`); their explicit
 * `pageId` fields still get linked.
 */

import { wikiPageUrl } from "../lib/wiki/page-url";
import type { ToolResult } from "./api";

/**
 * Link to a page in the wiki web app (optionally to one heading anchor).
 * Absolute, because MCP clients live outside this app; the exact shape —
 * `<baseUrl>/static/app/#/tenant/…`, the SPA's hash route — comes from
 * `lib/wiki/page-url.ts`.
 */
export const pageUrl = wikiPageUrl;

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

type Row = Record<string, unknown>;

export type PageUrlOptions = {
  /**
   * Whether a plain `id` may be a page id (default true). False for results
   * whose rows are keyed by something else (collection records).
   */
  idsArePageIds?: boolean;
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * The page this object is ABOUT — the id and the field it came from, so the
 * `url` can be placed right next to that field. Undefined if it is not a page.
 */
const pageIdOf = (
  row: Row,
  idsArePageIds: boolean,
): { pageId: string; key: string } | undefined => {
  for (const key of ["pageId", "knowledgeTextId"]) {
    const explicit = str(row[key]);
    if (explicit) return { pageId: explicit, key };
  }
  if (!idsArePageIds) return undefined;
  const id = str(row.id);
  if (id && PAGE_MARKERS.some((key) => key in row)) {
    return { pageId: id, key: "id" };
  }
  return undefined;
};

const annotate = (
  node: unknown,
  tenantId: string,
  inheritedPageId: string | undefined,
  idsArePageIds: boolean,
): unknown => {
  if (Array.isArray(node)) {
    return node.map((entry) =>
      annotate(entry, tenantId, inheritedPageId, idsArePageIds),
    );
  }
  if (!node || typeof node !== "object") return node;

  const row = node as Row;
  const own = pageIdOf(row, idsArePageIds);
  const anchor = str(row.anchor);
  // A bare heading (outline entry) links into the page it was listed for.
  const target =
    own ??
    (anchor && inheritedPageId
      ? { pageId: inheritedPageId, key: "anchor" }
      : undefined);
  const childContext = own?.pageId ?? inheritedPageId;

  const out: Row = {};
  let placed = "url" in row || !target;
  const placeUrl = () => {
    if (placed) return;
    out.url = pageUrl(tenantId, target!.pageId, anchor);
    placed = true;
  };

  for (const [key, value] of Object.entries(row)) {
    out[key] = annotate(value, tenantId, childContext, idsArePageIds);
    if (key === target?.key) placeUrl();
  }
  placeUrl(); // safety net if the identifying key vanished in a transform

  return out;
};

/** Add `url` to every page-shaped object inside an arbitrary JSON structure. */
export const annotatePageUrls = (
  data: unknown,
  tenantId: string,
  opts: PageUrlOptions = {},
): unknown =>
  annotate(data, tenantId, undefined, opts.idsArePageIds !== false);

/**
 * Annotate a finished tool result: the structured content AND the JSON text
 * block stay in sync, non-JSON text (plain messages) and image blocks are
 * passed through untouched. Errors and results without a resolvable
 * organisation are returned unchanged.
 */
export const withPageUrls = (
  result: ToolResult,
  tenantId: string | undefined,
  opts: PageUrlOptions = {},
): ToolResult => {
  if (!tenantId || result.isError) return result;

  const content = (result.content ?? []).map((block) => {
    if (block.type !== "text" || typeof block.text !== "string") return block;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return block; // plain text (e.g. a confirmation message)
    }
    if (!parsed || typeof parsed !== "object") return block;
    return {
      ...block,
      text: JSON.stringify(annotatePageUrls(parsed, tenantId, opts), null, 2),
    };
  });

  const structuredContent = result.structuredContent
    ? (annotatePageUrls(result.structuredContent, tenantId, opts) as Row)
    : undefined;

  return {
    ...result,
    content,
    ...(structuredContent ? { structuredContent } : {}),
  };
};
