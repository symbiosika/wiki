import { pgTableCreator } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  uuid,
  text,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-valibot";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { PREFIX } from "./index";

export const pgBaseTable = pgTableCreator((name: string) => `${PREFIX}${name}`);

/** Raw binary column (Postgres `bytea`), used to store small uploaded blobs. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------------------
// Organisation logos
//
// One optional logo per organisation (tenant), shown in the app header. The
// framework owns the `tenants` table (in the submodule) and can't be extended
// from the app, so the logo lives here as an app-side table keyed 1:1 by the
// organisation id. The image is cropped client-side to the header aspect ratio
// before upload and stored as-is (PNG, so transparent corners survive).
// ---------------------------------------------------------------------------

export const organisationLogos = pgBaseTable("organisation_logos", {
  /** the tenant this logo belongs to — one logo per organisation */
  tenantId: uuid("tenant_id").primaryKey(),
  image: bytea("image").notNull(),
  contentType: text("content_type").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at", { mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" })
    .notNull()
    .defaultNow(),
});

export const organisationLogoSelectSchema =
  createSelectSchema(organisationLogos);

export type OrganisationLogoSelect = typeof organisationLogos.$inferSelect;
export type OrganisationLogoInsert = typeof organisationLogos.$inferInsert;

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
    tenantId: uuid("tenant_id").notNull(),
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
    index("url_import_jobs_tenant_idx").on(table.tenantId),
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
    tenantId: uuid("tenant_id").notNull(),
    url: text("url").notNull(),
    /** optional title override (otherwise the parsed page title is used) */
    title: text("title"),
    /**
     * Optional wiki subpath the imported page is filed under, relative to the
     * job's parent page. Each string is one level's page title (top→bottom);
     * `[]` means the page lands directly under the job parent. The category
     * pages are created on demand during a run (see runner.ts).
     */
    subPath: jsonb("sub_path")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    tenantId: uuid("tenant_id").notNull(),
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

// ---------------------------------------------------------------------------
// Post-processing agents
//
// Tenant-managed LLM "agents" that rework a parsed document (usually
// PDF→markdown) before it is stored as a wiki page. The reusable scaffold lives
// in lib/post-processing-agents/; a config row differs only by name + prompt
// (the task profile) plus optional model/step overrides. Selected on import via
// `usePostProcessors: ["agent:<id>"]`.
// ---------------------------------------------------------------------------

export const postProcessingAgents = pgBaseTable(
  "post_processing_agents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    /** display name, unique per organisation */
    name: text("name").notNull(),
    /** shown in pickers */
    description: text("description"),
    /** the task profile injected into the agent scaffold */
    prompt: text("prompt").notNull(),
    /** optional OpenRouter model override */
    modelId: text("model_id"),
    /** optional step-budget override (1..100) */
    maxSteps: integer("max_steps"),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("post_processing_agents_tenant_idx").on(table.tenantId),
    uniqueIndex("post_processing_agents_tenant_name_idx").on(
      table.tenantId,
      table.name,
    ),
  ],
);

export const postProcessingAgentSelectSchema =
  createSelectSchema(postProcessingAgents);
export const postProcessingAgentInsertSchema =
  createInsertSchema(postProcessingAgents);
export const postProcessingAgentUpdateSchema =
  createUpdateSchema(postProcessingAgents);

export type PostProcessingAgentSelect =
  typeof postProcessingAgents.$inferSelect;
export type PostProcessingAgentInsert =
  typeof postProcessingAgents.$inferInsert;

// ---------------------------------------------------------------------------
// AI test suites — automated evaluation of the wiki chat agent
//
// A suite owns a list of real customer questions. Each run drives the *same*
// wiki agent that production uses (see ai/wiki-agent.ts) once per active
// question, records the full tool trajectory + answer, and scores it along
// three axes (tool usage, groundedness/evidence, answer relevance) plus hard
// gates. Results are their own table (not a jsonb array on the run) because
// trajectories/judge reports are large, the UI drills down per question, and
// per-question time series need `WHERE question_id = …`.
//
// Everything is scoped by tenantId (== tenantId). A run executes with
// the permissions of the user who started it, so it only ever sees the wiki
// pages that user can see.
// ---------------------------------------------------------------------------

/** Behaviour class of a test question — "correct behaviour" is type-dependent. */
export const AI_TEST_QUESTION_TYPES = [
  "answerable",
  "synthesis",
  "not-in-wiki",
  "ambiguous",
] as const;

/** Overall status of a single run. */
export const AI_TEST_RUN_STATUSES = [
  "running",
  "success",
  "partial",
  "error",
  "cancelled",
] as const;

/** Per-question verdict. */
export const AI_TEST_VERDICTS = ["pass", "warn", "fail"] as const;

/** Per-claim groundedness verdict from the judge. */
export const AI_TEST_CLAIM_VERDICTS = [
  "supported",
  "unsupported",
  "contradicted",
] as const;

export const aiTestSuites = pgBaseTable(
  "ai_test_suites",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** optional OpenRouter model override for the *judge* (never the chat agent) */
    judgeModelId: text("judge_model_id"),
    /** optional step-budget override for the agent under test */
    stepLimit: integer("step_limit"),
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
  (table) => [index("ai_test_suites_tenant_idx").on(table.tenantId)],
);

export const aiTestQuestions = pgBaseTable(
  "ai_test_questions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => aiTestSuites.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    question: text("question").notNull(),
    /** one of AI_TEST_QUESTION_TYPES */
    type: text("type").notNull().default("answerable"),
    /** optional expected source page ids (deterministic recall) */
    expectedPageIds: jsonb("expected_page_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** optional 2–5 must-have facts (coverage via judge) */
    expectedFacts: jsonb("expected_facts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("ai_test_questions_suite_idx").on(table.suiteId)],
);

export const aiTestRuns = pgBaseTable(
  "ai_test_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => aiTestSuites.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    status: text("status").notNull().default("running"),
    /** the user whose permissions the run executes with (required) */
    startedBy: uuid("started_by").notNull(),
    /** resolved judge model actually used for this run */
    judgeModelId: text("judge_model_id"),
    total: integer("total").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    warned: integer("warned").notNull().default(0),
    hardGateFails: integer("hard_gate_fails").notNull().default(0),
    /** per-metric means, pass-rate, per-type breakdown */
    aggregates: jsonb("aggregates").$type<AiTestRunAggregates | null>(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** fatal error that aborted the whole run (rare) */
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "string" }),
  },
  (table) => [
    index("ai_test_runs_suite_idx").on(table.suiteId),
    index("ai_test_runs_started_idx").on(table.startedAt),
  ],
);

export const aiTestResults = pgBaseTable(
  "ai_test_results",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => aiTestRuns.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    /**
     * The question this result came from. `set null` + a text snapshot below
     * so a per-question time series survives the question being edited or
     * deleted.
     */
    questionId: uuid("question_id").references(() => aiTestQuestions.id, {
      onDelete: "set null",
    }),
    questionText: text("question_text").notNull(),
    questionType: text("question_type").notNull(),
    expectedPageIds: jsonb("expected_page_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expectedFacts: jsonb("expected_facts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** the agent's final answer */
    answer: text("answer"),
    /** step-by-step tool trajectory (tool outputs clipped for storage) */
    trajectory: jsonb("trajectory").$type<AiTestTrajectory | null>(),
    /** full numeric score breakdown + deterministic metrics */
    scores: jsonb("scores").$type<AiTestScores | null>(),
    /** judge reasoning, claim verdicts, flags, hard-gate reasons */
    judgeReport: jsonb("judge_report").$type<AiTestJudgeReport | null>(),
    /** pass | warn | fail */
    verdict: text("verdict"),
    // individual scores as columns too, so per-question time series and
    // ordering are plain SQL (WHERE question_id = … ORDER BY created_at)
    toolUsageScore: real("tool_usage_score"),
    groundednessScore: real("groundedness_score"),
    relevanceScore: real("relevance_score"),
    referenceScore: real("reference_score"),
    totalScore: real("total_score"),
    durationMs: integer("duration_ms"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** per-question error (never aborts the run) */
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_test_results_run_idx").on(table.runId),
    index("ai_test_results_question_idx").on(table.questionId),
  ],
);

// ---- jsonb payload types ----------------------------------------------------

/** One tool invocation in a trajectory. */
export interface AiTestTrajectoryStep {
  index: number;
  toolName: string;
  input: unknown;
  /** clipped tool output as returned to the model */
  output: unknown;
  /** false when the tool returned `{ success: false }` */
  ok: boolean;
}

export interface AiTestTrajectory {
  steps: AiTestTrajectoryStep[];
  stepCount: number;
  finishReason?: string;
}

/** One atomic factual claim checked against the tool outputs. */
export interface AiTestClaim {
  claim: string;
  verdict: (typeof AI_TEST_CLAIM_VERDICTS)[number];
  reasoning?: string;
}

/** Everything the judge produced for a single question. */
export interface AiTestJudgeReport {
  relevance: number;
  relevanceReasoning?: string;
  saysWikiHasNoAnswer?: boolean;
  trajectoryVerdict?: string;
  /** page titles the answer claims to cite (for the invented-source gate) */
  citedPageTitles?: string[];
  factsCovered?: { fact: string; covered: boolean }[];
  claims?: AiTestClaim[];
  flags: {
    generalKnowledgeSuspected?: boolean;
    noAnswerCase?: boolean;
    hardGateReasons?: string[];
  };
}

/** Deterministic, non-scored metrics captured per question. */
export interface AiTestMetrics {
  durationMs: number;
  totalTokens: number;
  steps: number;
  searchCount: number;
  readCount: number;
  failedToolCalls: number;
  duplicateToolCalls: number;
  /** read∩expected / expected, only when expectedPageIds is non-empty */
  pageRecall?: number | null;
}

export interface AiTestScores {
  toolUsage: number;
  groundedness: number;
  relevance: number;
  /** mean of reference-data sub-scores, only when reference data exists */
  reference?: number | null;
  total: number;
  metrics: AiTestMetrics;
}

export interface AiTestRunAggregates {
  passRate: number;
  meanTotal: number;
  meanToolUsage: number;
  meanGroundedness: number;
  meanRelevance: number;
  hardGateFails: number;
  byType: Record<
    string,
    { count: number; passRate: number; meanTotal: number }
  >;
}

// ---- relations --------------------------------------------------------------

export const aiTestSuitesRelations = relations(aiTestSuites, ({ many }) => ({
  questions: many(aiTestQuestions),
  runs: many(aiTestRuns),
}));

export const aiTestQuestionsRelations = relations(
  aiTestQuestions,
  ({ one }) => ({
    suite: one(aiTestSuites, {
      fields: [aiTestQuestions.suiteId],
      references: [aiTestSuites.id],
    }),
  }),
);

export const aiTestRunsRelations = relations(aiTestRuns, ({ one, many }) => ({
  suite: one(aiTestSuites, {
    fields: [aiTestRuns.suiteId],
    references: [aiTestSuites.id],
  }),
  results: many(aiTestResults),
}));

export const aiTestResultsRelations = relations(aiTestResults, ({ one }) => ({
  run: one(aiTestRuns, {
    fields: [aiTestResults.runId],
    references: [aiTestRuns.id],
  }),
}));

// ---- valibot schemas + types ------------------------------------------------

export const aiTestSuiteSelectSchema = createSelectSchema(aiTestSuites);
export const aiTestSuiteInsertSchema = createInsertSchema(aiTestSuites);
export const aiTestSuiteUpdateSchema = createUpdateSchema(aiTestSuites);

export const aiTestQuestionSelectSchema = createSelectSchema(aiTestQuestions);
export const aiTestRunSelectSchema = createSelectSchema(aiTestRuns);
export const aiTestResultSelectSchema = createSelectSchema(aiTestResults);

export type AiTestSuiteSelect = typeof aiTestSuites.$inferSelect;
export type AiTestSuiteInsert = typeof aiTestSuites.$inferInsert;
export type AiTestQuestionSelect = typeof aiTestQuestions.$inferSelect;
export type AiTestQuestionInsert = typeof aiTestQuestions.$inferInsert;
export type AiTestRunSelect = typeof aiTestRuns.$inferSelect;
export type AiTestResultSelect = typeof aiTestResults.$inferSelect;

// ---------------------------------------------------------------------------
// Chat sessions ("Fragen" view)
//
// The wiki-assistant slide-over is stateless: closing it drops the
// conversation. The dedicated chat view instead keeps named sessions per user,
// the way a consumer chat app does — pick one up later, rename it, delete it.
//
// A session belongs to exactly one user inside one organisation; there is no
// sharing. Messages are stored as AI-SDK UIMessage `parts` (text + tool calls)
// so a reopened session renders exactly like the live stream did, and can be
// handed back to the model unchanged.
// ---------------------------------------------------------------------------

export const chatSessions = pgBaseTable(
  "chat_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    /** owner — sessions are private to the user who created them */
    userId: uuid("user_id").notNull(),
    /** derived from the first question; NULL until that message arrives */
    title: text("title"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
    /** bumped on every stored message — the list is ordered by this */
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_sessions_tenant_user_idx").on(
      table.tenantId,
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const chatMessages = pgBaseTable(
  "chat_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    /**
     * The AI-SDK message id as generated on the client. Stable across the
     * request that streams the answer and the follow-up requests that resend
     * the history, which is what makes saving a conversation an upsert instead
     * of an append (and keeps a retried request from duplicating rows).
     */
    messageId: text("message_id").notNull(),
    /** "user" | "assistant" | "system" */
    role: text("role").notNull(),
    /** UIMessage.parts — text, tool calls and their results */
    parts: jsonb("parts").notNull(),
    /** position in the conversation; ordering key (createdAt can tie) */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_session_idx").on(table.sessionId, table.position),
    uniqueIndex("chat_messages_session_message_idx").on(
      table.sessionId,
      table.messageId,
    ),
  ],
);

export const chatSessionsRelations = relations(chatSessions, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

export const chatSessionSelectSchema = createSelectSchema(chatSessions);
export const chatMessageSelectSchema = createSelectSchema(chatMessages);

export type ChatSessionSelect = typeof chatSessions.$inferSelect;
export type ChatSessionInsert = typeof chatSessions.$inferInsert;
export type ChatMessageSelect = typeof chatMessages.$inferSelect;
export type ChatMessageInsert = typeof chatMessages.$inferInsert;

// ---------------------------------------------------------------------------
// Collections — typed tables as wiki pages
//
// A collection is a wiki page whose body is a table instead of prose: the user
// defines a handful of typed columns (Airtable-lite) and adds records. Think
// "Vereinsmitglieder", "aktuelle Angebote", "Hauptprodukte".
//
// The design rule is that a collection IS a page, not a sibling concept:
// `knowledgeTextId` is a 1:1 FK to the knowledge_text row, and the page's title
// is the collection's name (one source of truth, renamed in the normal page UI).
// Everything the wiki already does then applies without a second
// implementation — personal/team/organisation visibility, the page tree,
// public publishing, backlinks, search. Read access is enforced by calling the
// framework's getKnowledgeTextById() on the anchor page, write access by
// checkKnowledgeTextWritePermission(); see lib/collections/store.ts.
//
// Records are jsonb, not real columns. Adding, retyping or dropping a column is
// then an UPDATE instead of runtime DDL — which in a multi-tenant deployment
// with a migration pipeline is the difference between a feature and an
// incident. Up to ~10k records per collection this costs nothing: the row set
// is bounded per collection and reached through an indexed collection_id.
// ---------------------------------------------------------------------------

/**
 * Column types. Deliberately small — every entry here is a UI editor, a
 * validator, a filter and a markdown renderer that has to exist and be tested.
 * Relation types (link to a wiki page / a user) are the intended next step.
 */
export const COLLECTION_FIELD_TYPES = [
  "text",
  "longText",
  "number",
  "checkbox",
  "date",
  "select",
  "multiSelect",
  "url",
  "email",
] as const;

export type CollectionFieldType = (typeof COLLECTION_FIELD_TYPES)[number];

/** One choice of a select / multiSelect field. */
export interface CollectionFieldChoice {
  value: string;
  /** optional colour token for the chip, e.g. "emerald" */
  color?: string;
}

/** Per-field configuration; only some keys apply to some types. */
export interface CollectionFieldOptions {
  /** select / multiSelect */
  choices?: CollectionFieldChoice[];
  /** number: decimal places (0 = integer) */
  precision?: number;
  /** number: rendered suffix, e.g. "€" or "kg" */
  suffix?: string;
}

/** Collection-level settings. */
export interface CollectionSettings {
  /**
   * Field key used as the record's label (in dialogs, delete confirmations and
   * the materialized markdown). Falls back to the first field.
   */
  titleFieldKey?: string;
  /** Default sort applied when no user sort is active. */
  defaultSort?: { key: string; direction: "asc" | "desc" };
  /**
   * Mirror the table into the page body as a markdown table so search, the RAG
   * index, the MCP read tools and the public view see the data.
   *
   * Off by default: a collection may hold personal data (members, contacts),
   * and materializing pushes it into the embedding pipeline and — below a
   * published page — the public site. Opting in is a deliberate act.
   */
  materialize?: boolean;
}

export const collections = pgBaseTable(
  "collections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    /**
     * The wiki page this collection lives on. Unique (1:1) and cascading: the
     * page owns the collection, so deleting the page takes the schema and all
     * records with it and never leaves orphans behind.
     */
    knowledgeTextId: uuid("knowledge_text_id")
      .notNull()
      .unique()
      .references(() => knowledgeText.id, { onDelete: "cascade" }),
    /** shown above the table; the *name* is the page title */
    description: text("description"),
    settings: jsonb("settings")
      .$type<CollectionSettings>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("collections_tenant_idx").on(table.tenantId)],
);

export const collectionFields = pgBaseTable(
  "collection_fields",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    /**
     * Stable identifier used as the jsonb key in collection_records.data.
     * Generated from the label on creation and never changed afterwards, so
     * renaming a column does not have to rewrite every record.
     */
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** one of COLLECTION_FIELD_TYPES */
    type: text("type").$type<CollectionFieldType>().notNull().default("text"),
    options: jsonb("options")
      .$type<CollectionFieldOptions>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    required: boolean("required").notNull().default(false),
    /**
     * Column order. A plain integer, renumbered on reorder — a fractional index
     * (as the page tree uses) buys nothing for the ~5-20 columns a collection
     * realistically has.
     */
    position: integer("position").notNull().default(0),
    /** hidden columns stay in the data, they are just not rendered */
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("collection_fields_collection_idx").on(
      table.collectionId,
      table.position,
    ),
    uniqueIndex("collection_fields_collection_key_idx").on(
      table.collectionId,
      table.key,
    ),
  ],
);

export const collectionRecords = pgBaseTable(
  "collection_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    /** field key → value, validated against collection_fields on every write */
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** manual row order; new records are appended */
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("collection_records_collection_idx").on(
      table.collectionId,
      table.position,
    ),
    index("collection_records_data_idx").using("gin", table.data),
  ],
);

// ---- relations --------------------------------------------------------------

export const collectionsRelations = relations(collections, ({ many }) => ({
  fields: many(collectionFields),
  records: many(collectionRecords),
}));

export const collectionFieldsRelations = relations(
  collectionFields,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionFields.collectionId],
      references: [collections.id],
    }),
  }),
);

export const collectionRecordsRelations = relations(
  collectionRecords,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionRecords.collectionId],
      references: [collections.id],
    }),
  }),
);

// ---- valibot schemas + types ------------------------------------------------

export const collectionSelectSchema = createSelectSchema(collections);
export const collectionFieldSelectSchema = createSelectSchema(collectionFields);
export const collectionRecordSelectSchema =
  createSelectSchema(collectionRecords);

export type CollectionSelect = typeof collections.$inferSelect;
export type CollectionInsert = typeof collections.$inferInsert;
export type CollectionFieldSelect = typeof collectionFields.$inferSelect;
export type CollectionFieldInsert = typeof collectionFields.$inferInsert;
export type CollectionRecordSelect = typeof collectionRecords.$inferSelect;
export type CollectionRecordInsert = typeof collectionRecords.$inferInsert;
