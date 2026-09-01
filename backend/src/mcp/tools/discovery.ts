/**
 * Discovery tools: how the assistant finds its way around the wiki.
 *
 *   - get_wiki_overview : the session-start briefing (metrics, top-level
 *     areas with summaries/facets, recent changes, agent instructions)
 *   - get_wiki_tree     : full page tree (personal / teams / organisation)
 *   - search_wiki       : hybrid search with facet & subtree filters
 *   - resolve_page      : title → page without a search round trip
 *   - list_recent_changes : "what changed?", filterable by subtree/facets
 *   - list_pages        : flat index (paged)
 *   - get_wiki_config   : the tenant's controlled facet vocabularies
 */

import { z } from "zod";
import type { McpToolDefinition } from "@framework/types";
import { defineTool, READ_ONLY } from "./_define";
import { callApi, tenantPath } from "../api";
import {
  compactSnippetImages,
  slimOverview,
  slimPageRow,
  slimPageRows,
} from "./_shapes";

export const discoveryTools: McpToolDefinition[] = [
  defineTool(
    {
      name: "get_wiki_overview",
      title: "Get the wiki overview (start here)",
      description:
        "The briefing to load once at the start of a session: metrics (page " +
        "count, last activity), the top-level areas with their summaries and " +
        "facets, the most recently changed pages, and — if the organisation " +
        "maintains one — an agent-instructions page with its full content. " +
        "Start here instead of exploring blind.",
      inputSchema: z.object({
        recentLimit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("How many recent changes to include (default 10)."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, "/knowledge/texts/overview"),
        { query: { recentLimit: args.recentLimit }, transform: slimOverview },
      ),
  ),

  defineTool(
    {
      name: "get_wiki_tree",
      title: "Get the wiki page tree",
      description:
        "Returns the full page tree the user can see, partitioned into three " +
        "sections: `personal` (the user's private pages), `teams` (one section " +
        "per team the user belongs to), and `organisation` (organisation-wide " +
        "pages). Each node has id, title, parentId and nested children. Use " +
        "this for the full structure; `get_wiki_overview` is the cheaper " +
        "starting point.",
      annotations: READ_ONLY,
    },
    async (_args, ctx) =>
      callApi(ctx, tenantPath(ctx, "/wiki/tree")),
  ),

  defineTool(
    {
      name: "search_wiki",
      title: "Search the wiki",
      description:
        "Search across all pages the user can see. Defaults to hybrid " +
        "(full-text + semantic, rank-fused) and degrades to full-text " +
        "automatically when embeddings are unavailable — only set `mode` to " +
        "override that. Results are ranked trust-aware (verified boosted, " +
        "outdated demoted, superseded pages folded under their successor) and " +
        "carry id, title, snippet, summary, pageType, status and updatedAt so " +
        "you can decide what to read without opening every hit, plus `url` — " +
        "the hit's direct link in the wiki, to cite as \"[title](url)\". " +
        "Each hit also " +
        "carries `path`, its breadcrumb in the wiki tree (e.g. " +
        "\"Handbook/HR/Vacation Policy\", last segment is the page itself) — " +
        "cite it so the user sees where the answer lives. Narrow with " +
        "`parentId` (subtree), `pageType` / `status` (facets) or `teamId`.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The search query."),
        mode: z
          .enum(["hybrid", "fulltext", "semantic"])
          .optional()
          .describe(
            "Override the search mode (default: hybrid with automatic " +
              "full-text fallback).",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of results (default 10)."),
        parentId: z
          .string()
          .optional()
          .describe("Restrict to a subtree: this page and all descendants."),
        pageType: z
          .string()
          .optional()
          .describe("Facet filter, e.g. FAQ / manual / policy (see get_wiki_config)."),
        status: z
          .string()
          .optional()
          .describe("Facet filter, e.g. draft / verified / outdated."),
        teamId: z
          .string()
          .optional()
          .describe("Optional: restrict the search to a specific team."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(ctx, tenantPath(ctx, "/knowledge/texts/search"), {
        query: {
          q: args.query,
          mode: args.mode,
          limit: args.limit,
          parentId: args.parentId,
          pageType: args.pageType,
          status: args.status,
          teamId: args.teamId,
        },
        // a snippet is a small budget: an image in it becomes
        // `[image: <description>]` instead of a 60-character uuid path
        transform: compactSnippetImages,
      }),
  ),

  defineTool(
    {
      name: "resolve_page",
      title: "Resolve a page by title",
      description:
        "Resolves an exact page title (case-insensitive, the same semantics " +
        "[[wikilinks]] use) to the page reference — id, place in the tree, " +
        "scope, summary and facets, without the body text. Cheaper than a " +
        "search when the title is known; 404 means no such page is visible.",
      inputSchema: z.object({
        title: z.string().min(1).describe("The exact page title."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(ctx, tenantPath(ctx, "/knowledge/texts/resolve"), {
        query: { title: args.title },
        transform: slimPageRow,
      }),
  ),

  defineTool(
    {
      name: "list_recent_changes",
      title: "List recent changes",
      description:
        "The activity feed: visible pages sorted by last change (newest " +
        "first), without body text. Answers \"what changed this week?\" and " +
        "\"is X still current?\". Filter by `since` (ISO timestamp), " +
        "`parentId` (only a subtree), `pageType` / `status` (facets) or " +
        "`teamId`. Each item carries summary and facets for cheap triage.",
      inputSchema: z.object({
        since: z
          .string()
          .optional()
          .describe("Only pages updated at/after this ISO timestamp."),
        parentId: z
          .string()
          .optional()
          .describe("Restrict to a subtree: this page and all descendants."),
        pageType: z.string().optional().describe("Facet filter."),
        status: z.string().optional().describe("Facet filter."),
        teamId: z.string().optional().describe("Only pages of this team."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of items (default 50, cap 200)."),
      }),
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(
        ctx,
        tenantPath(ctx, "/knowledge/texts/recent-changes"),
        {
          query: {
            since: args.since,
            parentId: args.parentId,
            pageType: args.pageType,
            status: args.status,
            teamId: args.teamId,
            limit: args.limit,
          },
          transform: slimPageRows,
        },
      ),
  ),

  defineTool(
    {
      name: "list_pages",
      title: "List pages (flat)",
      description:
        "Lists page references the user can see (no body text), ordered by " +
        "manual position then title. Useful as a raw index or to page through " +
        "large wikis. Prefer `get_wiki_overview` / `get_wiki_tree` for " +
        "structure and `search_wiki` for finding content.",
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
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      callApi(ctx, tenantPath(ctx, "/knowledge/texts"), {
        query: {
          teamId: args.teamId,
          limit: args.limit,
          page: args.page,
        },
        transform: slimPageRows,
      }),
  ),

  defineTool(
    {
      name: "get_wiki_config",
      title: "Get the wiki facet vocabularies",
      description:
        "Returns the organisation's knowledge configuration: the controlled " +
        "vocabularies for the `pageType` and `status` facets (writes outside " +
        "these lists are rejected) and whether AI auto-summaries are enabled. " +
        "Check this before setting facets on pages.",
      annotations: READ_ONLY,
    },
    async (_args, ctx) =>
      callApi(ctx, tenantPath(ctx, "/knowledge/texts/config")),
  ),
];
