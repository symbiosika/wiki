/**
 * MCP Apps (interactive UI) support + image access.
 *
 *   - `view_page`      : like `get_page`, but linked to an HTML view
 *                        (`_meta.ui.resourceUri`) that capable hosts
 *                        (claude.ai & co) render in a sandboxed iframe —
 *                        formatted page, images included, [[wikilinks]]
 *                        navigable in place.
 *   - `get_page_image` : returns one image embedded in a page as a real MCP
 *                        image content block (base64). Used by the app to
 *                        load images (the iframe has no wiki token and its
 *                        CSP blocks direct loading), and callable by the
 *                        model so Claude can literally look at a diagram.
 *   - the UI resource  : `ui://symbiosika-wiki/page-view.html`, a single
 *                        self-contained HTML file (see ../ui/build.ts).
 *
 * Wire format per the MCP Apps spec (SEP-1865): resource mime type
 * `text/html;profile=mcp-app`; tool ↔ view linkage via `_meta.ui.resourceUri`
 * (modern) plus the legacy `_meta["ui/resourceUri"]` key for older hosts.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import { annotateEmbeddedImages } from "./_shapes.ts";
import { callApi, fail, tenantPath, type ToolResult } from "../app-api.ts";
import { ISSUER } from "../config.ts";
import { buildPageViewHtml } from "../ui/build.ts";
import type { AuthInfo } from "@modelcontextprotocol/server";

export const PAGE_VIEW_RESOURCE_URI = "ui://symbiosika-wiki/page-view.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/** `_meta` that links a tool to the page-view app (modern + legacy key). */
const PAGE_VIEW_TOOL_META = {
  ui: { resourceUri: PAGE_VIEW_RESOURCE_URI },
  "ui/resourceUri": PAGE_VIEW_RESOURCE_URI,
};

/**
 * `_meta.ui` of the resource itself. The view is fully self-contained
 * (bundled script, images arrive as data: URIs through tool calls), so the
 * CSP allowlists are explicitly empty — the host's most restrictive sandbox
 * is exactly what we want, stated rather than defaulted.
 */
const PAGE_VIEW_RESOURCE_META = {
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

export function registerAppUiTools(mcp: any): void {
  // The HTML view, served as an MCP resource. Built lazily on first read.
  mcp.registerResource(
    "wiki-page-view",
    PAGE_VIEW_RESOURCE_URI,
    {
      title: "Wiki page view",
      description:
        "Interactive rendering of a wiki page (used by the view_page tool).",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: PAGE_VIEW_RESOURCE_META,
    },
    async () => ({
      contents: [
        {
          uri: PAGE_VIEW_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await buildPageViewHtml(),
          _meta: PAGE_VIEW_RESOURCE_META,
        },
      ],
    }),
  );

  defineTool(
    mcp,
    {
      name: "view_page",
      title: "Show a page to the user (rendered view)",
      description:
        "Returns a page like `get_page` (`{ id, title, content }`) AND shows " +
        "it to the user as a formatted view — headings, tables and images " +
        "rendered, [[wikilinks]] clickable. Prefer this over `get_page` " +
        "whenever the user asks to SEE a page (or its images/diagrams); use " +
        "`get_page` when the content is only needed as context.",
      inputSchema: z.object({
        pageId: z.string().describe("The page id."),
      }),
      _meta: PAGE_VIEW_TOOL_META,
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/knowledge/texts/${args.pageId}/simplified`),
        { transform: annotateEmbeddedImages },
      ),
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
