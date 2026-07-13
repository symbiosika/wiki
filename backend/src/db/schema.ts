import { pgTableCreator } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-valibot";
import { PREFIX } from "./index";

export const pgBaseTable = pgTableCreator((name: string) => `${PREFIX}${name}`);

// ---------------------------------------------------------------------------
// URL batch-import jobs
//
// A job owns a list of URLs and a cron schedule. On each run (scheduled or
// manual) every URL is fetched, converted to markdown and upserted as a wiki
// page (keyed by the URL, scoped to the job) — one page per URL, updated in
// place on later runs. Every URL keeps its own import status so a single
// failing document never blocks the others, and every run is recorded so the
// history is visible on the job.
// ---------------------------------------------------------------------------

/** One import status per URL. */
export const URL_IMPORT_URL_STATUSES = ["pending", "success", "error"] as const;

/** Overall status of a single run. */
export const URL_IMPORT_RUN_STATUSES = [
  "running",
  "success",
  "partial",
  "error",
] as const;

export const urlImportJobs = pgBaseTable(
  "url_import_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organisationId: uuid("organisation_id").notNull(),
    name: text("name").notNull(),
    /** standard 5-field Linux cron expression */
    cron: text("cron").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** where imported pages live */
    teamId: uuid("team_id"),
    tenantWide: boolean("tenant_wide").notNull().default(false),
    /** optional parent wiki page the imported pages are nested under */
    parentId: uuid("parent_id"),
    createdBy: uuid("created_by"),
    lastRunId: uuid("last_run_id"),
    lastRunAt: timestamp("last_run_at", { mode: "string" }),
    lastRunStatus: text("last_run_status"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("url_import_jobs_org_idx").on(table.organisationId),
    index("url_import_jobs_enabled_idx").on(table.enabled),
  ],
);

export const urlImportJobUrls = pgBaseTable(
  "url_import_job_urls",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobId: uuid("job_id")
      .notNull()
      .references(() => urlImportJobs.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull(),
    url: text("url").notNull(),
    /** optional title override (otherwise the parsed page title is used) */
    title: text("title"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("pending"),
    lastError: text("last_error"),
    lastImportedAt: timestamp("last_imported_at", { mode: "string" }),
    /** the wiki page this URL maps to (kept stable across runs) */
    knowledgeTextId: uuid("knowledge_text_id"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("url_import_job_urls_job_idx").on(table.jobId)],
);

export const urlImportJobRuns = pgBaseTable(
  "url_import_job_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobId: uuid("job_id")
      .notNull()
      .references(() => urlImportJobs.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull(),
    /** "manual" | "scheduled" */
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    total: integer("total").notNull().default(0),
    succeeded: integer("succeeded").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    startedBy: uuid("started_by"),
    /** per-URL outcome of this run */
    results: jsonb("results")
      .$type<UrlImportRunResultItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** fatal error that aborted the whole run (rare) */
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "string" }),
  },
  (table) => [
    index("url_import_job_runs_job_idx").on(table.jobId),
    index("url_import_job_runs_started_idx").on(table.startedAt),
  ],
);

/** One entry in a run's `results` array. */
export interface UrlImportRunResultItem {
  urlId: string;
  url: string;
  status: "success" | "error";
  error?: string;
  knowledgeTextId?: string;
  /** true when the page content actually changed this run */
  changed?: boolean;
}

// ---- relations --------------------------------------------------------------

export const urlImportJobsRelations = relations(urlImportJobs, ({ many }) => ({
  urls: many(urlImportJobUrls),
  runs: many(urlImportJobRuns),
}));

export const urlImportJobUrlsRelations = relations(
  urlImportJobUrls,
  ({ one }) => ({
    job: one(urlImportJobs, {
      fields: [urlImportJobUrls.jobId],
      references: [urlImportJobs.id],
    }),
  }),
);

export const urlImportJobRunsRelations = relations(
  urlImportJobRuns,
  ({ one }) => ({
    job: one(urlImportJobs, {
      fields: [urlImportJobRuns.jobId],
      references: [urlImportJobs.id],
    }),
  }),
);

// ---- valibot schemas --------------------------------------------------------

export const urlImportJobSelectSchema = createSelectSchema(urlImportJobs);
export const urlImportJobInsertSchema = createInsertSchema(urlImportJobs);
export const urlImportJobUpdateSchema = createUpdateSchema(urlImportJobs);

export const urlImportJobUrlSelectSchema = createSelectSchema(urlImportJobUrls);
export const urlImportJobRunSelectSchema = createSelectSchema(urlImportJobRuns);

export type UrlImportJobSelect = typeof urlImportJobs.$inferSelect;
export type UrlImportJobInsert = typeof urlImportJobs.$inferInsert;
export type UrlImportJobUrlSelect = typeof urlImportJobUrls.$inferSelect;
export type UrlImportJobRunSelect = typeof urlImportJobRuns.$inferSelect;
