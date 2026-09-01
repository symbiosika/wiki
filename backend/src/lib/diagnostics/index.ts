/**
 * Operational diagnostics: everything needed to tell *where* an intermittent
 * "502 Bad Gateway" comes from — the reverse proxy, the container, or the app.
 *
 * The three parts answer three different questions, and none of them replaces
 * another:
 *
 *   - ./lifecycle  — was the process alive at that moment, and if it died,
 *                    who killed it (signal) or what killed it (crash)?
 *   - ./heartbeat  — was it *healthy* in the minutes before: memory against
 *                    the container limit, event loop lag, in-flight requests.
 *   - ./request-log— what happened to that specific request, correlated with
 *                    the proxy's log through X-Request-Id.
 *
 * Plus ./endpoint, which serves the current snapshot even while the database
 * is down and the application's own routes are therefore not registered.
 *
 * Wiring lives in src/index.ts; the runbook is docs/bad-gateway-debugging.md.
 *
 * Environment:
 *   OPS_LOG=false             turn the whole ops log off
 *   OPS_LOG_FILE=false        stdout only, do not write logs/ops.log
 *   OPS_HEARTBEAT_MS=30000    heartbeat interval, 0 disables
 *   OPS_SLOW_REQUEST_MS=3000  above this a request is logged as slow
 *   OPS_LOG_ALL_REQUESTS=true log every request, not just the notable ones
 *   DIAGNOSTICS_TOKEN=…       enables GET /internal/diagnostics
 */

import { handleDiagnosticsRequest } from "./endpoint";
import { startHeartbeat } from "./heartbeat";
import { installLifecycleLogging } from "./lifecycle";
import { withRequestDiagnostics } from "./request-log";

export { diagnosticsSnapshot, DIAGNOSTICS_PATH } from "./endpoint";
export { opsLog, flushOpsLog, recentOpsEvents } from "./ops-log";
export { BOOT_ID, counters } from "./runtime";

import type { FetchLike, InstrumentedFetch } from "./request-log";

/**
 * Start the background instrumentation. Idempotent, and safe to call before
 * anything else exists — it touches no database and no configuration.
 */
export const startDiagnostics = () => {
  installLifecycleLogging();
  startHeartbeat();
};

/**
 * Wrap the server's fetch handler: diagnostics endpoint first, then request
 * accounting around the application.
 */
export const withDiagnostics = (inner: FetchLike): InstrumentedFetch => {
  const instrumented = withRequestDiagnostics(inner);
  return async (request: Request, ...rest: unknown[]) => {
    const diagnostics = await handleDiagnosticsRequest(request);
    if (diagnostics) return diagnostics;
    return instrumented(request, ...rest);
  };
};
