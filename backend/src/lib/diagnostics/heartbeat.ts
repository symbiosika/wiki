/**
 * A line every 30 seconds, whether or not anything happened.
 *
 * Request logs only exist where there are requests, which makes them useless
 * for the two failure modes behind most intermittent Bad Gateways:
 *
 *   1. The process disappears. A gap in the heartbeat dates the outage to the
 *      second, and the boot id on the line after the gap says whether it came
 *      back as the same process (frozen) or a new one (restarted).
 *   2. The process stops answering while still running — event loop blocked by
 *      a synchronous parse, memory pressure, the container's limit in sight.
 *      `loopLagMs` and `containerMemory` show that building up in the minutes
 *      before the proxy gives up, which no per-request log can.
 *
 * Cost is one small JSON line per interval, so it can be left on permanently.
 */

import { opsLog } from "./ops-log";
import {
  BOOT_ID,
  counters,
  inflight,
  longRunningRequests,
  processMemory,
  readContainerMemory,
  readLoadAverage,
  uptimeSeconds,
} from "./runtime";

const DEFAULT_INTERVAL_MS = 30_000;
/** How often the event loop is probed; the max drift per interval is reported. */
const LAG_PROBE_MS = 500;
/** In-flight requests at least this old are named individually in the line. */
const LONG_REQUEST_MS = 10_000;

let started = false;
let maxLoopLagMs = 0;
let previousCounters = { ...counters };

export const heartbeatIntervalMs = (): number => {
  const raw = process.env.OPS_HEARTBEAT_MS;
  if (raw === undefined) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INTERVAL_MS;
};

/**
 * Event loop lag: how much later than scheduled a trivial timer actually ran.
 *
 * Anything above a few hundred milliseconds means the loop was busy with
 * synchronous work and could not accept or answer connections during that
 * time — which is what a proxy sees as an unresponsive upstream.
 */
const startLoopLagProbe = () => {
  let expected = performance.now() + LAG_PROBE_MS;
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    if (lag > maxLoopLagMs) maxLoopLagMs = Math.round(lag);
    expected = now + LAG_PROBE_MS;
  }, LAG_PROBE_MS);
  timer.unref?.();
};

/** Counter deltas since the previous heartbeat — the rate, not the total. */
const sinceLastBeat = () => {
  const delta = {
    requests: counters.requests - previousCounters.requests,
    status4xx: counters.status4xx - previousCounters.status4xx,
    status5xx: counters.status5xx - previousCounters.status5xx,
    handlerErrors: counters.handlerErrors - previousCounters.handlerErrors,
    clientAborted: counters.clientAborted - previousCounters.clientAborted,
    slow: counters.slow - previousCounters.slow,
  };
  previousCounters = { ...counters };
  return delta;
};

const beat = async () => {
  const lag = maxLoopLagMs;
  maxLoopLagMs = 0;

  const [containerMemory, loadavg] = await Promise.all([
    readContainerMemory(),
    readLoadAverage(),
  ]);

  const longRunning = longRunningRequests(LONG_REQUEST_MS);

  opsLog({
    event: "heartbeat",
    boot: BOOT_ID,
    uptimeS: uptimeSeconds(),
    loopLagMs: lag,
    memory: processMemory(),
    containerMemory,
    loadavg,
    inflight: inflight.size,
    ...(longRunning.length > 0 ? { longRunning } : {}),
    delta: sinceLastBeat(),
    total: { ...counters },
  });
};

export const startHeartbeat = () => {
  if (started) return;
  const interval = heartbeatIntervalMs();
  if (interval === 0) return;
  started = true;

  startLoopLagProbe();
  const timer = setInterval(() => {
    void beat();
  }, interval);
  timer.unref?.();
};
