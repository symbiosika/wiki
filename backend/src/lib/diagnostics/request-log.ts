/**
 * Per-request accounting, wrapped around the whole server.
 *
 * This sits outside Hono — in front of the router, the static mounts and the
 * framework's error boundary — because the requests that matter for a Bad
 * Gateway are exactly the ones that never reach a handler or never come back
 * from one. A Hono middleware only sees what Hono sees.
 *
 * What it produces is one correlation id per request, echoed in the response
 * as `X-Request-Id`, and a log line for anything that went wrong or took too
 * long. With the same id in the reverse proxy's access log (see
 * docs/bad-gateway-debugging.md for the nginx/Traefik/Caddy snippets), a 502
 * stops being a mystery and becomes one of three cases:
 *
 *   - proxy logged the id, app logged the id, app answered 200
 *       → the response was lost between app and proxy. Proxy or network.
 *   - proxy logged the id, app never logged it
 *       → the request never arrived. Connection refused, wrong port, DNS,
 *         or the app was down (check the boot/heartbeat events either side).
 *   - proxy logged the id, app logged it as slow/aborted/error
 *       → the app is the slow or failing party.
 *
 * Successful, fast requests are not logged. Logging every static asset would
 * bury exactly the lines this exists for; the heartbeat carries the totals.
 */

import { nanoid } from "nanoid";
import { opsLog } from "./ops-log";
import { BOOT_ID, counters, inflight } from "./runtime";

const DEFAULT_SLOW_MS = 3_000;

/** Bun's fetch handler may answer with nothing at all — a WebSocket upgrade. */
export type FetchLike = (
  request: Request,
  ...rest: unknown[]
) => Response | undefined | Promise<Response | undefined>;

/** The wrapper always awaits the inner handler, so it always returns a promise. */
export type InstrumentedFetch = (
  request: Request,
  ...rest: unknown[]
) => Promise<Response | undefined>;

export const slowRequestThresholdMs = (): number => {
  const parsed = Number(process.env.OPS_SLOW_REQUEST_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_MS;
};

/** OPS_LOG_ALL_REQUESTS=true turns this into a full access log. */
const logAllRequests = () => process.env.OPS_LOG_ALL_REQUESTS === "true";

/**
 * Path without the query string.
 *
 * Query strings here carry magic-link tokens, OAuth codes and search terms.
 * None of that belongs in an operations log that gets mailed around, and none
 * of it helps identify a gateway error.
 */
export const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * Client address as reported by the proxy.
 *
 * Its absence is itself a finding: if `X-Forwarded-For` never shows up, the
 * proxy is not configured to pass it, and everything the app logs about
 * clients is the proxy's own address.
 */
const clientIp = (request: Request): string | undefined => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? undefined;
};

const isUpgradeRequest = (request: Request): boolean =>
  (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";

const countStatus = (status: number) => {
  if (status >= 500) counters.status5xx++;
  else if (status >= 400) counters.status4xx++;
  else if (status >= 300) counters.status3xx++;
  else if (status >= 200) counters.status2xx++;
};

/**
 * Wrap a Bun fetch handler with request accounting.
 *
 * Errors are logged and re-thrown unchanged: this observes the server, it does
 * not change what it answers.
 */
export const withRequestDiagnostics = (inner: FetchLike): InstrumentedFetch => {
  return async (request: Request, ...rest: unknown[]) => {
    const slowMs = slowRequestThresholdMs();
    const requestId = request.headers.get("x-request-id")?.slice(0, 64) || `r-${nanoid(10)}`;
    const method = request.method;
    const path = pathOf(request.url);
    const startedMonotonic = performance.now();
    const upgrade = isUpgradeRequest(request);

    counters.requests++;
    inflight.set(requestId, {
      id: requestId,
      method,
      path,
      startedAt: new Date().toISOString(),
      startedMonotonic,
    });

    const base = () => ({
      boot: BOOT_ID,
      id: requestId,
      method,
      path,
      ms: Math.round(performance.now() - startedMonotonic),
      ip: clientIp(request),
    });

    try {
      const response = await inner(request, ...rest);
      // Time to the response *object*, i.e. to the headers — which is also
      // when the request leaves the in-flight list. For a streamed answer (AI
      // chat, SSE) the body keeps flowing afterwards and is not measured here;
      // for everything else, and for every request that hangs *before*
      // answering, this is the number a gateway timeout is compared against.
      const ms = Math.round(performance.now() - startedMonotonic);
      const aborted = request.signal?.aborted === true;

      if (aborted) counters.clientAborted++;
      if (ms >= slowMs) counters.slow++;

      if (!response) {
        // No response object: Bun took the socket over for a WebSocket.
        // Anything else that answers with nothing is worth a line, aborted or
        // not — a request the app silently dropped is what the proxy reports
        // as a bad gateway.
        if (upgrade) counters.websocketUpgrades++;
        if (logAllRequests() || !upgrade) {
          opsLog({
            event: "request",
            ...base(),
            status: null,
            reason: upgrade ? "websocket-upgrade" : "no-response",
            aborted,
          });
        }
        return response;
      }

      countStatus(response.status);

      // Echo the id so the proxy can log it against its own view of the
      // request. Response headers created by a handler are mutable, but a
      // frozen one must not take the request down with it.
      try {
        response.headers.set("x-request-id", requestId);
        response.headers.set("x-boot-id", BOOT_ID);
      } catch {
        // immutable response (redirect/error constructor) — nothing to do
      }

      const reason =
        response.status >= 500
          ? "server-error"
          : aborted
            ? "client-aborted"
            : ms >= slowMs
              ? "slow"
              : null;

      if (reason || logAllRequests()) {
        opsLog({
          event: "request",
          ...base(),
          ms,
          status: response.status,
          reason: reason ?? "all",
          aborted,
          bytes: response.headers.get("content-length") ?? undefined,
        });
      }

      return response;
    } catch (error) {
      counters.handlerErrors++;
      opsLog({
        event: "request-error",
        ...base(),
        aborted: request.signal?.aborted === true,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack?.split("\n").slice(0, 8).join("\n"),
              }
            : { message: String(error) },
      });
      throw error;
    } finally {
      inflight.delete(requestId);
    }
  };
};
