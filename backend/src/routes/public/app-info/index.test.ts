import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import defineAppInfoRoutes from "./index";

/**
 * Pure route test: the endpoint only reads the global server config, so it
 * needs neither a database nor an authenticated user.
 */
describe("Public app-info route", () => {
  const app: SymbiosikaFrameworkHonoApp = new Hono();
  const originalAppName = _GLOBAL_SERVER_CONFIG.appName;
  const originalLogoUrl = _GLOBAL_SERVER_CONFIG.logoUrl;

  beforeAll(() => {
    defineAppInfoRoutes(app, "/api/v1");
  });

  afterAll(() => {
    _GLOBAL_SERVER_CONFIG.appName = originalAppName;
    _GLOBAL_SERVER_CONFIG.logoUrl = originalLogoUrl;
  });

  test("returns the configured app name without authentication", async () => {
    _GLOBAL_SERVER_CONFIG.appName = "Test Wiki";
    _GLOBAL_SERVER_CONFIG.logoUrl = undefined;

    const response = await app.request("/api/v1/app-info");
    const data = (await response.json()) as {
      appName: string;
      logoUrl?: string;
    };

    expect(response.status).toBe(200);
    expect(data.appName).toBe("Test Wiki");
    expect(data.logoUrl).toBeUndefined();
  });

  test("includes the logo URL when one is configured", async () => {
    _GLOBAL_SERVER_CONFIG.appName = "Test Wiki";
    _GLOBAL_SERVER_CONFIG.logoUrl = "https://example.com/logo.png";

    const response = await app.request("/api/v1/app-info");
    const data = (await response.json()) as { logoUrl?: string };

    expect(response.status).toBe(200);
    expect(data.logoUrl).toBe("https://example.com/logo.png");
  });
});
