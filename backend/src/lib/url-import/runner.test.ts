/**
 * Runner integration test. Exercises the fault-tolerant execution directly
 * (no queue): a job with one reachable URL and one unreachable URL must import
 * the good one, record the bad one as an error, and finish "partial". A second
 * run must update the same page (upsert), not create a duplicate.
 *
 * Needs SSRF_ALLOW_PRIVATE_TARGETS=true so the local page server is reachable.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import {
  createDatabaseClient,
  waitForDbConnection,
  getDb,
} from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { createTeam } from "@framework/lib/usermanagement/teams";
import { urlImportJobUrls, urlImportJobRuns } from "../../db/schema";
import { createImportJob, setJobUrls, getJobRun } from "./index";
import { enqueueRun, executeJobRun } from "./runner";

let userId: string;
let server: ReturnType<typeof Bun.serve> | null = null;
const PORT = 7811;
const goodUrl = `http://127.0.0.1:${PORT}/page`;
const nulUrl = `http://127.0.0.1:${PORT}/nul`; // body carries a NUL byte
const badUrl = `http://127.0.0.1:59999/nope`; // nothing listening

beforeAll(async () => {
  await createDatabaseClient();
  await waitForDbConnection();
  await initTests();
  userId = TEST_ORG1_USER_1.id;
  server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    fetch: (req) => {
      // A page whose extracted text contains a NUL byte (as some OCR/PDF
      // sources produce) — Postgres cannot store it, so the runner must strip
      // it before persisting.
      if (new URL(req.url).pathname === "/nul") {
        return new Response(
          `<html><head><title>Nul${String.fromCharCode(0)}Title</title></head>` +
            `<body><article><h1>Heading</h1><p>Body with a ${String.fromCharCode(0)} nul byte inside.</p></article></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response(
        "<html><head><title>Doc Title</title></head><body><article><h1>Heading</h1><p>Imported body text.</p></article></body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
});

afterAll(() => {
  server?.stop(true);
});

describe("URL import runner", () => {
  test("imports good URLs, records failures, finishes partial", async () => {
    const ctx = { organisationId: TEST_ORGANISATION_1.id, userId };
    const job = await createImportJob(ctx, {
      name: "Test job",
      cron: "*/15 * * * *",
    });
    await setJobUrls(ctx, job.id, [{ url: goodUrl }, { url: badUrl }]);

    const run = await enqueueRun(ctx, job.id, "manual");
    expect(run).not.toBeNull();
    await executeJobRun(run!.id);

    const finished = await getJobRun(job.id, run!.id);
    expect(finished?.status).toBe("partial");
    expect(finished?.total).toBe(2);
    expect(finished?.succeeded).toBe(1);
    expect(finished?.failed).toBe(1);
    expect(finished?.finishedAt).toBeTruthy();

    // per-URL status persisted
    const urls = await getDb()
      .select()
      .from(urlImportJobUrls)
      .where(eq(urlImportJobUrls.jobId, job.id))
      .orderBy(urlImportJobUrls.sortOrder);
    const good = urls.find((u) => u.url === goodUrl)!;
    const bad = urls.find((u) => u.url === badUrl)!;
    expect(good.status).toBe("success");
    expect(good.knowledgeTextId).toBeTruthy();
    expect(bad.status).toBe("error");
    expect(bad.lastError).toBeTruthy();

    // the good URL produced exactly one page
    const pages = await getDb()
      .select()
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id),
          sql`jsonb_extract_path_text(${knowledgeText.meta}, 'sourceIdentifier') = ${goodUrl}`,
        ),
      );
    expect(pages.length).toBe(1);
    const pageId = pages[0]!.id;

    // second run upserts — same page id, still exactly one page
    const run2 = await enqueueRun(ctx, job.id, "manual");
    await executeJobRun(run2!.id);
    const pagesAfter = await getDb()
      .select()
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id),
          sql`jsonb_extract_path_text(${knowledgeText.meta}, 'sourceIdentifier') = ${goodUrl}`,
        ),
      );
    expect(pagesAfter.length).toBe(1);
    expect(pagesAfter[0]!.id).toBe(pageId);

    // both runs are recorded on the job
    const runs = await getDb()
      .select()
      .from(urlImportJobRuns)
      .where(eq(urlImportJobRuns.jobId, job.id));
    expect(runs.length).toBe(2);
  });

  test("team-scoped job imports even when the creator is not a team member", async () => {
    // A background job runs on behalf of the tenant, not the creator's live
    // session. A tenant owner may set up a team-scoped import without being a
    // member of that team, so the run must not fail the per-user team-role
    // check ("User has not the required role").
    const ctx = { organisationId: TEST_ORGANISATION_1.id, userId };
    const team = await createTeam({
      name: "Import target team",
      tenantId: TEST_ORGANISATION_1.id,
    });

    const job = await createImportJob(ctx, {
      name: "Team-scoped job",
      cron: "*/15 * * * *",
      teamId: team.id,
    });
    await setJobUrls(ctx, job.id, [{ url: goodUrl }]);

    const run = await enqueueRun(ctx, job.id, "manual");
    await executeJobRun(run!.id);

    const finished = await getJobRun(job.id, run!.id);
    expect(finished?.status).toBe("success");
    expect(finished?.succeeded).toBe(1);
    expect(finished?.failed).toBe(0);

    const urls = await getDb()
      .select()
      .from(urlImportJobUrls)
      .where(eq(urlImportJobUrls.jobId, job.id));
    expect(urls[0]!.status).toBe("success");
    expect(urls[0]!.lastError).toBeNull();
    expect(urls[0]!.knowledgeTextId).toBeTruthy();

    // the imported page is a team page (owned by the team, not a user)
    const pages = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, urls[0]!.knowledgeTextId!));
    expect(pages[0]!.teamId).toBe(team.id);
    expect(pages[0]!.userId).toBeNull();
  });

  test("imports a page whose content contains NUL bytes", async () => {
    // Postgres rejects NUL (U+0000) in text columns ("invalid byte sequence
    // for encoding UTF8: 0x00"); the runner must strip them so the insert does
    // not abort the whole page.
    const ctx = { organisationId: TEST_ORGANISATION_1.id, userId };
    const job = await createImportJob(ctx, {
      name: "Nul-byte job",
      cron: "*/15 * * * *",
    });
    await setJobUrls(ctx, job.id, [{ url: nulUrl }]);

    const run = await enqueueRun(ctx, job.id, "manual");
    await executeJobRun(run!.id);

    const finished = await getJobRun(job.id, run!.id);
    expect(finished?.status).toBe("success");
    expect(finished?.succeeded).toBe(1);

    const urls = await getDb()
      .select()
      .from(urlImportJobUrls)
      .where(eq(urlImportJobUrls.jobId, job.id));
    expect(urls[0]!.status).toBe("success");
    expect(urls[0]!.knowledgeTextId).toBeTruthy();

    const pages = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, urls[0]!.knowledgeTextId!));
    // the stored content is intact but carries no NUL byte
    expect(pages[0]!.text).not.toContain(String.fromCharCode(0));
    expect(pages[0]!.title).not.toContain(String.fromCharCode(0));
    expect(pages[0]!.text.length).toBeGreaterThan(0);
  });
});
