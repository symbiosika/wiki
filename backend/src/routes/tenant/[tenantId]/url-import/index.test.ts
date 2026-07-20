import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  createDatabaseClient,
  waitForDbConnection,
} from "@framework/lib/db/db-connection";
import defineUrlImportRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
let token: string;

const org = TEST_ORGANISATION_1.id;
const jobsPath = `/tenant/${org}/url-import/jobs`;

describe("URL import job routes", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    token = (await initTests()).user1Token;
    app = new Hono();
    defineUrlImportRoutes(app);
  });

  test("rejects an invalid cron expression", async () => {
    const res = await testFetcher.post(app, jobsPath, token, {
      name: "Bad cron",
      cron: "not a cron",
    });
    expect(res.status).toBe(400);
  });

  test("cross-tenant access is rejected", async () => {
    const res = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_2.id}/url-import/jobs`,
      token,
    );
    expect(res.status).toBe(403);
  });

  test("full CRUD + url management + manual run", async () => {
    // create
    const created = await testFetcher.post(app, jobsPath, token, {
      name: "News sync",
      cron: "0 6 * * *",
    });
    expect(created.status).toBe(200);
    const jobId = created.jsonResponse.id as string;
    expect(jobId).toBeTruthy();

    // list
    const list = await testFetcher.get(app, jobsPath, token);
    expect(list.status).toBe(200);
    expect(list.jsonResponse.some((j: any) => j.id === jobId)).toBe(true);

    // set urls
    const urlsRes = await testFetcher.put(
      app,
      `${jobsPath}/${jobId}/urls`,
      token,
      {
        urls: [
          { url: "https://example.com/a" },
          {
            url: "https://example.com/b",
            title: "B",
            subPath: ["Docs", "API Reference"],
          },
          { url: "https://example.com/a" }, // duplicate ignored
        ],
      },
    );
    expect(urlsRes.status).toBe(200);
    expect(urlsRes.jsonResponse.length).toBe(2);
    // subPath is persisted and round-tripped
    const rowB = urlsRes.jsonResponse.find(
      (u: any) => u.url === "https://example.com/b",
    );
    expect(rowB.subPath).toEqual(["Docs", "API Reference"]);
    const rowA = urlsRes.jsonResponse.find(
      (u: any) => u.url === "https://example.com/a",
    );
    expect(rowA.subPath).toEqual([]);

    // get job detail
    const detail = await testFetcher.get(app, `${jobsPath}/${jobId}`, token);
    expect(detail.status).toBe(200);
    expect(detail.jsonResponse.job.id).toBe(jobId);
    expect(detail.jsonResponse.urls.length).toBe(2);
    expect(Array.isArray(detail.jsonResponse.runs)).toBe(true);

    // update (disable + rename)
    const updated = await testFetcher.put(app, `${jobsPath}/${jobId}`, token, {
      name: "News sync (paused)",
      enabled: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.jsonResponse.enabled).toBe(false);
    expect(updated.jsonResponse.name).toBe("News sync (paused)");

    // manual run -> 202 + a run row
    const run = await testFetcher.post(
      app,
      `${jobsPath}/${jobId}/run`,
      token,
      {},
    );
    expect(run.status).toBe(202);
    expect(run.jsonResponse.status).toBe("running");
    const runId = run.jsonResponse.id as string;

    // run appears in history
    const runs = await testFetcher.get(app, `${jobsPath}/${jobId}/runs`, token);
    expect(runs.status).toBe(200);
    expect(runs.jsonResponse.some((r: any) => r.id === runId)).toBe(true);

    // run detail
    const runDetail = await testFetcher.get(
      app,
      `${jobsPath}/${jobId}/runs/${runId}`,
      token,
    );
    expect(runDetail.status).toBe(200);
    expect(runDetail.jsonResponse.id).toBe(runId);

    // delete
    const del = await testFetcher.delete(app, `${jobsPath}/${jobId}`, token);
    expect(del.status).toBe(200);
    const gone = await testFetcher.get(app, `${jobsPath}/${jobId}`, token);
    expect(gone.status).toBe(404);
  });
});
