/**
 * Writing tools: let the assistant author and maintain the wiki. Create pages
 * (personal, in a team, or organisation-wide), move/rename them, make surgical
 * string-replace edits, or delete them. Every write runs with the user's own
 * permissions — the app rejects writes to pages the user may not change.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import { callApi, tenantPath, resolveTenantId } from "../app-api.ts";

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
        "the body as markdown in `content`. Returns the created page (incl. id).",
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
        },
      }),
  );

  defineTool(
    mcp,
    {
      name: "update_page",
      title: "Update a page (title / move)",
      description:
        "Updates a page's metadata: rename it (`title`), move it under another " +
        "page (`parentId`, use null to make it a root), move it into a team " +
        "(`teamId`) or make it organisation-wide (`organisation`). To change the " +
        "body text use `edit_page_content` instead.",
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
      }),
    },
    async (args, authInfo) => {
      const body: Record<string, unknown> = { tenantId: resolveTenantId(authInfo) };
      if (args.title !== undefined) body.title = args.title;
      if (args.parentId !== undefined) body.parentId = args.parentId;
      if (args.teamId !== undefined) body.teamId = args.teamId;
      if (args.organisation !== undefined) body.tenantWide = args.organisation;
      return callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}`),
        { method: "PUT", json: body },
      );
    },
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
        "Set `replaceAll: true` to replace every occurrence. Returns the number " +
        "of replacements and the new content. Fails (409) if the string is " +
        "missing or ambiguous.",
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
