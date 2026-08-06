import { beforeEach, describe, expect, it } from "bun:test";
import { withRequestDiagnostics, pathOf } from "./request-log";
import { handleDiagnosticsRequest, DIAGNOSTICS_PATH } from "./endpoint";
import { opsLog, recentOpsEvents, resetOpsLogMemory } from "./ops-log";
import { counters, inflight, parseCgroupMemory } from "./runtime";

/**
 * Keep the tests off the filesystem — the ring buffer is what they assert on.
 */
process.env.OPS_LOG_FILE = "false";

const resetCounters = () => {
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) {
    counters[key] = 0;
  }
};

const requestEvents = () => recentOpsEvents().filter((e) => e.event === "request");

beforeEach(() => {
  resetOpsLogMemory();
  resetCounters();
  inflight.clear();
  delete process.env.OPS_LOG_ALL_REQUESTS;
  delete process.env.OPS_SLOW_REQUEST_MS;
  delete process.env.DIAGNOSTICS_TOKEN;
});

describe("withRequestDiagnostics", () => {
  it("tags the response with a request id and the boot id", async () => {
    const handler = withRequestDiagnostics(() => new Response("ok"));
    const response = await handler(new Request("http://x/api/v1/ping"));

    expect(response?.headers.get("x-request-id")).toMatch(/^r-/);
    expect(response?.headers.get("x-boot-id")).toBeTruthy();
  });

  it("keeps the request id the proxy sent, so both logs line up", async () => {
    const handler = withRequestDiagnostics(() => new Response("ok"));
    const response = await handler(
      new Request("http://x/api/v1/ping", { headers: { "x-request-id": "proxy-abc-123" } })
    );

    expect(response?.headers.get("x-request-id")).toBe("proxy-abc-123");
  });

  it("stays quiet for fast successful requests", async () => {
    const handler = withRequestDiagnostics(() => new Response("ok"));
    await handler(new Request("http://x/docs/assets/app-4f2a.js"));

    expect(requestEvents()).toEqual([]);
    expect(counters.requests).toBe(1);
    expect(counters.status2xx).toBe(1);
  });

  it("logs every request when OPS_LOG_ALL_REQUESTS is on", async () => {
    process.env.OPS_LOG_ALL_REQUESTS = "true";
    const handler = withRequestDiagnostics(() => new Response("ok"));
    await handler(new Request("http://x/login.html"));

    const [event] = requestEvents();
    expect(event).toMatchObject({ method: "GET", path: "/login.html", status: 200 });
  });

  it("logs server errors with the status and the path", async () => {
    const handler = withRequestDiagnostics(() => new Response("boom", { status: 500 }));
    await handler(new Request("http://x/api/v1/wiki/pages"));

    expect(requestEvents()[0]).toMatchObject({
      event: "request",
      status: 500,
      reason: "server-error",
      path: "/api/v1/wiki/pages",
    });
    expect(counters.status5xx).toBe(1);
  });

  it("logs a request that crossed the slow threshold", async () => {
    process.env.OPS_SLOW_REQUEST_MS = "1";
    const handler = withRequestDiagnostics(async () => {
      await Bun.sleep(5);
      return new Response("ok");
    });
    await handler(new Request("http://x/api/v1/search"));

    expect(requestEvents()[0]).toMatchObject({ reason: "slow", status: 200 });
    expect(counters.slow).toBe(1);
  });

  it("records and re-throws an error from the handler", async () => {
    const handler = withRequestDiagnostics(() => {
      throw new Error("database is gone");
    });

    await expect(handler(new Request("http://x/api/v1/wiki"))).rejects.toThrow("database is gone");

    const [event] = recentOpsEvents().filter((e) => e.event === "request-error");
    expect(event).toMatchObject({ path: "/api/v1/wiki" });
    expect((event?.error as { message: string }).message).toBe("database is gone");
    expect(counters.handlerErrors).toBe(1);
  });

  it("passes a WebSocket upgrade through without inventing a response", async () => {
    const handler = withRequestDiagnostics(() => undefined);
    const response = await handler(
      new Request("http://x/api/v1/protocol/realtime", {
        headers: { upgrade: "websocket" },
      })
    );

    expect(response).toBeUndefined();
    expect(requestEvents()).toEqual([]);
    expect(counters.websocketUpgrades).toBe(1);
  });

  it("flags a handler that returned nothing without an upgrade", async () => {
    const handler = withRequestDiagnostics(() => undefined);
    await handler(new Request("http://x/api/v1/wiki"));

    expect(requestEvents()[0]).toMatchObject({ reason: "no-response", status: null });
  });

  it("clears the in-flight entry on success and on failure", async () => {
    const ok = withRequestDiagnostics(() => new Response("ok"));
    await ok(new Request("http://x/a"));
    expect(inflight.size).toBe(0);

    const bad = withRequestDiagnostics(() => {
      throw new Error("nope");
    });
    await bad(new Request("http://x/b")).catch(() => {});
    expect(inflight.size).toBe(0);
  });

  it("keeps a request visible while it is running", async () => {
    let seen = 0;
    const handler = withRequestDiagnostics(() => {
      seen = inflight.size;
      return new Response("ok");
    });
    await handler(new Request("http://x/slow"));

    expect(seen).toBe(1);
  });

  it("survives a response whose headers cannot be modified", async () => {
    const handler = withRequestDiagnostics(() => Response.redirect("http://x/login.html", 302));
    const response = await handler(new Request("http://x/"));

    expect(response?.status).toBe(302);
  });
});

describe("pathOf", () => {
  it("drops the query string, which carries magic-link tokens", () => {
    expect(pathOf("http://x/magic-login-verify.html?token=super-secret")).toBe(
      "/magic-login-verify.html"
    );
  });

  it("falls back to the raw value for an unparsable url", () => {
    expect(pathOf("not a url")).toBe("not a url");
  });
});

describe("handleDiagnosticsRequest", () => {
  it("does not exist while DIAGNOSTICS_TOKEN is unset", async () => {
    expect(await handleDiagnosticsRequest(new Request(`http://x${DIAGNOSTICS_PATH}`))).toBeNull();
  });

  it("ignores every other path", async () => {
    process.env.DIAGNOSTICS_TOKEN = "s3cret";
    expect(await handleDiagnosticsRequest(new Request("http://x/api/v1/ping"))).toBeNull();
  });

  it("answers 404 — not 401 — without the right token", async () => {
    process.env.DIAGNOSTICS_TOKEN = "s3cret";
    const response = await handleDiagnosticsRequest(
      new Request(`http://x${DIAGNOSTICS_PATH}?token=wrong`)
    );
    expect(response?.status).toBe(404);
  });

  it("returns the snapshot for the token in the header", async () => {
    process.env.DIAGNOSTICS_TOKEN = "s3cret";
    opsLog({ event: "boot", boot: "test-boot" });

    const response = await handleDiagnosticsRequest(
      new Request(`http://x${DIAGNOSTICS_PATH}`, { headers: { "x-diagnostics-token": "s3cret" } })
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as Record<string, any>;
    expect(body.boot.id).toBeTruthy();
    expect(body.counters).toBeDefined();
    expect(body.events.at(-1)).toMatchObject({ event: "boot" });
  });

  it("accepts the token in the query string too", async () => {
    process.env.DIAGNOSTICS_TOKEN = "s3cret";
    const response = await handleDiagnosticsRequest(
      new Request(`http://x${DIAGNOSTICS_PATH}?token=s3cret`)
    );
    expect(response?.status).toBe(200);
  });
});

describe("parseCgroupMemory", () => {
  it("reads a cgroup v2 container with a limit and an OOM kill", () => {
    expect(
      parseCgroupMemory({
        v2: {
          max: "2147483648\n",
          current: "1073741824\n",
          events: "low 0\nhigh 0\nmax 12\noom 3\noom_kill 1\n",
        },
      })
    ).toEqual({
      source: "cgroup-v2",
      limitMb: 2048,
      usedMb: 1024,
      usedPercent: 50,
      oomKills: 1,
      limitHits: 12,
    });
  });

  it("treats the v2 literal 'max' as no limit", () => {
    const parsed = parseCgroupMemory({ v2: { max: "max\n", current: "1048576\n" } });
    expect(parsed).toMatchObject({ limitMb: null, usedPercent: null, usedMb: 1 });
  });

  it("reads a cgroup v1 container", () => {
    expect(
      parseCgroupMemory({
        v1: {
          limit: "4294967296\n",
          usage: "3221225472\n",
          failcnt: "7\n",
          oomControl: "oom_kill_disable 0\nunder_oom 0\noom_kill 2\n",
        },
      })
    ).toEqual({
      source: "cgroup-v1",
      limitMb: 4096,
      usedMb: 3072,
      usedPercent: 75,
      oomKills: 2,
      limitHits: 7,
    });
  });

  it("does not report the v1 'unlimited' sentinel as a real limit", () => {
    const parsed = parseCgroupMemory({
      v1: { limit: "9223372036854771712\n", usage: "1048576\n" },
    });
    expect(parsed).toMatchObject({ limitMb: null, usedPercent: null });
  });

  it("returns null when the process is not in a memory cgroup", () => {
    expect(parseCgroupMemory({})).toBeNull();
  });
});
