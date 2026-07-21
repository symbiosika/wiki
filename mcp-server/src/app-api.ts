/**
 * Thin client for the wiki app API (resource-server view).
 *
 * Every call runs in the name of the user: we forward the user's bearer token
 * unchanged to the app. Server-side, EXACTLY the user's permissions apply
 * (role, team/organisation membership, visibility of personal pages). The MCP
 * server implements NO authorization of its own — it only surfaces endpoints
 * and returns app errors (403/404/…) transparently.
 */

import type { AuthInfo } from "@modelcontextprotocol/server";
import { ISSUER, API_BASE_PATH, FALLBACK_TENANT_ID } from "./config.ts";

/** MCP tool result (text + optional structured content). */
export type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
};

/** Success result. Arrays are wrapped in `{ items }` (MCP requires an object). */
export function ok(data: unknown): ToolResult {
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
export function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Resolve the organisation (tenant) id for the API paths. Prefers the tenant
 * binding from the token, falls back to WIKI_TENANT_ID.
 */
export function resolveTenantId(authInfo: AuthInfo | undefined): string {
  const fromToken = (authInfo?.extra as any)?.tenant as string | undefined;
  const tenantId = fromToken || FALLBACK_TENANT_ID;
  if (!tenantId) {
    throw new Error(
      "No organisation id available: the token carries no `tenant` field and " +
        "WIKI_TENANT_ID is not set.",
    );
  }
  return tenantId;
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

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
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
