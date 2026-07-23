/**
 * Wiki tools for the "Chat with AI" assistant.
 *
 * The assistant's whole job is to work with the wiki: look knowledge up
 * (read) and — only when the user has switched the chat to "edit allowed" —
 * create and maintain pages (write). Every tool is a thin wrapper around the
 * framework's knowledge-text functions, so all permission checks (personal /
 * team / organisation visibility) happen server-side against the logged-in
 * user. The assistant never touches the DB directly and can never reach data
 * the user may not see.
 *
 * Two tool sets, selected by the chat `mode`:
 *   - "read"  → only the read tools below (safe default)
 *   - "edit"  → read tools plus the write tools
 *
 * All calls go through OpenRouter (see ../../index.ts) — the only AI gateway
 * this app uses.
 */

import { tool } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import * as v from "valibot";
import {
  searchKnowledgeTexts,
  type KnowledgeTextSearchMode,
} from "@framework/lib/knowledge/knowledge-text-search";
import {
  getKnowledgeText,
  getKnowledgeTextById,
  createKnowledgeText,
  updateKnowledgeText,
  deleteKnowledgeText,
} from "@framework/lib/knowledge/knowledge-texts";
import {
  readKnowledgeTextContent,
  editKnowledgeTextContent,
} from "@framework/lib/knowledge/knowledge-text-edit";
import { getRelatedKnowledgeTexts } from "@framework/lib/knowledge/knowledge-text-links";
import { getPageChunkContext } from "@framework/lib/knowledge/knowledge-text-chunks";

/** Two chat modes. "read" is the safe default; "edit" unlocks the write tools. */
export type WikiChatMode = "read" | "edit";

/** Identifies the logged-in user, so every tool runs with their permissions. */
export interface WikiToolContext {
  tenantId: string;
  userId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ReturnType<typeof tool<any, any>>;
type ToolMap = Record<string, AnyTool>;

/** Cap page bodies handed back to the model so a huge page can't blow the context. */
const MAX_CONTENT_CHARS = 12_000;

function clip(text: string, max = MAX_CONTENT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated, ${text.length - max} more characters]`;
}

function toError(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Unknown error",
  };
}

/* -------------------------------------------------------------------------- *
 * Read tools — always available                                              *
 * -------------------------------------------------------------------------- */

function buildReadTools(ctx: WikiToolContext): ToolMap {
  const search_wiki = tool({
    description:
      "Search the wiki for pages relevant to a query. Uses hybrid semantic + " +
      "full-text search and returns the best matching pages with a short " +
      "snippet, an AI-generated one-line `summary` (when available) and their " +
      "pageId. Use the summary to judge which hits are worth reading in full. " +
      "Each hit also carries `path`, the page's location in the wiki tree as a " +
      "breadcrumb (e.g. \"Handbook/HR/Vacation Policy\", the last segment is the " +
      "page itself) — cite it so the user sees WHERE the answer lives. " +
      "This is the primary way to find knowledge — " +
      "start here, then read the most promising pages with read_wiki_page. " +
      "When a hit matched semantically it also carries `chunkOrder` (the " +
      "position of the matching chunk) — pass it to get_wiki_chunk_context to " +
      "pull the surrounding text without reading the whole page.",
    inputSchema: valibotSchema(
      v.object({
        query: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("What to look for, in natural language or keywords."),
        ),
        mode: v.optional(
          v.pipe(
            v.picklist(["hybrid", "fulltext", "semantic"]),
            v.description(
              "Search strategy. Default 'hybrid' (recommended). 'fulltext' for " +
                "exact terms, 'semantic' for meaning-based matches.",
            ),
          ),
        ),
        limit: v.optional(
          v.pipe(
            v.number(),
            v.minValue(1),
            v.maxValue(25),
            v.description("Max number of results (default 8)."),
          ),
        ),
      }),
    ),
    execute: async ({ query, mode, limit }) => {
      try {
        const results = await searchKnowledgeTexts(
          query,
          { tenantId: ctx.tenantId, userId: ctx.userId },
          {
            mode: (mode ?? "hybrid") as KnowledgeTextSearchMode,
            limit: limit ?? 8,
          },
        );
        return {
          success: true,
          count: results.length,
          results: results.map((r) => ({
            pageId: r.id,
            title: r.title,
            path: r.path,
            pathIds: r.pathIds,
            snippet: r.snippet,
            summary: r.summary,
            matchedBy: r.matchedBy,
            chunkOrder: r.chunkOrder,
            sourcePage: r.sourcePage,
            blockId: r.blockId,
          })),
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const list_wiki_pages = tool({
    description:
      "List wiki pages (title + pageId, plus a short `summary` when available) " +
      "the user can access. Useful to get an " +
      "overview of what exists when a search is too narrow. Does not return " +
      "page bodies — use read_wiki_page for the content.",
    inputSchema: valibotSchema(
      v.object({
        limit: v.optional(
          v.pipe(
            v.number(),
            v.minValue(1),
            v.maxValue(200),
            v.description("Max number of pages to list (default 100)."),
          ),
        ),
      }),
    ),
    execute: async ({ limit }) => {
      try {
        const pages = await getKnowledgeText({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          limit: limit ?? 100,
        });
        return {
          success: true,
          count: pages.length,
          pages: pages.map((p) => ({
            pageId: p.id,
            title: p.title,
            summary: p.summary,
            parentId: p.parentId,
            tenantWide: p.tenantWide,
            teamId: p.teamId,
          })),
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const read_wiki_page = tool({
    description:
      "Read the full markdown content of a wiki page by its pageId. Returns " +
      "line-numbered content so you can quote it and (in edit mode) target " +
      "edits precisely. Get pageIds from search_wiki or list_wiki_pages.",
    inputSchema: valibotSchema(
      v.object({
        pageId: v.pipe(
          v.string(),
          v.description("The id of the page to read."),
        ),
        fromLine: v.optional(
          v.pipe(
            v.number(),
            v.minValue(1),
            v.description("1-based line to start from (optional)."),
          ),
        ),
        maxLines: v.optional(
          v.pipe(
            v.number(),
            v.minValue(1),
            v.description("How many lines to read from fromLine (optional)."),
          ),
        ),
      }),
    ),
    execute: async ({ pageId, fromLine, maxLines }) => {
      try {
        const view = await readKnowledgeTextContent(
          pageId,
          { tenantId: ctx.tenantId, userId: ctx.userId },
          { fromLine, maxLines },
        );
        return {
          success: true,
          pageId: view.id,
          title: view.title,
          content: clip(view.content),
          fromLine: view.fromLine,
          toLine: view.toLine,
          totalLines: view.totalLines,
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const get_related_wiki_pages = tool({
    description:
      "Find pages related to a given page (by semantic similarity of their " +
      "content). Useful to broaden research from a page you already found.",
    inputSchema: valibotSchema(
      v.object({
        pageId: v.pipe(
          v.string(),
          v.description("The id of the page to find neighbours for."),
        ),
        limit: v.optional(
          v.pipe(
            v.number(),
            v.minValue(1),
            v.maxValue(15),
            v.description("Max number of related pages (default 5)."),
          ),
        ),
      }),
    ),
    execute: async ({ pageId, limit }) => {
      try {
        const related = await getRelatedKnowledgeTexts(
          pageId,
          { tenantId: ctx.tenantId, userId: ctx.userId },
          { limit: limit ?? 5 },
        );
        return {
          success: true,
          count: related.length,
          related: related.map((r) => ({ pageId: r.id, title: r.title })),
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const get_wiki_chunk_context = tool({
    description:
      "Reload the embedding chunks around a position on a page. A search hit " +
      "only gives you one short snippet — call this with the hit's pageId and " +
      "its chunkOrder to get the matching chunk plus the chunks before and " +
      "after it, so you can quote the full surrounding context without reading " +
      "the whole page. Also returns the page's `path` (its breadcrumb in the " +
      "wiki tree, e.g. \"Handbook/HR/Vacation Policy\") so you can cite where " +
      "the chunks live. Returns totalChunks (0 = the page has no embeddings) " +
      "and, per chunk, its order, header, text, sourcePage (the PDF page it " +
      "came from, when known) and matched (true for the addressed chunk).",
    inputSchema: valibotSchema(
      v.object({
        pageId: v.pipe(
          v.string(),
          v.description("The id of the page whose chunks you want."),
        ),
        order: v.optional(
          v.pipe(
            v.number(),
            v.minValue(0),
            v.description(
              "The chunk position to centre on — the chunkOrder from a search " +
                "hit. Defaults to 0 (start of the page).",
            ),
          ),
        ),
        before: v.optional(
          v.pipe(
            v.number(),
            v.minValue(0),
            v.maxValue(20),
            v.description("How many chunks before the centre to include (default 2)."),
          ),
        ),
        after: v.optional(
          v.pipe(
            v.number(),
            v.minValue(0),
            v.maxValue(20),
            v.description("How many chunks after the centre to include (default 2)."),
          ),
        ),
      }),
    ),
    execute: async ({ pageId, order, before, after }) => {
      try {
        const context = await getPageChunkContext(
          pageId,
          { tenantId: ctx.tenantId, userId: ctx.userId },
          { order, before, after },
        );
        return {
          success: true,
          pageId: context.pageId,
          title: context.title,
          path: context.path,
          pathIds: context.pathIds,
          totalChunks: context.totalChunks,
          chunks: context.chunks.map((chunk) => ({
            order: chunk.order,
            header: chunk.header,
            text: clip(chunk.text),
            sourcePage: chunk.sourcePage,
            blockId: chunk.blockId,
            matched: chunk.matched,
          })),
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  return {
    search_wiki,
    list_wiki_pages,
    read_wiki_page,
    get_related_wiki_pages,
    get_wiki_chunk_context,
  };
}

/* -------------------------------------------------------------------------- *
 * Write tools — only added in "edit" mode                                    *
 * -------------------------------------------------------------------------- */

function buildWriteTools(ctx: WikiToolContext): ToolMap {
  const create_wiki_page = tool({
    description:
      "Create a new wiki page. Body is markdown in `content`. By default the " +
      "page is organisation-wide (visible to all members); set organisation " +
      "to false for a personal page. Set parentId to nest it under an existing " +
      "page. Returns the created pageId. Only create pages the user asked for.",
    inputSchema: valibotSchema(
      v.object({
        title: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(1000),
          v.description("The page title (required)."),
        ),
        content: v.optional(
          v.pipe(
            v.string(),
            v.description("Page body as markdown (optional)."),
          ),
        ),
        parentId: v.optional(
          v.pipe(
            v.string(),
            v.description("Optional parent pageId, to nest this page."),
          ),
        ),
        organisation: v.optional(
          v.pipe(
            v.boolean(),
            v.description(
              "Organisation-wide visibility. Default true. Set false for a " +
                "private personal page.",
            ),
          ),
        ),
      }),
    ),
    execute: async ({ title, content, parentId, organisation }) => {
      try {
        const page = await createKnowledgeText({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          createdBy: ctx.userId,
          title,
          text: content ?? "",
          // "text" mode keeps the markdown in the `text` column so the
          // read/edit content tools operate on it directly. The web editor
          // converts it to blocks the first time a human opens the page.
          contentMode: "text",
          parentId: parentId ?? null,
          tenantWide: organisation ?? true,
        });
        return {
          success: true,
          pageId: page.id,
          title: page.title,
          tenantWide: page.tenantWide,
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const edit_wiki_page_content = tool({
    description:
      "Edit a page's body by exact find-and-replace (like a code editor). " +
      "`oldString` must match the current content exactly; unless replaceAll " +
      "is true it must be unique — read the page first with read_wiki_page and " +
      "include enough surrounding context. Returns the number of replacements.",
    inputSchema: valibotSchema(
      v.object({
        pageId: v.pipe(v.string(), v.description("The page id.")),
        oldString: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("Exact text to replace (unique unless replaceAll)."),
        ),
        newString: v.pipe(v.string(), v.description("The replacement text.")),
        replaceAll: v.optional(
          v.pipe(
            v.boolean(),
            v.description("Replace every occurrence instead of requiring uniqueness."),
          ),
        ),
      }),
    ),
    execute: async ({ pageId, oldString, newString, replaceAll }) => {
      try {
        const result = await editKnowledgeTextContent(
          pageId,
          { oldString, newString, replaceAll: replaceAll ?? false },
          { tenantId: ctx.tenantId, userId: ctx.userId },
        );
        return {
          success: true,
          pageId: result.id,
          replacements: result.replacements,
          content: clip(result.content),
        };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const update_wiki_page = tool({
    description:
      "Update a page's metadata: rename it (title), move it under another page " +
      "(parentId, null for top level) or change organisation-wide visibility. " +
      "To change the body text use edit_wiki_page_content instead.",
    inputSchema: valibotSchema(
      v.object({
        pageId: v.pipe(v.string(), v.description("The page id.")),
        title: v.optional(
          v.pipe(v.string(), v.maxLength(1000), v.description("New title.")),
        ),
        parentId: v.optional(
          v.nullable(
            v.pipe(
              v.string(),
              v.description("New parent pageId, or null for the top level."),
            ),
          ),
        ),
        organisation: v.optional(
          v.pipe(v.boolean(), v.description("Set organisation-wide visibility.")),
        ),
      }),
    ),
    execute: async ({ pageId, title, parentId, organisation }) => {
      try {
        const data: Record<string, unknown> = {};
        if (title !== undefined) data.title = title;
        if (parentId !== undefined) data.parentId = parentId;
        if (organisation !== undefined) data.tenantWide = organisation;
        const page = await updateKnowledgeText(pageId, data, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
        });
        return { success: true, pageId: page.id, title: page.title };
      } catch (error) {
        return toError(error);
      }
    },
  });

  const delete_wiki_page = tool({
    description:
      "Delete a wiki page (and its descendants). This cannot be undone. Only " +
      "delete a page when the user has clearly asked for it; confirm which page " +
      "by title first.",
    inputSchema: valibotSchema(
      v.object({
        pageId: v.pipe(v.string(), v.description("The page id to delete.")),
      }),
    ),
    execute: async ({ pageId }) => {
      try {
        await deleteKnowledgeText(pageId, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
        });
        return { success: true, pageId };
      } catch (error) {
        return toError(error);
      }
    },
  });

  return {
    create_wiki_page,
    edit_wiki_page_content,
    update_wiki_page,
    delete_wiki_page,
  };
}

/**
 * Build the tool map for the given chat mode. "read" returns the read tools
 * only; "edit" additionally exposes the write tools.
 */
export function createWikiChatTools(
  ctx: WikiToolContext,
  mode: WikiChatMode,
): ToolMap {
  const read = buildReadTools(ctx);
  if (mode === "edit") {
    return { ...read, ...buildWriteTools(ctx) };
  }
  return read;
}

/**
 * System prompt for the wiki assistant. It is deliberately mode-aware: in read
 * mode it tells the model it cannot change anything; in edit mode it lays out
 * the safe write workflow.
 *
 * An optional `orgSystemPrompt` carries organisation-specific instructions
 * (configured under Verwaltung / in the chat's quick-settings). It is appended
 * as an extra, clearly-delimited section so an organisation can steer tone and
 * focus without being able to override the safety rules above it.
 */
export function buildWikiChatSystemPrompt(
  mode: WikiChatMode,
  orgSystemPrompt?: string | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const base = `You are the AI assistant of this wiki (knowledge base). Your main job is to answer the user's questions by looking things up in the wiki. Today is ${today}.

How to work:
- To find knowledge, start with search_wiki, then read the most relevant pages with read_wiki_page. Use list_wiki_pages for an overview and get_related_wiki_pages to broaden research.
- When a search snippet is promising but too short, call get_wiki_chunk_context with the hit's pageId and chunkOrder to pull the surrounding chunks — cheaper than reading the whole page for long documents.
- Base your answers on what the tools return — never invent facts. If the wiki has no answer, say so plainly.
- Cite the pages you used by their title so the user can open them; when a hit carries a \`path\` (its breadcrumb in the wiki tree), mention it so the user sees where the answer lives. Answer in the user's language, concise and well structured.
- All content comes only from this wiki; you have no other data sources.`;

  const modeSection =
    mode === "edit"
      ? `You are in EDIT-ALLOWED mode: the write tools (create_wiki_page, edit_wiki_page_content, update_wiki_page, delete_wiki_page) are enabled.
- Only make changes the user explicitly asked for. Never edit or delete on your own initiative.
- Before editing a page, read it first with read_wiki_page, then use edit_wiki_page_content with a unique oldString.
- Briefly confirm every change you made (page title + what changed).`
      : `You are in READ-ONLY mode: you can only look things up, not change anything. If the user asks you to create or edit a page, explain that they need to switch the chat to "edit allowed" mode (the toggle at the top right of the chat) first.`;

  let prompt = `${base}

${modeSection}`;

  const org = orgSystemPrompt?.trim();
  if (org) {
    prompt += `

Additional instructions for this organisation (follow them unless they conflict with the rules above):
${org}`;
  }

  return prompt;
}
