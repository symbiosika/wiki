/**
 * URL batch-import execution.
 *
 * Runs are executed on the framework's durable job queue (so they survive a
 * restart and never block the request that triggered them). Each run walks the
 * job's URL list; every URL is imported independently and its outcome stored,
 * so one failing document never aborts the rest ("fehlersichere Ausführung").
 *
 * Per URL: fetch + convert to markdown (framework, SSRF-guarded) → upsert a
 * wiki page keyed by the URL and scoped to the job. Upsert keeps the page id
 * stable across runs, so a recurring job updates pages in place instead of
 * creating duplicates.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { urlToMarkdown } from "@framework/lib/knowledge/parsing/url";
import { KNOWLEDGE_FILES_BUCKET } from "@framework/lib/knowledge/knowledge-text-files";
import { upsertKnowledgeTextFromSource } from "@framework/lib/knowledge/knowledge-text-sync";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createJob } from "@framework/lib/jobs";
import log from "@framework/lib/log";
import {
  urlImportJobs,
  urlImportJobUrls,
  urlImportJobRuns,
  type UrlImportJobSelect,
  type UrlImportJobRunSelect,
  type UrlImportRunResultItem,
} from "../../db/schema";
import { cronMatches } from "./cron";
import { getImportJob, listJobUrls, type JobContext } from "./index";

/** Framework job-queue type for an async import run. */
export const URL_IMPORT_JOB_TYPE = "url-import-run";

const nowIso = () => new Date().toISOString();

/** In-process guard so a run is never executed twice concurrently. */
const executing = new Set<string>();

/**
 * Create a run row and enqueue its async execution. Returns the run row.
 * If a run for this job is already in progress, that run is returned instead
 * (no duplicate run is started).
 */
export const enqueueRun = async (
  ctx: JobContext,
  jobId: string,
  trigger: "manual" | "scheduled",
): Promise<UrlImportJobRunSelect | null> => {
  const db = getDb();
  const job = await getImportJob(ctx, jobId);
  if (!job) return null;

  const active = await db
    .select()
    .from(urlImportJobRuns)
    .where(eq(urlImportJobRuns.jobId, jobId))
    .orderBy(urlImportJobRuns.startedAt);
  const running = active.find((r) => r.status === "running");
  if (running) return running;

  const urls = await listJobUrls(jobId);
  const runRows = await db
    .insert(urlImportJobRuns)
    .values({
      jobId,
      tenantId: ctx.tenantId,
      trigger,
      status: "running",
      total: urls.length,
      startedBy: ctx.userId ?? null,
    })
    .returning();
  const run = runRows[0]!;

  // durable, async: the queue worker picks this up (survives restarts)
  await createJob(
    URL_IMPORT_JOB_TYPE,
    { runId: run.id, jobId },
    ctx.tenantId,
  );

  return run;
};

/**
 * Resolve (find-or-create) a chain of wiki "category" pages under a starting
 * parent, following `segments` (top→bottom page titles). Returns the id of the
 * deepest page, or `startParentId` when there are no segments.
 *
 * Every lookup and insert is scoped exactly like the job's imported pages
 * (same team / tenant-wide / owner), so a category page is matched by its
 * title *within the job's own bucket* — never one that merely shares the title
 * in another team or another user's space — and created there if missing.
 * Titles are matched verbatim, so spaces are fine.
 *
 * `cache` is shared across a whole run so URLs that share ancestors reuse the
 * same pages (no duplicates, no per-URL re-query) — the key encodes the parent
 * so identical titles under different parents stay distinct.
 */
const resolveWikiPath = async (
  job: UrlImportJobSelect,
  ownerUserId: string | undefined,
  segments: string[],
  cache: Map<string, string>,
): Promise<string | null> => {
  const db = getDb();
  let parentId: string | null = job.parentId ?? null;

  for (const rawSegment of segments) {
    const title = rawSegment.trim();
    if (!title) continue; // defensive: empty segments carry no level

    const cacheKey = `${parentId ?? "root"}\n${title}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      parentId = cached;
      continue;
    }

    const existing = await db
      .select({ id: knowledgeText.id })
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.tenantId, job.tenantId),
          eq(knowledgeText.title, title),
          parentId
            ? eq(knowledgeText.parentId, parentId)
            : isNull(knowledgeText.parentId),
          job.teamId
            ? eq(knowledgeText.teamId, job.teamId)
            : isNull(knowledgeText.teamId),
          eq(knowledgeText.tenantWide, job.tenantWide),
          ownerUserId
            ? eq(knowledgeText.userId, ownerUserId)
            : isNull(knowledgeText.userId),
        ),
      )
      .limit(1);

    let id = existing[0]?.id;
    if (!id) {
      const page = await createKnowledgeText({
        tenantId: job.tenantId,
        userId: ownerUserId,
        createdBy: job.createdBy ?? undefined,
        teamId: job.teamId ?? undefined,
        tenantWide: job.tenantWide,
        parentId: parentId ?? undefined,
        title,
        text: "",
      });
      id = page.id;
    }

    cache.set(cacheKey, id);
    parentId = id;
  }

  return parentId;
};

/**
 * Execute a run to completion. Safe to call directly (tests) or from the job
 * queue handler. Idempotent-guarded against concurrent double execution.
 */
export const executeJobRun = async (runId: string): Promise<void> => {
  if (executing.has(runId)) return;
  executing.add(runId);
  const db = getDb();
  try {
    const runRows = await db
      .select()
      .from(urlImportJobRuns)
      .where(eq(urlImportJobRuns.id, runId))
      .limit(1);
    const run = runRows[0];
    if (!run) return;
    if (run.status !== "running") return; // already finished

    const jobRows = await db
      .select()
      .from(urlImportJobs)
      .where(eq(urlImportJobs.id, run.jobId))
      .limit(1);
    const job = jobRows[0];
    if (!job) {
      await finishRun(runId, "error", [], "Job no longer exists");
      return;
    }

    const urls = await listJobUrls(run.jobId);
    const results: UrlImportRunResultItem[] = [];
    let succeeded = 0;
    let failed = 0;

    // A run executes in the background on behalf of the tenant, not in a live
    // user session. For team- or organisation-scoped jobs the imported page
    // belongs to that team/tenant, so we write it as a service operation
    // (userId omitted). Otherwise createKnowledgeText's per-user role check
    // would abort the run with "User has not the required role" whenever the
    // job's creator is not (or no longer) a member of the target team — a
    // scheduled import must not depend on the creator's live membership.
    // Personal-scoped jobs (no team, not tenant-wide) keep the creator as the
    // page owner so the imported page stays visible to them.
    const isSharedScope = job.tenantWide || !!job.teamId;
    const ownerUserId = isSharedScope ? undefined : job.createdBy ?? undefined;

    // shared across the whole run so URLs under the same category reuse the
    // same (created-once) category pages instead of racing to duplicate them
    const pathCache = new Map<string, string>();

    for (const entry of urls) {
      try {
        // File this URL under its per-line subpath (created on demand),
        // falling back to the job parent when the line has no subpath.
        const parentId = await resolveWikiPath(
          job,
          ownerUserId,
          entry.subPath ?? [],
          pathCache,
        );

        // Pass the tenant context so non-HTML downloads (PDFs) can be routed
        // through the tenant-scoped PDF parser instead of being rejected.
        // The images such a PDF yields belong to the page this import creates,
        // so they go into the page image bucket rather than the parser's own —
        // that is where the page's file bookkeeping and the page-scoped image
        // endpoints (MCP clients without `files:read`) can reach them.
        const parsed = await urlToMarkdown(entry.url, {
          parseContext: {
            tenantId: job.tenantId,
            userId: job.createdBy ?? undefined,
            teamId: job.teamId ?? undefined,
          },
          imageBucket: KNOWLEDGE_FILES_BUCKET,
        });
        const upsert = await upsertKnowledgeTextFromSource({
          tenantId: job.tenantId,
          sourceIdentifier: entry.url,
          matchScope: { urlImportJobId: job.id },
          title: entry.title || parsed.title || entry.url,
          text: parsed.markdown,
          userId: ownerUserId,
          teamId: job.teamId ?? undefined,
          tenantWide: job.tenantWide,
          parentId: parentId ?? undefined,
          meta: { sourceUri: entry.url },
        });

        await db
          .update(urlImportJobUrls)
          .set({
            status: "success",
            lastError: null,
            lastImportedAt: nowIso(),
            knowledgeTextId: upsert.id,
            updatedAt: nowIso(),
          })
          .where(eq(urlImportJobUrls.id, entry.id));

        results.push({
          urlId: entry.id,
          url: entry.url,
          status: "success",
          knowledgeTextId: upsert.id,
          changed: upsert.changed,
        });
        succeeded++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(urlImportJobUrls)
          .set({
            status: "error",
            lastError: message,
            updatedAt: nowIso(),
          })
          .where(eq(urlImportJobUrls.id, entry.id));

        results.push({
          urlId: entry.id,
          url: entry.url,
          status: "error",
          error: message,
        });
        failed++;
      }

      // persist progress incrementally so the UI can watch a long run
      await db
        .update(urlImportJobRuns)
        .set({ results, succeeded, failed })
        .where(eq(urlImportJobRuns.id, runId));
    }

    const status =
      failed === 0 ? "success" : succeeded > 0 ? "partial" : "error";
    await finishRun(runId, status, results, null, { succeeded, failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`URL import run ${runId} failed: ${message}`);
    await finishRun(runId, "error", [], message).catch(() => {});
  } finally {
    executing.delete(runId);
  }
};

/** Write the terminal state of a run and stamp it onto its job. */
const finishRun = async (
  runId: string,
  status: "success" | "partial" | "error",
  results: UrlImportRunResultItem[],
  error: string | null,
  counts?: { succeeded: number; failed: number },
): Promise<void> => {
  const db = getDb();
  const finishedAt = nowIso();
  const set: Record<string, unknown> = { status, finishedAt, error };
  if (results.length > 0) set.results = results;
  if (counts) {
    set.succeeded = counts.succeeded;
    set.failed = counts.failed;
  }
  const rows = await db
    .update(urlImportJobRuns)
    .set(set)
    .where(eq(urlImportJobRuns.id, runId))
    .returning();
  const run = rows[0];
  if (run) {
    await db
      .update(urlImportJobs)
      .set({
        lastRunId: runId,
        lastRunAt: finishedAt,
        lastRunStatus: status,
        updatedAt: finishedAt,
      })
      .where(eq(urlImportJobs.id, run.jobId));
  }
};

/** Framework job-queue handler. */
export const urlImportJobHandler = {
  type: URL_IMPORT_JOB_TYPE,
  handler: {
    execute: async (metadata: { runId?: string }) => {
      if (metadata?.runId) await executeJobRun(metadata.runId);
    },
  },
};

/**
 * Master tick — run every minute by a single cron. Finds every enabled job
 * whose schedule matches the current minute and has no run in flight, and
 * enqueues a scheduled run for it.
 */
export const tickScheduler = async (now: Date = new Date()): Promise<void> => {
  const db = getDb();
  const enabled = await db
    .select()
    .from(urlImportJobs)
    .where(eq(urlImportJobs.enabled, true));
  if (enabled.length === 0) return;

  const runningRows = await db
    .select({ jobId: urlImportJobRuns.jobId })
    .from(urlImportJobRuns)
    .where(eq(urlImportJobRuns.status, "running"));
  const runningJobs = new Set(runningRows.map((r) => r.jobId));

  for (const job of enabled) {
    if (runningJobs.has(job.id)) continue;
    if (!cronMatches(job.cron, now)) continue;
    try {
      await enqueueRun(
        {
          tenantId: job.tenantId,
          userId: job.createdBy ?? undefined,
        },
        job.id,
        "scheduled",
      );
    } catch (error) {
      log.error(
        `Failed to enqueue scheduled URL import job ${job.id}: ${error}`,
      );
    }
  }
};
