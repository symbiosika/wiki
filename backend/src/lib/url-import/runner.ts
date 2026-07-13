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
import { eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { urlToMarkdown } from "@framework/lib/knowledge/parsing/url";
import { upsertKnowledgeTextFromSource } from "@framework/lib/knowledge/knowledge-text-sync";
import { createJob } from "@framework/lib/jobs";
import log from "@framework/lib/log";
import {
  urlImportJobs,
  urlImportJobUrls,
  urlImportJobRuns,
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
      organisationId: ctx.organisationId,
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
    ctx.organisationId,
  );

  return run;
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

    for (const entry of urls) {
      try {
        const parsed = await urlToMarkdown(entry.url);
        const upsert = await upsertKnowledgeTextFromSource({
          tenantId: job.organisationId,
          sourceIdentifier: entry.url,
          matchScope: { urlImportJobId: job.id },
          title: entry.title || parsed.title || entry.url,
          text: parsed.markdown,
          userId: job.createdBy ?? undefined,
          teamId: job.teamId ?? undefined,
          tenantWide: job.tenantWide,
          parentId: job.parentId ?? undefined,
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
          organisationId: job.organisationId,
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
