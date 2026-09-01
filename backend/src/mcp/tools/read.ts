/**
 * Reading tools: pull the actual knowledge out of the wiki — with context
 * economy as the design rule. `get_page` returns just id/title/content;
 * metadata is an explicit request (`get_page_metadata`). Long pages are read
 * via outline + section or line ranges instead of whole; subtrees can be
 * bounded by depth and a character budget; several pages load in one batch
 * call. The link graph (outgoing, backlinks, related) and the version history
 * complete the picture.
 */

import { z } from "zod";
import type { McpToolDefinition } from "@framework/types";
import { defineTool, READ_ONLY } from "./_define";
import { callApi, tenantPath } from "../api";
import {
  annotateEmbeddedImages,
  pageMetadata,
  pageVersion,
  slimBatchRows,
  slimHistoryRows,
} from "./_shapes";

export const readTools: McpToolDefinition[] = [
  defineTool(
    {
      name: "get_page",
      title: "Get a page (content)",
      description:
        "Returns a page as clean `{ id, url, title, content }` — the full body " +
        "as markdown, no metadata noise; `url` is the page's link in the wiki, " +
        "use it when you cite the page to the user. Use the page id from the overview, " +
        "tree, search results or `resolve_page`. For scope, facets, authorship " +
        "etc. call `get_page_metadata`; for very long pages prefer " +
        "`get_page_outline` + `read_page_section`.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/simplified`),
        { transform: annotateEmbeddedImages },
      ),
  ),

  defineTool(
    {
      name: "get_page_metadata",
      title: "Get page metadata",
      description:
        "Returns a page's metadata WITHOUT the body text: title, parentId, " +
        "scope (personal/team/organisation), summary, facets (pageType, " +
        "status, owner, validUntil, supersedes), authorship (createdBy/" +
        "updatedBy, timestamps), contentMode and size (contentChars). Ask for " +
        "this explicitly when you need context about a page — reading the " +
        "content itself is `get_page`.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}`),
        { transform: pageMetadata },
      ),
  ),

  defineTool(
    {
      name: "get_pages",
      title: "Get several pages at once (batch)",
      description:
        "Reads up to ~20 pages in ONE call — for research across multiple " +
        "search hits instead of one `get_page` per id. Returns each visible " +
        "page as a compact reference plus `content` (set `includeText: false` " +
        "to fetch references only). Ids the user may not see are silently " +
        "omitted from the result.",
      inputSchema: z.object({
        pageIds: z
          .array(z.string())
          .min(1)
          .describe("The page ids to read."),
        includeText: z
          .boolean()
          .optional()
          .describe("Include the full body text (default true)."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(ctx, tenantPath(ctx, "/knowledge/texts/batch"), {
        method: "POST",
        json: {
          ids: args.pageIds,
          includeText: args.includeText ?? true,
        },
        transform: (data) => annotateEmbeddedImages(slimBatchRows(data)),
      }),
  ),

  defineTool(
    {
      name: "get_page_outline",
      title: "Get a page's heading outline",
      description:
        "Returns the heading structure of a page (level, title, stable " +
        "anchor, line number) WITHOUT the body text. The cheap way to " +
        "navigate a long page: fetch the outline, pick a section, then read " +
        "just that section with `read_page_section`.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/outline`),
      ),
  ),

  defineTool(
    {
      name: "read_page_section",
      title: "Read one section of a page",
      description:
        "Reads a single section of a page addressed by its heading anchor " +
        "(from `get_page_outline`). The section spans from the heading to the " +
        "next heading of the same or higher level, subsections included. Use " +
        "this instead of `get_page` for long documents.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        anchor: z
          .string()
          .describe("The section's anchor slug from the outline."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/section`),
        { query: { anchor: args.anchor }, transform: annotateEmbeddedImages },
      ),
  ),

  defineTool(
    {
      name: "read_page_content",
      title: "Read page content (line range)",
      description:
        "Reads a page's content like a file, optionally as a line range " +
        "(fromLine / maxLines). Returns the content plus fromLine, toLine and " +
        "totalLines. Ideal for locating an exact string before editing it " +
        "with `edit_page_content`.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        fromLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based first line to return."),
        maxLines: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of lines to return."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/content`),
        {
          query: { fromLine: args.fromLine, maxLines: args.maxLines },
          transform: annotateEmbeddedImages,
        },
      ),
  ),

  defineTool(
    {
      name: "get_page_subtree",
      title: "Get a page and its subtree",
      description:
        "Returns a page and, recursively, its child pages as clean JSON " +
        "({ id, title, content, children[] }). Use this to load a whole " +
        "section (e.g. a handbook) in one call — and BOUND it: `maxDepth` " +
        "limits how deep children are expanded (nodes with unexpanded " +
        "children get `childrenOmitted: true`), `maxChars` is a total " +
        "character budget across all contents (cut nodes get " +
        "`contentTruncated: true`; structure always stays complete, so you " +
        "can fetch what's missing individually).",
      inputSchema: z.object({
        pageId: z.string().describe("The root page id of the subtree."),
        maxDepth: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Maximum depth to expand (root = 0)."),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Total character budget across all node contents."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/simplified`),
        {
          query: {
            recursive: "true",
            maxDepth: args.maxDepth,
            maxChars: args.maxChars,
          },
          transform: annotateEmbeddedImages,
        },
      ),
  ),

  defineTool(
    {
      name: "get_page_chunk_context",
      title: "Get chunks around a position",
      description:
        "Returns the embedding chunk at a given position (`order`) on a page " +
        "PLUS its neighbouring chunks before/after, in reading order. A search " +
        "hit only carries a single snippet — use this to reload the surrounding " +
        "context an agent lost: pass the hit's `pageId` and its `chunkOrder`. " +
        "Also returns the page's `path` (its breadcrumb in the wiki tree, e.g. " +
        "\"Handbook/HR/Vacation Policy\") so you can cite where the chunks live. " +
        "Returns `totalChunks` (0 = the page has no embeddings) and, per chunk, " +
        "its `order`, `header`, `text`, `sourcePage` (the PDF page it came " +
        "from, when known) and `matched` (true for the addressed chunk). " +
        "`before`/`after` default to 2 each (per-side cap 20).",
      inputSchema: z.object({
        pageId: z.string().describe("The page id (from a search hit or the tree)."),
        order: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "The chunk position to centre on — the `chunkOrder` of a search " +
              "hit. Defaults to 0 (start of the page).",
          ),
        before: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("How many chunks before the centre to include (default 2, max 20)."),
        after: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("How many chunks after the centre to include (default 2, max 20)."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/chunk-context`),
        {
          query: {
            order: args.order,
            before: args.before,
            after: args.after,
          },
        },
      ),
  ),

  defineTool(
    {
      name: "get_page_links",
      title: "Get outgoing links",
      description:
        "Returns the outgoing [[wikilinks]] of a page: for each link the target " +
        "title, whether it resolves to an existing page, and the target page " +
        "(id, title) when resolved. Unresolved links point at pages that do " +
        "not exist yet.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/links`),
      ),
  ),

  defineTool(
    {
      name: "get_page_backlinks",
      title: "Get backlinks",
      description:
        "Returns all pages that link TO the given page ([[wikilink]] backlinks). " +
        "Useful to understand context and what references a topic.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/backlinks`),
      ),
  ),

  defineTool(
    {
      name: "get_related_pages",
      title: "Get semantically related pages",
      description:
        "Returns pages semantically related to the given page (via embedding " +
        "similarity). Needs embeddings enabled for the content; may return an " +
        "empty list otherwise.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/related`),
      ),
  ),

  defineTool(
    {
      name: "get_page_history",
      title: "Get page version history",
      description:
        "Returns the version history of a page, newest first — as a compact " +
        "list (versionId, title, size, author, timestamps) WITHOUT the old " +
        "contents. Load a specific old version in full with " +
        "`get_page_version`.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of versions to return."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, `/knowledge/texts/${args.pageId}/history`),
        { query: { limit: args.limit }, transform: slimHistoryRows },
      ),
  ),

  defineTool(
    {
      name: "get_page_version",
      title: "Get one historic version of a page",
      description:
        "Returns a single archived version of a page in full (title + " +
        "content at that time, authorship, when it was superseded). Use the " +
        "versionId from `get_page_history`.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        versionId: z
          .string()
          .describe("The history entry id from `get_page_history`."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(
          ctx,
          `/knowledge/texts/${args.pageId}/history/${args.versionId}`,
        ),
        { transform: (data) => annotateEmbeddedImages(pageVersion(data)) },
      ),
  ),
];
