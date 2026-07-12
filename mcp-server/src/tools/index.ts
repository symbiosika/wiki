/**
 * Registers all MCP tools on the server, grouped by purpose:
 *
 *   - identity   : who am I, which organisations
 *   - discovery  : tree, search, flat list
 *   - read       : page, line range, subtree, links, backlinks, related, history
 *   - write      : create, update/move, edit content, delete
 *
 * Together these let a chat app use the wiki as its "brain": discover what
 * exists, read it, and maintain it — all with the signed-in user's own
 * permissions (enforced server-side by the app).
 */

import { registerIdentityTools } from "./identity.ts";
import { registerDiscoveryTools } from "./discovery.ts";
import { registerReadTools } from "./read.ts";
import { registerWriteTools } from "./write.ts";

export function registerAllTools(mcp: any): void {
  registerIdentityTools(mcp);
  registerDiscoveryTools(mcp);
  registerReadTools(mcp);
  registerWriteTools(mcp);
}
