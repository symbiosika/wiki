/**
 * GET /internal/diagnostics — the current state of this process, as JSON.
 *
 * Handled in front of Hono on purpose. The framework registers its routes only
 * after the database connection succeeds and the licence check passes (see
 * `defineServer`), so during exactly the situations worth diagnosing — DB
 * unreachable, boot hanging — every application route including
 * `/health/detail` answers 404. This one answers regardless, because it needs
 * nothing but the process itself.
 *
 * Access is a shared secret in DIAGNOSTICS_TOKEN, passed as
 * `X-Diagnostics-Token` or `?token=`. Without the variable set the path is not
 * treated as special at all and falls through to the normal 404 — an operator
 * tool should not announce its own existence to a scanner.
 */

import {
  opsLogConfig,
  recentOpsEvents,
  recentOpsHeartbeats,
} from "./ops-log";
import { heartbeatIntervalMs } from "./heartbeat";
import { slowRequestThresholdMs } from "./request-log";
import {
  BOOT_ID,
  BOOT_STARTED_AT,
  counters,
  inflight,
  longRunningRequests,
  processMemory,
  readContainerMemory,
  readLoadAverage,
  uptimeSeconds,
} from "./runtime";

export const DIAGNOSTICS_PATH = "/internal/diagnostics";

/** Length-independent comparison, so the token cannot be guessed by timing. */
const secretsMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isAuthorised = (request: Request, token: string): boolean => {
  const header = request.headers.get("x-diagnostics-token");
  if (header && secretsMatch(header, token)) return true;
  try {
    const query = new URL(request.url).searchParams.get("token");
    return query !== null && secretsMatch(query, token);
  } catch {
    return false;
  }
};

/**
 * Everything the diagnostics endpoint reports. Exported so a future admin UI
 * or a test can use the same snapshot without going through HTTP.
 */
export const diagnosticsSnapshot = async () => {
  const [containerMemory, loadavg] = await Promise.all([
    readContainerMemory(),
    readLoadAverage(),
  ]);

  return {
    boot: {
      id: BOOT_ID,
      startedAt: BOOT_STARTED_AT,
      uptimeS: uptimeSeconds(),
      pid: process.pid,
      runtime: `bun ${Bun.version}`,
    },
    config: {
      heartbeatMs: heartbeatIntervalMs(),
      slowRequestMs: slowRequestThresholdMs(),
      logAllRequests: process.env.OPS_LOG_ALL_REQUESTS === "true",
      ...opsLogConfig(),
    },
    memory: processMemory(),
    containerMemory,
    loadavg,
    counters: { ...counters },
    inflight: {
      count: inflight.size,
      requests: longRunningRequests(0, 20),
    },
    // Newest last, matching the order they were written to the log.
    events: recentOpsEvents(),
    heartbeats: recentOpsHeartbeats(),
  };
};

/**
 * Answer the diagnostics request, or return null when this is an ordinary
 * request that the application should handle.
 */
export const handleDiagnosticsRequest = async (
  request: Request
): Promise<Response | null> => {
  const token = process.env.DIAGNOSTICS_TOKEN;
  if (!token) return null;

  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  if (pathname !== DIAGNOSTICS_PATH) return null;

  if (!isAuthorised(request, token)) {
    // 404, not 401: an unauthenticated caller learns nothing about the path.
    return new Response("Not Found", { status: 404 });
  }

  const snapshot = await diagnosticsSnapshot();
  return new Response(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
