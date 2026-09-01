/**
 * The ops log: one NDJSON line per operational event.
 *
 * This is deliberately *not* the framework logger (`@framework/index` → `log`).
 * That one is a human-readable application log; this one is a machine-readable
 * timeline of what happened to the *process* — boots, crashes, signals,
 * heartbeats, slow or failed requests. When a reverse proxy answers "502 Bad
 * Gateway", the question is never "what did the code print", it is "was the
 * process alive and answering at 12:03:11, and if so, what did it do with that
 * request". A separate, dense, greppable stream answers that; an application
 * log interleaved with route noise does not.
 *
 * Every event goes to stdout prefixed with `[ops]`, so `docker compose logs`
 * has it without any extra setup. In addition the line is appended to
 * `logs/ops.log` (rotated, bounded) unless OPS_LOG_FILE=false — a file survives
 * the container's log driver being reconfigured, and it is what you hand to
 * someone who is not allowed on the host.
 *
 * Writes are buffered and flushed on a timer: a request log line must never
 * put a synchronous disk write in the hot path. On shutdown the buffer is
 * flushed synchronously, because the interesting lines are exactly the ones
 * written just before the process disappears.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "ops.log");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5;
const FLUSH_INTERVAL_MS = 1000;
/** Hard cap on the buffer so a stuck disk cannot grow it without bound. */
const MAX_BUFFERED_LINES = 5_000;

/** Non-heartbeat events kept in memory for the diagnostics endpoint. */
const MAX_RECENT_EVENTS = 200;
/** Heartbeats kept separately so they cannot push the interesting events out. */
const MAX_RECENT_HEARTBEATS = 60;

export type OpsEvent = {
  /** Short machine name: "boot", "shutdown", "crash", "request", … */
  event: string;
  [key: string]: unknown;
};

type StoredEvent = OpsEvent & { ts: string };

// Read per call rather than captured at import time: this module is imported
// very early (before any dotenv-style loading a deployment may do), and tests
// need to flip the file sink off without controlling import order.
const isEnabled = () => process.env.OPS_LOG !== "false";
const isFileEnabled = () => isEnabled() && process.env.OPS_LOG_FILE !== "false";

let buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let logDirReady = false;
let recentEvents: StoredEvent[] = [];
let recentHeartbeats: StoredEvent[] = [];

/**
 * Record an operational event.
 *
 * Never throws and never awaits — callers are in signal handlers and request
 * paths where a failing logger must not become the incident.
 */
export const opsLog = (event: OpsEvent): void => {
  if (!isEnabled()) return;

  const stored: StoredEvent = { ts: new Date().toISOString(), ...event };
  remember(stored);

  let line: string;
  try {
    line = JSON.stringify(stored);
  } catch {
    // A value that cannot be serialised (a cycle, a BigInt) must not silence
    // the event — keep the name, drop the payload.
    line = JSON.stringify({ ts: stored.ts, event: stored.event, note: "unserialisable payload" });
  }

  console.log(`[ops] ${line}`);

  if (!isFileEnabled()) return;
  if (buffer.length >= MAX_BUFFERED_LINES) return;
  buffer.push(line);
  ensureFlushTimer();
};

const remember = (stored: StoredEvent) => {
  if (stored.event === "heartbeat") {
    recentHeartbeats.push(stored);
    if (recentHeartbeats.length > MAX_RECENT_HEARTBEATS) recentHeartbeats.shift();
    return;
  }
  recentEvents.push(stored);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
};

/** The in-memory tail, newest last. Used by the diagnostics endpoint. */
export const recentOpsEvents = (): StoredEvent[] => [...recentEvents];
export const recentOpsHeartbeats = (): StoredEvent[] => [...recentHeartbeats];

const ensureFlushTimer = () => {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushOpsLog();
  }, FLUSH_INTERVAL_MS);
  // The log writer must never be the reason the process stays alive.
  flushTimer.unref?.();
};

/**
 * Write everything buffered so far. Safe to call concurrently: the buffer is
 * swapped out first, so a second call cannot write the same lines twice.
 */
export const flushOpsLog = async (): Promise<void> => {
  if (!isFileEnabled() || buffer.length === 0) return;
  const lines = buffer;
  buffer = [];

  try {
    if (!logDirReady) {
      await fsp.mkdir(LOG_DIR, { recursive: true });
      logDirReady = true;
    }
    await rotateIfNeeded();
    await fsp.appendFile(LOG_FILE, lines.join("\n") + "\n");
  } catch (error) {
    // Losing the file copy is acceptable; stdout already has the events.
    console.error("[ops] failed to write ops.log:", error);
  }
};

/**
 * Flush without yielding. Only for shutdown paths — an `exit` handler cannot
 * await anything, and the last lines before a crash are the ones that matter.
 */
export const flushOpsLogSync = (): void => {
  if (!isFileEnabled() || buffer.length === 0) return;
  const lines = buffer;
  buffer = [];
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, lines.join("\n") + "\n");
  } catch {
    // Nothing sensible left to do while the process is on its way out.
  }
};

const rotateIfNeeded = async () => {
  let size: number;
  try {
    size = (await fsp.stat(LOG_FILE)).size;
  } catch {
    return; // no file yet
  }
  if (size <= MAX_FILE_BYTES) return;

  for (let i = MAX_FILES - 1; i > 0; i--) {
    try {
      await fsp.rename(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`);
    } catch {
      // missing intermediate file — fine
    }
  }
  try {
    await fsp.rename(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // raced with another rotation — the next append recreates the file
  }
};

/** Test seam: drop the in-memory tail. */
export const resetOpsLogMemory = () => {
  recentEvents = [];
  recentHeartbeats = [];
};

export const opsLogConfig = () => ({
  enabled: isEnabled(),
  fileEnabled: isFileEnabled(),
  file: isFileEnabled() ? LOG_FILE : null,
  maxFileBytes: MAX_FILE_BYTES,
  maxFiles: MAX_FILES,
});
