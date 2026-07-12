/**
 * Reading tools: pull the actual knowledge out of the wiki. From reading a
 * single page or a line range (file-like), to whole subtrees as clean JSON,
 * to the link graph (outgoing links, backlinks, semantically related pages)
 * and the version history.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import { callApi, tenantPath } from "../app-api.ts";

export function registerReadTools(mcp: any): void {
  defineTool(
    mcp,
    {
      name: "get_page",
      title: "Get a page",
      description:
        "Returns a single page in full, including its materialized text/markdown " +
        "content, title, parentId and scope (personal / team / organisation). " +
        "Use the page id from the tree or search results.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
    },
    async (args, authInfo) =>
      callApi(authInfo, tenantPath(authInfo, `/knowledge/texts/${args.pageId}`)),
  );

  defineTool(
    mcp,
    {
      name: "read_page_content",
      title: "Read page content (line range)",
      description:
        "Reads a page's content like a file, optionally as a line range " +
        "(fromLine / maxLines). Returns the content plus fromLine, toLine and " +
        "totalLines. Ideal for large pages or for locating an exact string " +
        "before editing it with `edit_page_content`.",
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
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/content`),
        { query: { fromLine: args.fromLine, maxLines: args.maxLines } },
      ),
  );

  defineTool(
    mcp,
    {
      name: "get_page_subtree",
      title: "Get a page and its subtree",
      description:
        "Returns a page and, recursively, all of its child pages as clean, " +
        "LLM-friendly JSON ({ id, title, content, children[] }). Use this to " +
        "load an entire section of the wiki (e.g. a handbook and all its " +
        "chapters) in one call.",
      inputSchema: z.object({
        pageId: z.string().describe("The root page id of the subtree."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/simplified`),
        { query: { recursive: "true" } },
      ),
  );

  defineTool(
    mcp,
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
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/links`),
      ),
  );

  defineTool(
    mcp,
    {
      name: "get_page_backlinks",
      title: "Get backlinks",
      description:
        "Returns all pages that link TO the given page ([[wikilink]] backlinks). " +
        "Useful to understand context and what references a topic.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/backlinks`),
      ),
  );

  defineTool(
    mcp,
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
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/related`),
      ),
  );

  defineTool(
    mcp,
    {
      name: "get_page_history",
      title: "Get page version history",
      description:
        "Returns the version history (snapshots) of a page, newest first. Each " +
        "snapshot captures title, content and structure at the time of an edit.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/history`),
      ),
  );
}
