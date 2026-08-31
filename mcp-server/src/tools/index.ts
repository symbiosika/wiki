/**
 * Registers all MCP tools on the server, grouped by purpose:
 *
 *   - identity   : who am I, which organisations
 *   - discovery  : overview (start here), tree, search, resolve by title,
 *                  recent changes, flat list, facet config
 *   - read       : page content, metadata (explicit), batch read, outline +
 *                  section, line range, chunk context (by position), bounded
 *                  subtree, links, backlinks, related, history + single version
 *   - write      : create, update/move/curate facets, append, edit content,
 *                  delete
 *   - app UI     : view_page (rendered page/section view via MCP Apps),
 *                  view_image / view_page_images (large image + gallery)
 *                  and get_page_image (images as real image content blocks)
 *
 * Together these let a chat app use the wiki as its "brain": discover what
 * exists, read exactly as much as it needs (context economy), and maintain
 * it — all with the signed-in user's own permissions (enforced server-side
 * by the app).
 *
 * Every tool carries MCP tool annotations (readOnlyHint, destructiveHint,
 * idempotentHint, openWorldHint) so clients can tell reading apart from
 * writing before they call: `READ_ONLY` for everything that only reads,
 * `writeAnnotations()` for the five writing tools (see `_helpers.ts`).
 */

import { registerIdentityTools } from "./identity.ts";
import { registerDiscoveryTools } from "./discovery.ts";
import { registerReadTools } from "./read.ts";
import { registerWriteTools } from "./write.ts";
import { registerAppUiTools } from "./app-ui.ts";

export function registerAllTools(mcp: any): void {
  registerIdentityTools(mcp);
  registerDiscoveryTools(mcp);
  registerReadTools(mcp);
  registerWriteTools(mcp);
  registerAppUiTools(mcp);
}
