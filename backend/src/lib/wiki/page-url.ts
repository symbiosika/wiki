/**
 * The address of a wiki page in the web app — one source of truth.
 *
 * Anything that hands a page to a human (the MCP tools, the chat assistant,
 * later emails or notifications) needs the URL a browser can actually open,
 * not just the page id. That URL is not obvious from the route table: the SPA
 * is served under `/static/app/` and uses HASH routing
 * (`createWebHashHistory`, see frontend/src/router), so the route lives behind
 * a `#`:
 *
 *   <baseUrl>/static/app/#/tenant/<tenantId>/wiki/<pageId>[#<anchor>]
 *
 * Getting that wrong produces links that look fine and lead nowhere, so every
 * producer builds them here instead of concatenating its own.
 */

import { _GLOBAL_SERVER_CONFIG } from "@framework/store";

/** Where the authenticated single-page app is served (see frontend vite base). */
export const APP_BASE_PATH = "/static/app/";

/**
 * Path of a wiki page inside the app, relative to the host — the right form
 * for links rendered INSIDE the app: same origin, same document, so the
 * browser only changes the hash and the router navigates without a reload.
 */
export const wikiPagePath = (
  tenantId: string,
  pageId: string,
  anchor?: string,
): string =>
  `${APP_BASE_PATH}#/tenant/${tenantId}/wiki/${pageId}` +
  (anchor ? `#${anchor}` : "");

/**
 * Absolute URL of a wiki page — the form for anything leaving the app (MCP
 * clients, mails). Host comes from the framework's `baseUrl` (BASE_URL), read
 * on every call so tests and late configuration see the current value.
 */
export const wikiPageUrl = (
  tenantId: string,
  pageId: string,
  anchor?: string,
): string =>
  `${_GLOBAL_SERVER_CONFIG.baseUrl.replace(/\/$/, "")}${wikiPagePath(
    tenantId,
    pageId,
    anchor,
  )}`;
