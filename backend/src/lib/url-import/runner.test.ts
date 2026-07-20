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
const badUrl = `http://127.0.0.1:59999/nope`; // nothing listening

beforeAll(async () => {
  await createDatabaseClient();
  await waitForDbConnection();
  await initTests();
  userId = TEST_ORG1_USER_1.id;
  server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(
        "<html><head><title>Doc Title</title></head><body><article><h1>Heading</h1><p>Imported body text.</p></article></body></html>",
        { headers: { "Content-Type": "text/html" } },
      ),
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

  test("files imports under an on-demand subpath and reuses shared ancestors", async () => {
    const ctx = { organisationId: TEST_ORGANISATION_1.id, userId };
    const job = await createImportJob(ctx, {
      name: "Categorized job",
      cron: "*/15 * * * *",
    });
    // two URLs under the same "Docs / API Reference" category — spaces in the
    // category name, and the category does not exist yet
    const urlA = `${goodUrl}?doc=a`;
    const urlB = `${goodUrl}?doc=b`;
    await setJobUrls(ctx, job.id, [
      { url: urlA, subPath: ["Docs", "API Reference"] },
      { url: urlB, subPath: ["Docs", "API Reference"] },
    ]);

    const run = await enqueueRun(ctx, job.id, "manual");
    await executeJobRun(run!.id);

    const finished = await getJobRun(job.id, run!.id);
    expect(finished?.status).toBe("success");
    expect(finished?.succeeded).toBe(2);

    // exactly one "Docs" and one "API Reference" page were created and shared
    const docs = await getDb()
      .select()
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id),
          eq(knowledgeText.title, "Docs"),
        ),
      );
    expect(docs.length).toBe(1);
    expect(docs[0]!.parentId).toBeNull(); // job has no parent → top level
    expect(docs[0]!.userId).toBe(userId); // personal-scope → owned by creator

    const apiRef = await getDb()
      .select()
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id),
          eq(knowledgeText.title, "API Reference"),
        ),
      );
    expect(apiRef.length).toBe(1);
    expect(apiRef[0]!.parentId).toBe(docs[0]!.id); // nested under "Docs"

    // both imported pages hang directly under "API Reference"
    const importedUrls = await getDb()
      .select()
      .from(urlImportJobUrls)
      .where(eq(urlImportJobUrls.jobId, job.id));
    expect(importedUrls.length).toBe(2);
    for (const u of importedUrls) {
      expect(u.status).toBe("success");
      const page = await getDb()
        .select()
        .from(knowledgeText)
        .where(eq(knowledgeText.id, u.knowledgeTextId!));
      expect(page[0]!.parentId).toBe(apiRef[0]!.id);
    }
  });
});
