/**
 * Thin client for the wiki app API (resource-server view).
 *
 * Every call runs in the name of the user: we forward the user's credential
 * unchanged to the app — an OAuth access token as `Authorization: Bearer`, or a
 * framework API token as `X-API-KEY`. Server-side, EXACTLY the user's
 * permissions apply (role, team/organisation membership, visibility of personal
 * pages). The MCP server implements NO authorization of its own — it only
 * surfaces endpoints and returns app errors (403/404/…) transparently.
 */

import type { AuthInfo } from "@modelcontextprotocol/server";
import { ISSUER, API_BASE_PATH, FALLBACK_TENANT_ID } from "./config.ts";

/** Content blocks a tool can return (text, or binary images as base64). */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** MCP tool result (content blocks + optional structured content). */
export type ToolResult = {
  isError?: boolean;
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
};

/** Text-only tool result (what `ok`/`fail` produce). */
export type TextToolResult = ToolResult & {
  content: { type: "text"; text: string }[];
};

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
 * The token's own `tenant` binding always wins. For OAuth access tokens that
 * binding is chosen by the user at authorize time (sole membership, or the
 * organisation picker), so a *missing* binding is an error — NOT a cue to fall
 * back to WIKI_TENANT_ID. On a multi-tenant deployment that silent fallback
 * would map the user into some other organisation, leaking the wrong org's
 * data or failing confusingly with "User is not a member of this tenant".
 * We fail loud and ask the user to reconnect instead.
 *
 * WIKI_TENANT_ID is the intended path only for framework API tokens, which are
 * single-org by design (and already carry it via `validateApiToken`).
 */
export function resolveTenantId(authInfo: AuthInfo | undefined): string {
  const fromToken = (authInfo?.extra as any)?.tenant as string | undefined;
  if (fromToken) return fromToken;

  const kind = (authInfo?.extra as any)?.kind as string | undefined;
  if (kind === "oauth") {
    throw new Error(
      "This access token is not bound to an organisation. Reconnect the wiki " +
        "connector and choose your organisation during sign-in. " +
        "(Do not set WIKI_TENANT_ID on a multi-tenant deployment — it would " +
        "force every token into a single organisation.)",
    );
  }

  if (FALLBACK_TENANT_ID) return FALLBACK_TENANT_ID;
  throw new Error(
    "No organisation id available: the token carries no `tenant` field and " +
      "WIKI_TENANT_ID is not set.",
  );
}

/** Build a tenant-scoped API path: /api/v1/tenant/:tenantId<suffix>. */
export function tenantPath(authInfo: AuthInfo | undefined, suffix: string) {
  return `${API_BASE_PATH}/tenant/${resolveTenantId(authInfo)}${suffix}`;
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

/**
 * Run an API call against the app and return a ready-made ToolResult. On
 * non-2xx the status code + server message becomes the error text.
 */
export async function callApi(
  authInfo: AuthInfo | undefined,
  path: string,
  opts: CallOptions = {},
): Promise<ToolResult> {
  const token = authInfo?.token;
  if (!token) return fail("Not authenticated.");

  const url = new URL(`${ISSUER}${path}`);
  if (opts.query) {
    for (const [k, val] of Object.entries(opts.query)) {
      if (val !== undefined && val !== "")
        url.searchParams.set(k, String(val));
    }
  }

  // Forward the credential the way the app expects it: OAuth access tokens are
  // JWTs sent as a Bearer, framework API tokens are opaque and are exchanged by
  // the app when presented via `X-API-KEY` (see mcp auth `validateApiToken`).
  const headers: Record<string, string> =
    (authInfo?.extra as any)?.kind === "api"
      ? { "x-api-key": token }
      : { authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body });
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
