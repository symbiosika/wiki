/**
 * Process identity, request counters and container memory — the state the
 * heartbeat and the diagnostics endpoint report on.
 *
 * The boot id is the single most useful field in the whole ops log: every
 * event carries it, so "did the process restart between 12:02 and 12:04" is a
 * question you answer by looking at one column instead of guessing from
 * timestamps. A reverse proxy's 502 during a restart window and a 502 from a
 * proxy that lost its upstream look identical from the outside; they look
 * nothing alike once the boot id is in both logs.
 */

import fsp from "fs/promises";
import { nanoid } from "nanoid";

/** Changes on every process start. Stable for the life of the process. */
export const BOOT_ID = nanoid(10);
export const BOOT_STARTED_AT = new Date().toISOString();
const bootMonotonic = performance.now();

export const uptimeSeconds = (): number =>
  Math.round((performance.now() - bootMonotonic) / 1000);

/**
 * Counters since boot. Deliberately plain numbers: the point is a cheap
 * snapshot in every heartbeat, not a metrics system.
 */
export const counters = {
  requests: 0,
  status2xx: 0,
  status3xx: 0,
  status4xx: 0,
  status5xx: 0,
  /** Handler threw before producing a response — the app's own fault. */
  handlerErrors: 0,
  /** Client (usually the reverse proxy) went away before we answered. */
  clientAborted: 0,
  /** Requests whose duration crossed the slow threshold. */
  slow: 0,
  websocketUpgrades: 0,
};

export type InflightRequest = {
  id: string;
  method: string;
  path: string;
  startedAt: string;
  startedMonotonic: number;
};

/** Requests currently being handled, keyed by request id. */
export const inflight = new Map<string, InflightRequest>();

/**
 * In-flight requests older than `olderThanMs`, newest first, capped.
 *
 * This is what turns "the proxy timed out" into an answer: if a gateway
 * timeout at 60s lines up with a request that has been in flight for 60s, the
 * app is the slow party. If nothing is in flight, it is not.
 */
export const longRunningRequests = (olderThanMs: number, limit = 5) => {
  const now = performance.now();
  return [...inflight.values()]
    .filter((r) => now - r.startedMonotonic >= olderThanMs)
    .sort((a, b) => a.startedMonotonic - b.startedMonotonic)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      method: r.method,
      path: r.path,
      startedAt: r.startedAt,
      ms: Math.round(now - r.startedMonotonic),
    }));
};

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

export const processMemory = () => {
  try {
    const m = process.memoryUsage();
    return {
      rssMb: mb(m.rss),
      heapUsedMb: mb(m.heapUsed),
      heapTotalMb: mb(m.heapTotal),
      externalMb: mb(m.external ?? 0),
    };
  } catch {
    return null;
  }
};

export type ContainerMemory = {
  source: "cgroup-v2" | "cgroup-v1";
  limitMb: number | null;
  usedMb: number | null;
  usedPercent: number | null;
  /** Times the kernel OOM-killed a process in this cgroup since boot. */
  oomKills: number | null;
  /** Times an allocation hit the limit (v1 `failcnt`, v2 `memory.events max`). */
  limitHits: number | null;
};

/**
 * Parse the raw cgroup files into one comparable shape.
 *
 * Split out from the reading so it can be tested without a container: the
 * formats differ between cgroup v1 and v2, and both appear in the wild — an
 * LXC container on an older Proxmox host is typically v1, a current one v2.
 */
export const parseCgroupMemory = (raw: {
  v2?: { max?: string; current?: string; events?: string };
  v1?: { limit?: string; usage?: string; failcnt?: string; oomControl?: string };
}): ContainerMemory | null => {
  if (raw.v2?.current !== undefined || raw.v2?.max !== undefined) {
    const max = (raw.v2.max ?? "").trim();
    // "max" means no limit; v2 uses the literal string, not a sentinel number.
    const limitBytes = max === "max" || max === "" ? null : Number(max);
    const usedBytes = raw.v2.current ? Number(raw.v2.current.trim()) : null;
    const events = parseKeyedLines(raw.v2.events ?? "");
    return {
      source: "cgroup-v2",
      limitMb: limitBytes !== null && Number.isFinite(limitBytes) ? mb(limitBytes) : null,
      usedMb: usedBytes !== null && Number.isFinite(usedBytes) ? mb(usedBytes) : null,
      usedPercent: percent(usedBytes, limitBytes),
      oomKills: events.oom_kill ?? null,
      limitHits: events.max ?? null,
    };
  }

  if (raw.v1?.usage !== undefined || raw.v1?.limit !== undefined) {
    const limitBytes = raw.v1.limit ? Number(raw.v1.limit.trim()) : null;
    const usedBytes = raw.v1.usage ? Number(raw.v1.usage.trim()) : null;
    const oomControl = parseKeyedLines(raw.v1.oomControl ?? "");
    // v1 reports "no limit" as a number close to 2^63; anything above a
    // petabyte is the sentinel, not a real limit somebody configured.
    const unlimited = limitBytes !== null && limitBytes > 1024 ** 5;
    const effectiveLimit = unlimited ? null : limitBytes;
    return {
      source: "cgroup-v1",
      limitMb:
        effectiveLimit !== null && Number.isFinite(effectiveLimit) ? mb(effectiveLimit) : null,
      usedMb: usedBytes !== null && Number.isFinite(usedBytes) ? mb(usedBytes) : null,
      usedPercent: percent(usedBytes, effectiveLimit),
      oomKills: oomControl.oom_kill ?? null,
      limitHits: raw.v1.failcnt ? Number(raw.v1.failcnt.trim()) : null,
    };
  }

  return null;
};

const percent = (used: number | null, limit: number | null): number | null => {
  if (used === null || limit === null || !Number.isFinite(used) || !Number.isFinite(limit)) {
    return null;
  }
  if (limit <= 0) return null;
  return Math.round((used / limit) * 1000) / 10;
};

/** `key value` per line, as used by memory.events and memory.oom_control. */
const parseKeyedLines = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const [key, value] = line.trim().split(/\s+/);
    if (!key || value === undefined) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
};

const readIfPresent = async (file: string): Promise<string | undefined> => {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return undefined;
  }
};

/**
 * Memory as the *container* sees it, not as the process reports it.
 *
 * `process.memoryUsage()` cannot tell you that the container is at 97 % of its
 * limit, and it cannot tell you that the kernel already killed something. Both
 * facts decide whether "Bad Gateway" is an app bug or a too-small container.
 */
export const readContainerMemory = async (): Promise<ContainerMemory | null> => {
  const [max, current, events] = await Promise.all([
    readIfPresent("/sys/fs/cgroup/memory.max"),
    readIfPresent("/sys/fs/cgroup/memory.current"),
    readIfPresent("/sys/fs/cgroup/memory.events"),
  ]);
  if (current !== undefined || max !== undefined) {
    return parseCgroupMemory({ v2: { max, current, events } });
  }

  const [limit, usage, failcnt, oomControl] = await Promise.all([
    readIfPresent("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    readIfPresent("/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    readIfPresent("/sys/fs/cgroup/memory/memory.failcnt"),
    readIfPresent("/sys/fs/cgroup/memory/memory.oom_control"),
  ]);
  if (usage !== undefined || limit !== undefined) {
    return parseCgroupMemory({ v1: { limit, usage, failcnt, oomControl } });
  }

  return null;
};

/** First three fields of /proc/loadavg — on LXC these are the container's. */
export const readLoadAverage = async (): Promise<number[] | null> => {
  const raw = await readIfPresent("/proc/loadavg");
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).slice(0, 3).map(Number);
  return parts.every((n) => Number.isFinite(n)) ? parts : null;
};
