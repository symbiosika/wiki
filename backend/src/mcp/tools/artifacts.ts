/**
 * Artifact tool: publish an HTML artifact (a static web page with optional
 * supporting files, e.g. a Claude artifact) as a wiki page. The wiki shows it
 * in a sandboxed frame, with its place in the page tree like any other page.
 * Runs with the user's own permissions through the artifact API.
 */

import { z } from "zod";
import type { McpToolDefinition } from "@framework/types";
import { defineTool, writeAnnotations } from "./_define";
import { fail, ok, requestApi, resolveTenantId, tenantPath } from "../api";

export const artifactTools: McpToolDefinition[] = [
  defineTool(
    {
      name: "publish_artifact",
      title: "Publish an HTML artifact as a wiki page",
      description:
        "Publishes a static web page (an 'artifact': HTML plus optional CSS, " +
        "JS, JSON, images, fonts) into the wiki, where it is shown full-size " +
        "in a sandboxed frame and appears in the page tree like any page. " +
        "Pass `pageId` to upload a new version of an existing artifact page, " +
        "otherwise a new page is created (personal by default; `parentId`, " +
        "`teamId` or `organisation` place it like `create_page`). `files` " +
        "must include `index.html` at the root; every other file is " +
        "referenced from it by RELATIVE path (`app.js`, `data/x.json` — never " +
        "`/app.js`). Scripts may load from cdnjs.cloudflare.com, " +
        "cdn.jsdelivr.net, unpkg.com, cdn.tailwindcss.com and code.jquery.com, " +
        "fonts from Google Fonts; nothing else is reachable. The page has no " +
        "cookies, no storage that persists, no `window.claude` runtime and no " +
        "access to the wiki API. Text files go in as `content` (utf8), " +
        "binary files as base64 with `encoding: \"base64\"`. Limits: 20 MB, " +
        "500 files. Returns the page (with `url`), the version number and any " +
        "warnings from the upload check.",
      inputSchema: z.object({
        files: z
          .array(
            z.object({
              path: z
                .string()
                .min(1)
                .describe("Relative path inside the artifact, e.g. `index.html`."),
              content: z.string().describe("File content (utf8 text or base64)."),
              encoding: z
                .enum(["utf8", "base64"])
                .optional()
                .describe("`base64` for binary files; default utf8."),
            }),
          )
          .min(1)
          .describe("The files of the artifact; must contain `index.html`."),
        pageId: z
          .string()
          .optional()
          .describe("Existing artifact page to update (new version)."),
        title: z
          .string()
          .optional()
          .describe("Title of the new page (required without `pageId`)."),
        parentId: z
          .string()
          .optional()
          .describe("Parent page id for the new page."),
        teamId: z.string().optional().describe("Place the new page in this team."),
        organisation: z
          .boolean()
          .optional()
          .describe("Make the new page organisation-wide."),
      }),
      annotations: writeAnnotations({ destructive: false, idempotent: false }),
    },
    async (args, ctx) => {
      let pageId = args.pageId as string | undefined;
      let created = false;
      if (!pageId) {
        if (!args.title) return fail("Either `pageId` or `title` is required.");
        const page = await requestApi(ctx, tenantPath(ctx, "/knowledge/texts"), {
          method: "POST",
          json: {
            tenantId: resolveTenantId(ctx),
            title: args.title,
            text: "",
            contentMode: "text",
            parentId: args.parentId,
            teamId: args.teamId,
            tenantWide: args.teamId ? false : Boolean(args.organisation),
          },
        });
        if (!page.ok) return fail(page.message);
        pageId = (page.data as { id: string }).id;
        created = true;
      }

      const published = await requestApi(
        ctx,
        tenantPath(ctx, `/wiki/${pageId}/artifact`),
        { method: "POST", json: { files: args.files, sourceName: "mcp" } },
      );
      if (!published.ok) {
        // do not leave an empty page behind for a rejected first upload
        if (created) {
          await requestApi(ctx, tenantPath(ctx, `/knowledge/texts/${pageId}`), {
            method: "DELETE",
          });
        }
        return fail(published.message);
      }
      const info = published.data as {
        current: { version: number; fileCount: number; warnings: string[] };
      };
      return ok({
        pageId,
        title: args.title,
        created,
        version: info.current.version,
        fileCount: info.current.fileCount,
        warnings: info.current.warnings,
      });
    },
  ),
];
