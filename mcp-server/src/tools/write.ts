/**
 * Writing tools: let the assistant author and maintain the wiki. Create pages
 * (personal, in a team, or organisation-wide), move/rename/curate them
 * (facets: pageType, status, validUntil, supersedes), append to them, make
 * surgical string-replace edits, or delete them. Every write runs with the
 * user's own permissions — the app rejects writes to pages the user may not
 * change.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import { callApi, tenantPath, resolveTenantId } from "../app-api.ts";
import { pageMetadata } from "./_shapes.ts";

export function registerWriteTools(mcp: any): void {
  defineTool(
    mcp,
    {
      name: "create_page",
      title: "Create a page",
      description:
        "Creates a new wiki page. By default it is a personal (private) page. " +
        "Set `parentId` to nest it under another page, `teamId` to place it in " +
        "a team, or `organisation: true` to make it organisation-wide. Provide " +
        "the body as markdown in `content`; link related pages with " +
        "[[wikilinks]]. Optionally classify it right away with `pageType` / " +
        "`status` (allowed values: `get_wiki_config`). Returns the created " +
        "page reference (incl. id).",
      inputSchema: z.object({
        title: z.string().min(1).describe("The page title."),
        content: z
          .string()
          .optional()
          .describe("Page body as markdown (optional)."),
        parentId: z
          .string()
          .optional()
          .describe("Optional parent page id, to nest this page."),
        teamId: z
          .string()
          .optional()
          .describe("Optional team id — places the page in that team."),
        organisation: z
          .boolean()
          .optional()
          .describe(
            "If true, make the page organisation-wide (visible to all members). " +
              "Ignored when `teamId` is set.",
          ),
        pageType: z
          .string()
          .optional()
          .describe("Facet: kind of page (controlled vocabulary)."),
        status: z
          .string()
          .optional()
          .describe("Facet: trust status (controlled vocabulary)."),
      }),
    },
    async (args, authInfo) =>
      callApi(authInfo, tenantPath(authInfo, "/knowledge/texts"), {
        method: "POST",
        json: {
          tenantId: resolveTenantId(authInfo),
          title: args.title,
          text: args.content ?? "",
          // "text" mode: the markdown lives in the text column, so the
          // agentic read/edit tools (read_page_content / edit_page_content)
          // operate on it directly. The web editor converts it to blocks the
          // first time a human opens the page.
          contentMode: "text",
          parentId: args.parentId,
          teamId: args.teamId,
          tenantWide: args.teamId ? false : Boolean(args.organisation),
          pageType: args.pageType,
          status: args.status,
        },
        transform: pageMetadata,
      }),
  );

  defineTool(
    mcp,
    {
      name: "update_page",
      title: "Update a page (title / move / facets)",
      description:
        "Updates a page's metadata: rename it (`title`), move it under another " +
        "page (`parentId`, null for top level), move it into a team (`teamId`) " +
        "or make it organisation-wide (`organisation`). Also curates the " +
        "facets: `pageType` and `status` (controlled vocabularies, see " +
        "`get_wiki_config`), `validUntil` (expiry of time-bound content), " +
        "`supersedesId` (this page replaces another) and `summary` (setting " +
        "it switches the page to a manual summary that auto-generation never " +
        "overwrites). To change the body text use `edit_page_content` or " +
        "`append_to_page` instead.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        title: z.string().optional().describe("New title."),
        parentId: z
          .string()
          .nullable()
          .optional()
          .describe("New parent page id, or null to move to the top level."),
        teamId: z
          .string()
          .nullable()
          .optional()
          .describe("Move into this team (or null to remove team scope)."),
        organisation: z
          .boolean()
          .optional()
          .describe("Set organisation-wide visibility."),
        pageType: z
          .string()
          .nullable()
          .optional()
          .describe("Facet: kind of page (null clears it)."),
        status: z
          .string()
          .nullable()
          .optional()
          .describe("Facet: trust status (null clears it)."),
        validUntil: z
          .string()
          .nullable()
          .optional()
          .describe("Facet: ISO expiry timestamp (null clears it)."),
        supersedesId: z
          .string()
          .nullable()
          .optional()
          .describe("Facet: id of the page this one replaces (null clears it)."),
        summary: z
          .string()
          .optional()
          .describe(
            "Manual 1-2 sentence summary; switches the page to manual " +
              "summary mode.",
          ),
      }),
    },
    async (args, authInfo) => {
      const body: Record<string, unknown> = { tenantId: resolveTenantId(authInfo) };
      if (args.title !== undefined) body.title = args.title;
      if (args.parentId !== undefined) body.parentId = args.parentId;
      if (args.teamId !== undefined) body.teamId = args.teamId;
      if (args.organisation !== undefined) body.tenantWide = args.organisation;
      if (args.pageType !== undefined) body.pageType = args.pageType;
      if (args.status !== undefined) body.status = args.status;
      if (args.validUntil !== undefined) body.validUntil = args.validUntil;
      if (args.supersedesId !== undefined) body.supersedesId = args.supersedesId;
      if (args.summary !== undefined) {
        body.summary = args.summary;
        body.summaryMode = "manual";
      }
      return callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}`),
        { method: "PUT", json: body, transform: pageMetadata },
      );
    },
  );

  defineTool(
    mcp,
    {
      name: "append_to_page",
      title: "Append to a page",
      description:
        "Appends markdown to the END of a page — the robust way to add a " +
        "note, log entry or new section: no reading first, no string " +
        "matching, no edit conflicts. A blank line separates the appended " +
        "text by default (override with `separator` on plain-text pages; " +
        "block pages always add the text as a new block). Link other pages " +
        "with [[Page Title]] / [[Page Title|shown text]] — written as-is, " +
        "never escaped. Returns only " +
        "counters (appendedChars, totalChars), not the full content.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        content: z
          .string()
          .min(1)
          .describe("The markdown to append."),
        separator: z
          .string()
          .optional()
          .describe('Separator before the appended text (default "\\n\\n").'),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/append`),
        {
          method: "POST",
          json: { text: args.content, separator: args.separator },
        },
      ),
  );

  defineTool(
    mcp,
    {
      name: "edit_page_content",
      title: "Edit page content (find & replace)",
      description:
        "Edits a page's body by replacing an exact substring, like a code " +
        "editor's find-and-replace. `oldString` must match the current content " +
        "exactly and unambiguously (read it first with `read_page_content`). " +
        "Set `replaceAll: true` to replace every occurrence. To delete, pass an " +
        "empty `newString`: on block pages a block left empty is removed cleanly " +
        "(no empty placeholder), and an `oldString` that spans several blocks " +
        "(copy it verbatim, including the blank lines between them) removes them " +
        "all at once. `newString` may contain [[Page Title]] references " +
        "(write them plainly, never escaped) — they become real page links. " +
        "Keep `newString` otherwise PLAIN TEXT: a page edited in the web editor " +
        "stores rich text, which cannot carry markdown written into it — no " +
        "line breaks, lists or headings (use `append_to_page` for a new " +
        "paragraph). Such an edit is rejected rather than applied badly, and " +
        "the page is left untouched. " +
        "Returns the number of replacements and the new content. " +
        "Fails (409) if the string is missing or ambiguous. For adding at the " +
        "end, `append_to_page` is simpler and safer.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        oldString: z
          .string()
          .min(1)
          .describe("The exact text to replace (must be unique unless replaceAll)."),
        newString: z.string().describe("The replacement text."),
        replaceAll: z
          .boolean()
          .optional()
          .describe("Replace every occurrence instead of requiring uniqueness."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/content`),
        {
          method: "PATCH",
          json: {
            oldString: args.oldString,
            newString: args.newString,
            replaceAll: args.replaceAll ?? false,
          },
        },
      ),
  );

  defineTool(
    mcp,
    {
      name: "delete_page",
      title: "Delete a page",
      description:
        "Deletes a page (and, depending on the backend, its descendants). This " +
        "cannot be undone from here. The app enforces that the user may delete " +
        "the page; otherwise a 403 is returned.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id to delete."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}`),
        { method: "DELETE" },
      ),
  );
}
