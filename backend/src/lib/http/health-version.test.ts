import { describe, test, expect, afterEach } from "bun:test";
import { withVersionedHealth } from "./health-version";
import { APP_VERSION } from "../../version";
import pkg from "../../../package.json";

const frameworkHealth = (request: Request) =>
  new URL(request.url).pathname === "/health"
    ? Response.json({ status: "ok" })
    : new Response("other", { status: 200 });

const fetchWith = withVersionedHealth(frameworkHealth);

afterEach(() => {
  delete process.env.APP_COMMIT;
  delete process.env.APP_BUILT_AT;
});

describe("withVersionedHealth", () => {
  test("the version is the one in backend/package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("/health keeps the framework's answer and adds the build", async () => {
    process.env.APP_COMMIT = "1ae96c13ddde01fd1a4f2464295be3daa14069ca";
    process.env.APP_BUILT_AT = "2026-09-29T08:09:27Z";
    const res = (await fetchWith(new Request("http://app.local/health")))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      version: APP_VERSION,
      commit: "1ae96c13ddde01fd1a4f2464295be3daa14069ca",
      builtAt: "2026-09-29T08:09:27Z",
    });
  });

  test("without CI build args only the version is reported", async () => {
    const res = (await fetchWith(new Request("http://app.local/health")))!;
    expect(await res.json()).toEqual({ status: "ok", version: APP_VERSION });
  });

  test("other paths and non-JSON or failed answers pass through untouched", async () => {
    const other = (await fetchWith(
      new Request("http://app.local/health/detail"),
    ))!;
    expect(await other.text()).toBe("other");

    const down = withVersionedHealth(() =>
      Response.json({ status: "down" }, { status: 503 }),
    );
    const res = (await down(new Request("http://app.local/health")))!;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "down" });

    const text = withVersionedHealth(() => new Response("ok"));
    const plain = (await text(new Request("http://app.local/health")))!;
    expect(await plain.text()).toBe("ok");
  });
});
