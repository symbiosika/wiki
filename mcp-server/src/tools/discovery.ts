/**
 * Discovery tools: how the assistant finds its way around the wiki. The tree
 * gives structure (personal / teams / organisation), search finds pages by
 * content, and the flat list is a raw index.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import { callApi, tenantPath } from "../app-api.ts";

export function registerDiscoveryTools(mcp: any): void {
  defineTool(
    mcp,
    {
      name: "get_wiki_tree",
      title: "Get the wiki page tree",
      description:
        "Returns the full page tree the user can see, partitioned into three " +
        "sections: `personal` (the user's private pages), `teams` (one section " +
        "per team the user belongs to), and `organisation` (organisation-wide " +
        "pages). Each node has id, title, parentId and nested children. This is " +
        "the best starting point to understand what knowledge exists.",
    },
    async (_args, authInfo) =>
      callApi(authInfo, tenantPath(authInfo, "/wiki/tree")),
  );

  defineTool(
    mcp,
    {
      name: "search_wiki",
      title: "Search the wiki",
      description:
        "Full-text / hybrid / semantic search across all pages the user can " +
        "see. Returns ranked results with id, title, a snippet and the match " +
        "score. Use this to locate relevant pages before reading them in full.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The search query."),
        mode: z
          .enum(["hybrid", "fulltext", "semantic"])
          .optional()
          .describe(
            "Search mode. `fulltext` = keyword match (fast, always available); " +
              "`semantic` / `hybrid` need embeddings enabled. Default: fulltext.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of results (default server-side)."),
        teamId: z
          .string()
          .optional()
          .describe("Optional: restrict the search to a specific team."),
      }),
    },
    async (args, authInfo) =>
      callApi(authInfo, tenantPath(authInfo, "/knowledge/texts/search"), {
        query: {
          q: args.query,
          mode: args.mode ?? "fulltext",
          limit: args.limit,
          teamId: args.teamId,
        },
      }),
  );

  defineTool(
    mcp,
    {
      name: "list_pages",
      title: "List pages (flat)",
      description:
        "Lists page records the user can see (without body text), ordered by " +
        "manual position then title. Useful as a raw index or to page through " +
        "large wikis. Prefer `get_wiki_tree` for structure and `search_wiki` " +
        "for finding specific content.",
      inputSchema: z.object({
        teamId: z
          .string()
          .optional()
          .describe("Optional: only pages of this team."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Page size for pagination."),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based page number (needs `limit`)."),
      }),
    },
    async (args, authInfo) =>
      callApi(authInfo, tenantPath(authInfo, "/knowledge/texts"), {
        query: {
          teamId: args.teamId,
          limit: args.limit,
          page: args.page,
        },
      }),
  );
}
