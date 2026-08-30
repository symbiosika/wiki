/**
 * Thin client for the wiki app API, on top of the framework's in-process
 * `ctx.fetchApi`.
 *
 * Historically the MCP server was a separate process that called this app
 * over HTTP with the forwarded user credential. Embedded in the backend, the
 * calls go through `ctx.fetchApi` instead — same routes, same route-level
 * permission checks, no network. The tools keep talking to the HTTP API on
 * purpose: the routes are where authorisation lives. Every call runs in the
 * name of the user; the MCP layer implements NO authorization of its own —
 * it only surfaces endpoints and returns app errors (403/404/…)
 * transparently.
 */

import type { McpRequestContext, McpToolResult } from "@framework/types";

/** Content blocks a tool can return (text, or binary images as base64). */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** MCP tool result (content blocks + optional structured content). */
export type ToolResult = McpToolResult;

/** Text-only tool result (what `ok`/`fail` produce). */
export type TextToolResult = ToolResult & {
  content: { type: "text"; text: string }[];
};

/**
 * Fallback tenant (organisation) id, used only if a validated credential
 * carries no `tenant` binding. Normally the credential's tenant wins. Read
 * lazily so tests (and late-configured deployments) see the current value.
 */
const fallbackTenantId = () => process.env.WIKI_TENANT_ID || "";

/** API prefix of the wiki app. */
export const API_BASE_PATH = "/api/v1";

/** Success result. Arrays are wrapped in `{ items }` (MCP requires an object). */
export function ok(data: unknown): TextToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const structured =
    data && typeof data === "object"
      ? Array.isArray(data)
        ? { items: data }
        : (data as Record<string, unknown>)
      : undefined;
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Error result (readable for the LLM client). */
export function fail(message: string): TextToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Resolve the organisation (tenant) id for the API paths.
 *
 * The credential's own tenant binding always wins. For OAuth access tokens
 * that binding is chosen by the user at authorize time (sole membership, or
 * the organisation picker), so a *missing* binding is an error — NOT a cue to
 * fall back to WIKI_TENANT_ID. On a multi-tenant deployment that silent
 * fallback would map the user into some other organisation, leaking the wrong
 * org's data or failing confusingly with "User is not a member of this
 * tenant". We fail loud and ask the user to reconnect instead.
 *
 * WIKI_TENANT_ID is the intended path only for non-OAuth credentials that
 * carry no binding of their own (a plain session JWT on a single-org
 * deployment; framework API tokens normally already carry their tenant).
 */
export function resolveTenantId(ctx: McpRequestContext): string {
  if (ctx.tenantId) return ctx.tenantId;

  if (ctx.tokenKind === "oauth") {
    throw new Error(
      "This access token is not bound to an organisation. Reconnect the wiki " +
        "connector and choose your organisation during sign-in. " +
        "(Do not set WIKI_TENANT_ID on a multi-tenant deployment — it would " +
        "force every token into a single organisation.)",
    );
  }

  const fallback = fallbackTenantId();
  if (fallback) return fallback;
  throw new Error(
    "No organisation id available: the credential carries no tenant binding " +
      "and WIKI_TENANT_ID is not set.",
  );
}

/** Build a tenant-scoped API path: /api/v1/tenant/:tenantId<suffix>. */
export function tenantPath(ctx: McpRequestContext, suffix: string) {
  return `${API_BASE_PATH}/tenant/${resolveTenantId(ctx)}${suffix}`;
}

type CallOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body (serialized + content-type set). */
  json?: unknown;
  /** Query parameters (empty/undefined values are dropped). */
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Shape the (unwrapped) response data before it becomes the tool result.
   * Used to keep tool outputs context-friendly: drop internal bookkeeping
   * columns, strip nulls, compute derived fields. Only applied to successful
   * responses.
   */
  transform?: (data: unknown) => unknown;
};

const withQuery = (
  path: string,
  query: CallOptions["query"] | undefined,
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

/**
 * Run an API call against the app and return a ready-made ToolResult. On
 * non-2xx the status code + server message becomes the error text.
 */
export async function callApi(
  ctx: McpRequestContext,
  path: string,
  opts: CallOptions = {},
): Promise<ToolResult> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await ctx.fetchApi(withQuery(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body,
    });
  } catch (err) {
    return fail(`Network error during API call: ${(err as Error).message}`);
  }

  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* leave non-JSON responses as raw text */
  }

  if (!res.ok) {
    const detail =
      parsed && typeof parsed === "object"
        ? ((parsed as any).error ?? (parsed as any).message ?? raw)
        : raw;
    return fail(`API ${res.status} ${res.statusText}: ${detail}`);
  }

  // The wiki API wraps most responses in { success, data }; unwrap for clarity.
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "success" in (parsed as any) &&
    "data" in (parsed as any)
  ) {
    parsed = (parsed as any).data;
  }

  return ok(opts.transform ? opts.transform(parsed) : parsed);
}
