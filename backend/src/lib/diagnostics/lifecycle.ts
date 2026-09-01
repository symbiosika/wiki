/**
 * Why the process started, and why it stopped.
 *
 * A reverse proxy answers 502 whenever it cannot get a response out of the
 * upstream — and the most common reason for that, by a wide margin, is that
 * the upstream was not running at that moment. With `restart: unless-stopped`
 * a crash-and-restart cycle takes a second or two and leaves no trace anyone
 * looks at: `docker ps` shows the container up, the app log shows a normal
 * start, and nobody can tell whether that start was the deploy from Tuesday or
 * one of forty restarts today.
 *
 * So the exits are recorded, with their cause:
 *
 *   - SIGTERM  → someone or something asked the process to stop: `docker
 *                restart`, a redeploy, the LXC container shutting down, or the
 *                host's OOM killer picking this process.
 *   - SIGINT / SIGHUP → interactive stop, terminal went away.
 *   - uncaughtException / unhandledRejection → the app killed itself. Bun
 *     exits with code 1 on both (verified against the runtime in use here), so
 *     a single stray rejection in a cron tick or a background job takes the
 *     whole server down and every request in the restart window becomes a 502.
 *     These two handlers exist to name that rejection instead of leaving a
 *     one-line stack trace in a stream nobody kept.
 *
 * The handlers preserve the previous behaviour exactly: log, flush, exit(1).
 * They make the failure visible, they do not make it survivable — swallowing a
 * crash would leave the process in a state nobody reasoned about.
 */

import { flushOpsLogSync, opsLog } from "./ops-log";
import {
  BOOT_ID,
  BOOT_STARTED_AT,
  counters,
  inflight,
  longRunningRequests,
  processMemory,
  uptimeSeconds,
} from "./runtime";

let installed = false;
/** Set once an exit path has run, so `exit` does not log a second summary. */
let exitLogged = false;

const errorPayload = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 12).join("\n"),
      cause:
        error.cause instanceof Error
          ? `${error.cause.name}: ${error.cause.message}`
          : error.cause !== undefined
            ? String(error.cause)
            : undefined,
    };
  }
  return { message: String(error) };
};

/**
 * The state worth capturing at the moment of death: what was still in flight
 * (a crash during a long request points somewhere very different from a crash
 * while idle) and how much memory the process held.
 */
const exitContext = () => ({
  uptimeS: uptimeSeconds(),
  memory: processMemory(),
  counters: { ...counters },
  inflight: inflight.size,
  inflightRequests: longRunningRequests(0, 10),
});

export const installLifecycleLogging = () => {
  if (installed) return;
  installed = true;

  opsLog({
    event: "boot",
    boot: BOOT_ID,
    startedAt: BOOT_STARTED_AT,
    pid: process.pid,
    runtime: `bun ${Bun.version}`,
    node: process.version,
    memory: processMemory(),
  });

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      exitLogged = true;
      opsLog({
        event: "shutdown",
        boot: BOOT_ID,
        reason: signal,
        ...exitContext(),
      });
      flushOpsLogSync();
      // Exit code by convention: 128 + signal number. Keeps `docker inspect`
      // and `docker events` readable about what ended the container.
      const code = signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
      process.exit(code);
    });
  }

  process.on("uncaughtException", (error) => {
    exitLogged = true;
    opsLog({
      event: "crash",
      boot: BOOT_ID,
      reason: "uncaughtException",
      error: errorPayload(error),
      ...exitContext(),
    });
    flushOpsLogSync();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    exitLogged = true;
    opsLog({
      event: "crash",
      boot: BOOT_ID,
      reason: "unhandledRejection",
      error: errorPayload(reason),
      ...exitContext(),
    });
    flushOpsLogSync();
    process.exit(1);
  });

  // Catches the exits nobody handled: an explicit process.exit() elsewhere, or
  // the event loop simply running dry. Without this line those look exactly
  // like a kill -9 in the log, which they are not.
  process.on("exit", (code) => {
    if (exitLogged) return;
    opsLog({
      event: "shutdown",
      boot: BOOT_ID,
      reason: "exit",
      code,
      ...exitContext(),
    });
    flushOpsLogSync();
  });
};

/** Test seam. */
export const __resetLifecycleForTests = () => {
  installed = false;
  exitLogged = false;
};
