/**
 * `/health` also says WHICH build is running.
 *
 * The framework's public liveness probe answers `{ "status": "ok" }` and
 * nothing else, so a deploy that silently kept the old image (a failed
 * trigger, a domain still pointing at a retired container) looks exactly like
 * a successful one. This wrapper adds the app version, the build commit and
 * the build time to that answer — `curl <host>/health` then settles "is my
 * change live?" in one request.
 *
 * It sits around the whole server `fetch` (see ../../index.ts) like the other
 * wrappers next to it: the framework registers `/health` itself, before any
 * app route, so neither an app route nor an app middleware could extend it.
 * The framework's response stays the source of truth — only a successful JSON
 * object is extended; anything else passes through untouched.
 */
import { appVersionInfo } from "../../version";

/** The shape of `server.fetch`: Bun may answer `undefined` (e.g. an upgrade). */
type FetchLike = (
  request: Request,
  ...rest: unknown[]
) => Response | undefined | Promise<Response | undefined>;

const isHealthProbe = (request: Request): boolean =>
  request.method === "GET" && new URL(request.url).pathname === "/health";

export function withVersionedHealth(inner: FetchLike): FetchLike {
  return async (request, ...rest) => {
    const response = await inner(request, ...rest);
    if (
      !response ||
      !isHealthProbe(request) ||
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      return response;
    }

    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      return response;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    // a version answer must never be served stale from a cache
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify({ ...body, ...appVersionInfo() }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
