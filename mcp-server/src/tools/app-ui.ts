/**
 * MCP Apps (interactive UI) support + image access.
 *
 *   - `view_page`        : like `get_page`, but linked to an HTML view
 *                          (`_meta.ui.resourceUri`) that capable hosts
 *                          (claude.ai & co) render in a sandboxed iframe —
 *                          formatted page, images included, [[wikilinks]]
 *                          navigable in place. Optional `anchor` renders
 *                          just one section.
 *   - `get_page_image`   : returns one image embedded in a page as a real
 *                          MCP image content block (base64). Used by the
 *                          apps to load images (the iframe has no wiki token
 *                          and its CSP blocks direct loading), and callable
 *                          by the model so Claude can look at a diagram.
 *   - `view_image`       : shows ONE page image to the user, large and
 *                          zoomable (fullscreen where the host allows it).
 *   - `view_page_images` : shows all images of a page as a gallery.
 *   - the UI resources   : `ui://symbiosika-wiki/page-view.html` and
 *                          `ui://symbiosika-wiki/image-view.html`, single
 *                          self-contained HTML files (see ../ui/build.ts).
 *
 * Wire format per the MCP Apps spec (SEP-1865): resource mime type
 * `text/html;profile=mcp-app`; tool ↔ view linkage via `_meta.ui.resourceUri`
 * (modern) plus the legacy `_meta["ui/resourceUri"]` key for older hosts.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import {
  annotateEmbeddedImages,
  extractEmbeddedImageRefs,
} from "./_shapes.ts";
import { callApi, fail, ok, tenantPath, type ToolResult } from "../app-api.ts";
import { ISSUER } from "../config.ts";
import { buildAppHtml } from "../ui/build.ts";
import type { AuthInfo } from "@modelcontextprotocol/server";

export const PAGE_VIEW_RESOURCE_URI = "ui://symbiosika-wiki/page-view.html";
export const IMAGE_VIEW_RESOURCE_URI = "ui://symbiosika-wiki/image-view.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/** `_meta` that links a tool to its app (modern + legacy key). */
const toolMetaFor = (resourceUri: string) => ({
  ui: { resourceUri },
  "ui/resourceUri": resourceUri,
});
const PAGE_VIEW_TOOL_META = toolMetaFor(PAGE_VIEW_RESOURCE_URI);
const IMAGE_VIEW_TOOL_META = toolMetaFor(IMAGE_VIEW_RESOURCE_URI);

/**
 * `_meta.ui` of the resource itself. The view is fully self-contained
 * (bundled script, images arrive as data: URIs through tool calls), so the
 * CSP allowlists are explicitly empty — the host's most restrictive sandbox
 * is exactly what we want, stated rather than defaulted.
 */
const APP_RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [] },
    prefersBorder: true,
  },
};

/** Images above this raw size are not inlined (base64 in a tool result). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** `<uuid>.<ext>` — accepts a bare filename or any wiki file URL/path. */
const IMAGE_REF_PATTERN =
  /(?:^|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8})(?:[?#]|$)/i;

/** Extract the `<uuid>.<ext>` filename from an image reference (or null). */
export function parseImageRef(imageRef: string): string | null {
  const match = IMAGE_REF_PATTERN.exec(imageRef.trim());
  return match ? match[1]! : null;
}

async function fetchPageImage(
  authInfo: AuthInfo | undefined,
  pageId: string,
  imageRef: string,
): Promise<ToolResult> {
  const token = authInfo?.token;
  if (!token) return fail("Not authenticated.");

  const filename = parseImageRef(imageRef);
  if (!filename) {
    return fail(
      "Invalid image reference: pass the image filename (`<uuid>.<ext>`) or " +
        "the full `/files/db/knowledge/…` path from the page content.",
    );
  }

  const path = tenantPath(authInfo, `/wiki/${pageId}/images/${filename}`);
  let res: Response;
  try {
    res = await fetch(`${ISSUER}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return fail(`Network error while loading the image: ${(err as Error).message}`);
  }
  if (!res.ok) {
    return fail(
      `API ${res.status} ${res.statusText}: the image could not be loaded ` +
        "(page not visible, or the file is not referenced by this page).",
    );
  }

  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return fail(
      `The image is too large to inline (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, ` +
        `limit ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`,
    );
  }

  return {
    content: [
      {
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType,
      },
    ],
  };
}

/** Register one app HTML view as an MCP resource (built lazily on read). */
function registerAppResource(
  mcp: any,
  name: "page-view" | "image-view",
  uri: string,
  title: string,
  description: string,
): void {
  mcp.registerResource(
    `wiki-${name}`,
    uri,
    {
      title,
      description,
      mimeType: RESOURCE_MIME_TYPE,
      _meta: APP_RESOURCE_META,
    },
    async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await buildAppHtml(name),
          _meta: APP_RESOURCE_META,
        },
      ],
    }),
  );
}

export function registerAppUiTools(mcp: any): void {
  registerAppResource(
    mcp,
    "page-view",
    PAGE_VIEW_RESOURCE_URI,
    "Wiki page view",
    "Interactive rendering of a wiki page (used by the view_page tool).",
  );
  registerAppResource(
    mcp,
    "image-view",
    IMAGE_VIEW_RESOURCE_URI,
    "Wiki image view",
    "Single image / gallery view of wiki page images (used by the " +
      "view_image and view_page_images tools).",
  );

  defineTool(
    mcp,
    {
      name: "view_page",
      title: "Show a page to the user (rendered view)",
      description:
        "Returns a page like `get_page` (`{ id, title, content }`) AND shows " +
        "it to the user as a formatted view — headings, tables and images " +
        "rendered, [[wikilinks]] clickable. Pass `anchor` (a heading slug " +
        "from `get_page_outline`) to show just that section instead of the " +
        "whole page. Prefer this over `get_page` whenever the user asks to " +
        "SEE a page or a section (or its images/diagrams); use `get_page` " +
        "when the content is only needed as context.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
        anchor: z
          .string()
          .optional()
          .describe(
            "Optional heading anchor (from `get_page_outline`): render only " +
              "this section (subsections included) instead of the whole page.",
          ),
      }),
      _meta: PAGE_VIEW_TOOL_META,
    },
    async (args, authInfo) =>
      args.anchor
        ? callApi(
            authInfo,
            tenantPath(authInfo, `/knowledge/texts/${args.pageId}/section`),
            {
              query: { anchor: args.anchor },
              // section returns { id, anchor, heading, level, content } —
              // map it to the { id, title, content } shape the view renders.
              transform: (data) => {
                const section = (data ?? {}) as Record<string, unknown>;
                return annotateEmbeddedImages({
                  id: section.id,
                  title: section.heading,
                  anchor: section.anchor,
                  content: section.content,
                });
              },
            },
          )
        : callApi(
            authInfo,
            tenantPath(authInfo, `/knowledge/texts/${args.pageId}/simplified`),
            { transform: annotateEmbeddedImages },
          ),
  );

  defineTool(
    mcp,
    {
      name: "view_image",
      title: "Show one page image to the user (large view)",
      description:
        "Shows a single image embedded in a page to the user as a large, " +
        "zoomable view (click = fullscreen where the host supports it). " +
        "Pass the image reference exactly as it appears in the page content " +
        "(`/files/db/knowledge/<uuid>.<ext>` or the bare filename), plus an " +
        "optional caption. Use `get_page_image` instead when YOU need to " +
        "look at the image; use this when the USER should see it nicely.",
      inputSchema: z.object({
        pageId: z.string().describe("The id of the page embedding the image."),
        image: z
          .string()
          .describe(
            "The image reference from the page content: the " +
              "`/files/db/knowledge/<uuid>.<ext>` path or the bare filename.",
          ),
        caption: z
          .string()
          .optional()
          .describe("Optional caption shown under the image."),
      }),
      _meta: IMAGE_VIEW_TOOL_META,
    },
    async (args, authInfo) => {
      const filename = parseImageRef(args.image);
      if (!filename) {
        return fail(
          "Invalid image reference: pass the image filename " +
            "(`<uuid>.<ext>`) or the full `/files/db/knowledge/…` path from " +
            "the page content.",
        );
      }
      // sanity check server-side (page visible + file referenced) so the
      // model gets a real error instead of a silently empty view.
      const probe = await fetchPageImage(authInfo, args.pageId, filename);
      if (probe.isError) return probe;
      return ok({
        pageId: args.pageId,
        images: [filename],
        ...(args.caption ? { caption: args.caption } : {}),
      });
    },
  );

  defineTool(
    mcp,
    {
      name: "view_page_images",
      title: "Show all images of a page (gallery)",
      description:
        "Shows every image embedded in a page to the user as a gallery " +
        "(click = enlarge/fullscreen). Returns the list of image references " +
        "found. Errors if the page embeds no images.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      _meta: IMAGE_VIEW_TOOL_META,
    },
    async (args, authInfo) => {
      const page = await callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/simplified`),
      );
      if (page.isError) return page;
      const data = (page.structuredContent ?? {}) as Record<string, unknown>;
      const refs = extractEmbeddedImageRefs(
        typeof data.content === "string" ? data.content : "",
      );
      if (refs.length === 0) {
        return fail("This page embeds no images.");
      }
      return ok({
        pageId: data.id ?? args.pageId,
        title: data.title,
        images: refs,
      });
    },
  );

  defineTool(
    mcp,
    {
      name: "get_page_image",
      title: "Get an image embedded in a page",
      description:
        "Returns one image that is embedded in a page's content as an image " +
        "content block — so it can actually be looked at. Pass the page id " +
        "plus the image reference exactly as it appears in the content " +
        "(the `/files/db/knowledge/<uuid>.<ext>` path or just the " +
        "`<uuid>.<ext>` filename). Access requires read permission on the " +
        "page, and the page must reference the file.",
      inputSchema: z.object({
        pageId: z.string().describe("The id of the page embedding the image."),
        image: z
          .string()
          .describe(
            "The image reference from the page content: the " +
              "`/files/db/knowledge/<uuid>.<ext>` path or the bare filename.",
          ),
      }),
    },
    async (args, authInfo) =>
      fetchPageImage(authInfo, args.pageId, args.image),
  );
}
