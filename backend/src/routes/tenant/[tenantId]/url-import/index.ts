/**
 * URL batch-import job routes.
 *
 *   GET    /url-import/jobs                    list jobs
 *   POST   /url-import/jobs                    create job
 *   GET    /url-import/jobs/:jobId             job + urls + recent runs
 *   PUT    /url-import/jobs/:jobId             update job
 *   DELETE /url-import/jobs/:jobId             delete job (cascades urls/runs)
 *   PUT    /url-import/jobs/:jobId/urls        replace the URL list
 *   GET    /url-import/jobs/:jobId/runs        run history
 *   GET    /url-import/jobs/:jobId/runs/:runId run detail (per-URL results)
 *   POST   /url-import/jobs/:jobId/run         start a run now (async)
 *
 * All routes are authenticated and tenant-scoped (isTenantMember). Every job
 * operation is additionally scoped by organisationId in the lib layer, so a
 * member of tenant A can never touch tenant B's jobs.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  createImportJob,
  listImportJobs,
  getImportJob,
  updateImportJob,
  deleteImportJob,
  listJobUrls,
  setJobUrls,
  listJobRuns,
  getJobRun,
} from "../../../../lib/url-import";
import { enqueueRun } from "../../../../lib/url-import/runner";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });
const jobParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  jobId: v.pipe(v.string(), v.uuid()),
});
const runParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  jobId: v.pipe(v.string(), v.uuid()),
  runId: v.pipe(v.string(), v.uuid()),
});

const nullableUuid = v.nullable(v.pipe(v.string(), v.uuid()));

const createJobBody = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  cron: v.pipe(v.string(), v.minLength(1)),
  enabled: v.optional(v.boolean()),
  teamId: v.optional(nullableUuid),
  tenantWide: v.optional(v.boolean()),
  parentId: v.optional(nullableUuid),
});

const updateJobBody = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1))),
  cron: v.optional(v.pipe(v.string(), v.minLength(1))),
  enabled: v.optional(v.boolean()),
  teamId: v.optional(nullableUuid),
  tenantWide: v.optional(v.boolean()),
  parentId: v.optional(nullableUuid),
});

const urlsBody = v.object({
  urls: v.array(
    v.object({
      url: v.pipe(v.string(), v.url()),
      title: v.optional(v.nullable(v.string())),
    }),
  ),
});

const ok = { 200: { description: "Successful response" } };

export default function defineUrlImportRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/url-import`;

  // list jobs ----------------------------------------------------------------
  app.get(
    `${base}/jobs`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "List URL import jobs",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const jobs = await listImportJobs({ organisationId: tenantId });
      return c.json(jobs);
    },
  );

  // create job ---------------------------------------------------------------
  app.post(
    `${base}/jobs`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Create a URL import job",
      responses: ok,
    }),
    validator("param", tenantParam),
    validator("json", createJobBody),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const job = await createImportJob(
          { organisationId: tenantId, userId: c.get("usersId") },
          body,
        );
        return c.json(job);
      } catch (e) {
        throw new HTTPException(400, { message: e + "" });
      }
    },
  );

  // get job (with urls + recent runs) ---------------------------------------
  app.get(
    `${base}/jobs/:jobId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Get a job with its URLs and recent runs",
      responses: ok,
    }),
    validator("param", jobParam),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId } = c.req.valid("param");
      const job = await getImportJob({ organisationId: tenantId }, jobId);
      if (!job) throw new HTTPException(404, { message: "Job not found" });
      const [urls, runs] = await Promise.all([
        listJobUrls(jobId),
        listJobRuns(jobId),
      ]);
      return c.json({ job, urls, runs });
    },
  );

  // update job ---------------------------------------------------------------
  app.put(
    `${base}/jobs/:jobId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Update a job",
      responses: ok,
    }),
    validator("param", jobParam),
    validator("json", updateJobBody),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const job = await updateImportJob(
          { organisationId: tenantId },
          jobId,
          body,
        );
        if (!job) throw new HTTPException(404, { message: "Job not found" });
        return c.json(job);
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        throw new HTTPException(400, { message: e + "" });
      }
    },
  );

  // delete job ---------------------------------------------------------------
  app.delete(
    `${base}/jobs/:jobId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Delete a job",
      responses: ok,
    }),
    validator("param", jobParam),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId } = c.req.valid("param");
      const deleted = await deleteImportJob(
        { organisationId: tenantId },
        jobId,
      );
      if (!deleted) throw new HTTPException(404, { message: "Job not found" });
      return c.json({ success: true });
    },
  );

  // replace URL list ---------------------------------------------------------
  app.put(
    `${base}/jobs/:jobId/urls`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Replace a job's URL list",
      responses: ok,
    }),
    validator("param", jobParam),
    validator("json", urlsBody),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId } = c.req.valid("param");
      const { urls } = c.req.valid("json");
      const job = await getImportJob({ organisationId: tenantId }, jobId);
      if (!job) throw new HTTPException(404, { message: "Job not found" });
      const saved = await setJobUrls({ organisationId: tenantId }, jobId, urls);
      return c.json(saved);
    },
  );

  // run history --------------------------------------------------------------
  app.get(
    `${base}/jobs/:jobId/runs`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "List a job's runs",
      responses: ok,
    }),
    validator("param", jobParam),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId } = c.req.valid("param");
      const job = await getImportJob({ organisationId: tenantId }, jobId);
      if (!job) throw new HTTPException(404, { message: "Job not found" });
      const runs = await listJobRuns(jobId);
      return c.json(runs);
    },
  );

  // run detail ---------------------------------------------------------------
  app.get(
    `${base}/jobs/:jobId/runs/:runId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Get a run with per-URL results",
      responses: ok,
    }),
    validator("param", runParam),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId, runId } = c.req.valid("param");
      const job = await getImportJob({ organisationId: tenantId }, jobId);
      if (!job) throw new HTTPException(404, { message: "Job not found" });
      const run = await getJobRun(jobId, runId);
      if (!run) throw new HTTPException(404, { message: "Run not found" });
      return c.json(run);
    },
  );

  // start a run now ----------------------------------------------------------
  app.post(
    `${base}/jobs/:jobId/run`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["url-import"],
      summary: "Trigger a run now (runs async in the background)",
      responses: ok,
    }),
    validator("param", jobParam),
    isTenantMember,
    async (c) => {
      const { tenantId, jobId } = c.req.valid("param");
      const run = await enqueueRun(
        { organisationId: tenantId, userId: c.get("usersId") },
        jobId,
        "manual",
      );
      if (!run) throw new HTTPException(404, { message: "Job not found" });
      return c.json(run, 202);
    },
  );
}
