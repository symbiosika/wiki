/**
 * URL batch-import jobs — business logic.
 *
 * A job owns a list of URLs and a cron schedule. Runs (scheduled or manual)
 * fetch every URL, convert it to markdown and upsert it as a wiki page keyed
 * by the URL (see runner.ts). This module is the CRUD layer; runner.ts is the
 * execution layer.
 *
 * Everything is scoped by `organisationId` (== tenantId) so one tenant can
 * never read or mutate another tenant's jobs.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import {
  urlImportJobs,
  urlImportJobUrls,
  urlImportJobRuns,
  type UrlImportJobSelect,
  type UrlImportJobUrlSelect,
  type UrlImportJobRunSelect,
} from "../../db/schema";
import { assertValidCron } from "./cron";

export interface JobContext {
  organisationId: string;
  userId?: string;
}

const nowIso = () => new Date().toISOString();

// ---- jobs -------------------------------------------------------------------

export interface CreateJobInput {
  name: string;
  cron: string;
  enabled?: boolean;
  teamId?: string | null;
  tenantWide?: boolean;
  parentId?: string | null;
}

export const createImportJob = async (
  ctx: JobContext,
  input: CreateJobInput,
): Promise<UrlImportJobSelect> => {
  assertValidCron(input.cron);
  const rows = await getDb()
    .insert(urlImportJobs)
    .values({
      organisationId: ctx.organisationId,
      name: input.name,
      cron: input.cron,
      enabled: input.enabled ?? true,
      teamId: input.teamId ?? null,
      tenantWide: input.tenantWide ?? false,
      parentId: input.parentId ?? null,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  return rows[0]!;
};

export const listImportJobs = async (
  ctx: JobContext,
): Promise<UrlImportJobSelect[]> =>
  getDb()
    .select()
    .from(urlImportJobs)
    .where(eq(urlImportJobs.organisationId, ctx.organisationId))
    .orderBy(desc(urlImportJobs.createdAt));

export const getImportJob = async (
  ctx: JobContext,
  jobId: string,
): Promise<UrlImportJobSelect | null> => {
  const rows = await getDb()
    .select()
    .from(urlImportJobs)
    .where(
      and(
        eq(urlImportJobs.id, jobId),
        eq(urlImportJobs.organisationId, ctx.organisationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

export interface UpdateJobInput {
  name?: string;
  cron?: string;
  enabled?: boolean;
  teamId?: string | null;
  tenantWide?: boolean;
  parentId?: string | null;
}

export const updateImportJob = async (
  ctx: JobContext,
  jobId: string,
  input: UpdateJobInput,
): Promise<UrlImportJobSelect | null> => {
  if (input.cron !== undefined) assertValidCron(input.cron);
  const existing = await getImportJob(ctx, jobId);
  if (!existing) return null;
  const rows = await getDb()
    .update(urlImportJobs)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.cron !== undefined && { cron: input.cron }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.teamId !== undefined && { teamId: input.teamId }),
      ...(input.tenantWide !== undefined && { tenantWide: input.tenantWide }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
      updatedAt: nowIso(),
    })
    .where(eq(urlImportJobs.id, jobId))
    .returning();
  return rows[0] ?? null;
};

export const deleteImportJob = async (
  ctx: JobContext,
  jobId: string,
): Promise<boolean> => {
  const existing = await getImportJob(ctx, jobId);
  if (!existing) return false;
  // urls + runs cascade via FK
  await getDb().delete(urlImportJobs).where(eq(urlImportJobs.id, jobId));
  return true;
};

// ---- urls -------------------------------------------------------------------

export const listJobUrls = async (
  jobId: string,
): Promise<UrlImportJobUrlSelect[]> =>
  getDb()
    .select()
    .from(urlImportJobUrls)
    .where(eq(urlImportJobUrls.jobId, jobId))
    .orderBy(urlImportJobUrls.sortOrder, urlImportJobUrls.createdAt);

export interface JobUrlInput {
  url: string;
  title?: string | null;
  /**
   * Optional wiki subpath the imported page is filed under, relative to the
   * job's parent. Each entry is one level's page title (top→bottom); an empty
   * or omitted list files the page directly under the job parent.
   */
  subPath?: string[] | null;
}

/** Trim + drop empty segments so a stray "A//B" or trailing "/" is harmless. */
const normalizeSubPath = (subPath?: string[] | null): string[] =>
  (subPath ?? []).map((segment) => segment.trim()).filter(Boolean);

/**
 * Replace a job's URL list with the given set. Rows for URLs that stay are
 * kept (so their import status/history survives an edit); new URLs are added
 * and removed URLs deleted. Order follows the input list.
 */
export const setJobUrls = async (
  ctx: JobContext,
  jobId: string,
  urls: JobUrlInput[],
): Promise<UrlImportJobUrlSelect[]> => {
  const db = getDb();

  // dedupe by url, keep first occurrence, keep input order (one page per URL,
  // so the URL is the identity — its first-seen title/subpath wins)
  const deduped: { url: string; title: string | null; subPath: string[] }[] =
    [];
  const seenInput = new Set<string>();
  for (const entry of urls) {
    const url = entry.url.trim();
    if (!url || seenInput.has(url)) continue;
    seenInput.add(url);
    deduped.push({
      url,
      title: entry.title?.trim() || null,
      subPath: normalizeSubPath(entry.subPath),
    });
  }

  const existing = await listJobUrls(jobId);
  const existingByUrl = new Map(existing.map((row) => [row.url, row]));

  for (let i = 0; i < deduped.length; i++) {
    const entry = deduped[i]!;
    const current = existingByUrl.get(entry.url);
    if (current) {
      await db
        .update(urlImportJobUrls)
        .set({
          title: entry.title ?? null,
          subPath: entry.subPath,
          sortOrder: i,
          updatedAt: nowIso(),
        })
        .where(eq(urlImportJobUrls.id, current.id));
    } else {
      await db.insert(urlImportJobUrls).values({
        jobId,
        organisationId: ctx.organisationId,
        url: entry.url,
        title: entry.title ?? null,
        subPath: entry.subPath,
        sortOrder: i,
      });
    }
  }

  const removed = existing.filter((row) => !seenInput.has(row.url));
  if (removed.length > 0) {
    await db.delete(urlImportJobUrls).where(
      inArray(
        urlImportJobUrls.id,
        removed.map((row) => row.id),
      ),
    );
  }

  return listJobUrls(jobId);
};

// ---- runs -------------------------------------------------------------------

export const listJobRuns = async (
  jobId: string,
  limit = 20,
): Promise<UrlImportJobRunSelect[]> =>
  getDb()
    .select()
    .from(urlImportJobRuns)
    .where(eq(urlImportJobRuns.jobId, jobId))
    .orderBy(desc(urlImportJobRuns.startedAt))
    .limit(limit);

export const getJobRun = async (
  jobId: string,
  runId: string,
): Promise<UrlImportJobRunSelect | null> => {
  const rows = await getDb()
    .select()
    .from(urlImportJobRuns)
    .where(
      and(eq(urlImportJobRuns.id, runId), eq(urlImportJobRuns.jobId, jobId)),
    )
    .limit(1);
  return rows[0] ?? null;
};
