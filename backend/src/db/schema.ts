import { pgTableCreator } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  uuid,
  text,
  varchar,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-valibot";
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
  organisationId: uuid("organisation_id").primaryKey(),
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
    organisationId: uuid("organisation_id").notNull(),
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
    index("post_processing_agents_org_idx").on(table.organisationId),
    uniqueIndex("post_processing_agents_org_name_idx").on(
      table.organisationId,
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
// Everything is scoped by organisationId (== tenantId). A run executes with
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
    organisationId: uuid("organisation_id").notNull(),
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
  (table) => [index("ai_test_suites_org_idx").on(table.organisationId)],
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
    organisationId: uuid("organisation_id").notNull(),
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
    organisationId: uuid("organisation_id").notNull(),
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
    organisationId: uuid("organisation_id").notNull(),
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
// Idea boards
//
// A free-form pinboard: cards are plain text notes placed anywhere on a
// canvas (x/y), the way a physical wall of sticky notes works. There are no
// sections/columns — visual structure comes from placement plus standalone
// "heading" cards, so nothing has to be modelled twice when someone
// rearranges the wall.
//
// Cards live in their own rows (not in a page's markdown) because a board is
// worked on by several people at once: every note is an independently
// editable cell, and two people moving two cards never touch the same row.
//
// A board optionally hangs off a wiki page (`pageId`) and cards can point at
// wiki pages or at each other (`idea_board_card_links`), which is the bridge
// between "loose idea" and "documented knowledge".
//
// Note: only the wiki page hierarchy (knowledge_text) is indexed for search
// and embeddings. Cards are NOT full-text searchable on their own — mirroring
// a board into a wiki page is what makes it findable (see lib/idea-boards).
// ---------------------------------------------------------------------------

/**
 * "note"    — a sticky note
 * "heading" — a standalone caption used to label a region of the canvas
 */
export const IDEA_CARD_KINDS = ["note", "heading"] as const;
export type IdeaCardKind = (typeof IDEA_CARD_KINDS)[number];

/** How a card relates to another card or to a wiki page. */
export const IDEA_LINK_TYPES = [
  "relates",
  "duplicate",
  "answers",
  "blocks",
] as const;
export type IdeaLinkType = (typeof IDEA_LINK_TYPES)[number];

export type IdeaBoardSettings = {
  /** show the author label on cards */
  showAuthors?: boolean;
  /** frozen board — no new cards or comments */
  locked?: boolean;
  /** canvas background */
  background?: "grid" | "plain";
};

export const ideaBoards = pgBaseTable(
  "idea_boards",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** visibility — mirrors knowledge_text: team-scoped or tenant-wide */
    teamId: uuid("team_id"),
    tenantWide: boolean("tenant_wide").notNull().default(false),
    /**
     * optional wiki page this board belongs to. No FK: knowledge_text lives in
     * the framework schema, which is a separate migration set — the reference
     * is resolved (and tolerated as dangling) in the lib layer.
     */
    pageId: uuid("page_id"),
    settings: jsonb("settings")
      .$type<IdeaBoardSettings>()
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
  (table) => [
    index("idea_boards_tenant_idx").on(table.tenantId),
    index("idea_boards_page_idx").on(table.pageId),
  ],
);

export const ideaBoardCards = pgBaseTable(
  "idea_board_cards",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    boardId: uuid("board_id")
      .notNull()
      .references(() => ideaBoards.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    /** one of IDEA_CARD_KINDS */
    kind: text("kind").notNull().default("note"),
    text: text("text").notNull().default(""),
    /** author initials/name at write time — survives the user being deleted */
    authorLabel: text("author_label"),
    createdBy: uuid("created_by"),
    /** palette key, not a hex value — theming stays in the frontend */
    color: text("color"),
    /** free placement on the canvas, in px at zoom 1 */
    x: integer("x").notNull().default(0),
    y: integer("y").notNull().default(0),
    width: integer("width").notNull().default(220),
    /** null = height grows with the text */
    height: integer("height"),
    /**
     * stacking order as a fractional-index key (see
     * framework/src/lib/utils/fractional-index.ts) — bringing a card to the
     * front is a single-row update, never a renumbering of the whole board.
     */
    z: varchar("z", { length: 64 }).notNull(),
    /** optional link card → wiki page (e.g. the page this card became) */
    pageId: uuid("page_id"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idea_board_cards_board_idx").on(table.boardId),
    index("idea_board_cards_tenant_idx").on(table.tenantId),
    uniqueIndex("idea_board_cards_z_idx").on(table.boardId, table.z),
  ],
);

/**
 * Comments on a card, one row per comment, each attributed to a user. A user
 * may comment more than once; only the author (or the board creator) may
 * edit/delete a comment.
 */
export const ideaBoardCardComments = pgBaseTable(
  "idea_board_card_comments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    cardId: uuid("card_id")
      .notNull()
      .references(() => ideaBoardCards.id, { onDelete: "cascade" }),
    /**
     * denormalized so every comment of a board loads in ONE query on the
     * board index — that is why there is no comment counter on the card that
     * could drift out of sync.
     */
    boardId: uuid("board_id")
      .notNull()
      .references(() => ideaBoards.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    text: text("text").notNull(),
    createdBy: uuid("created_by"),
    authorLabel: text("author_label"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idea_board_card_comments_card_idx").on(
      table.cardId,
      table.createdAt,
    ),
    index("idea_board_card_comments_board_idx").on(table.boardId),
  ],
);

/**
 * Rudimentary relations: card → card, or card → wiki page. Exactly one of
 * `targetCardId` / `targetPageId` is set (enforced by a CHECK constraint in
 * the migration). `targetPageTitle` is a snapshot so a link stays readable
 * after its target page is deleted — the same trick knowledge_text_link uses.
 */
export const ideaBoardCardLinks = pgBaseTable(
  "idea_board_card_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => ideaBoards.id, { onDelete: "cascade" }),
    sourceCardId: uuid("source_card_id")
      .notNull()
      .references(() => ideaBoardCards.id, { onDelete: "cascade" }),
    targetCardId: uuid("target_card_id").references(() => ideaBoardCards.id, {
      onDelete: "cascade",
    }),
    targetPageId: uuid("target_page_id"),
    targetPageTitle: text("target_page_title"),
    /** one of IDEA_LINK_TYPES */
    type: text("type").notNull().default("relates"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idea_board_card_links_source_idx").on(table.sourceCardId),
    index("idea_board_card_links_target_idx").on(table.targetCardId),
    index("idea_board_card_links_board_idx").on(table.boardId),
    // Exactly one target. Without this a row could point at both a card and a
    // page, or at nothing at all, and every reader would have to guess.
    check(
      "idea_board_card_links_one_target",
      sql`(${table.targetCardId} IS NULL) <> (${table.targetPageId} IS NULL)`,
    ),
    // A card can't be linked to itself.
    check(
      "idea_board_card_links_no_self",
      sql`${table.targetCardId} IS NULL OR ${table.targetCardId} <> ${table.sourceCardId}`,
    ),
    // Two partial indexes instead of one composite: in a plain unique index
    // NULL != NULL, so (source, NULL, page, type) rows would never collide and
    // the same link could be inserted repeatedly. Restricting each index to the
    // rows where its target column is set sidesteps the NULL semantics.
    uniqueIndex("idea_board_card_links_card_unique_idx")
      .on(table.sourceCardId, table.targetCardId, table.type)
      .where(sql`${table.targetCardId} IS NOT NULL`),
    uniqueIndex("idea_board_card_links_page_unique_idx")
      .on(table.sourceCardId, table.targetPageId, table.type)
      .where(sql`${table.targetPageId} IS NOT NULL`),
  ],
);

export const ideaBoardsRelations = relations(ideaBoards, ({ many }) => ({
  cards: many(ideaBoardCards),
  comments: many(ideaBoardCardComments),
  links: many(ideaBoardCardLinks),
}));

export const ideaBoardCardsRelations = relations(
  ideaBoardCards,
  ({ one, many }) => ({
    board: one(ideaBoards, {
      fields: [ideaBoardCards.boardId],
      references: [ideaBoards.id],
    }),
    comments: many(ideaBoardCardComments),
  }),
);

export const ideaBoardCardCommentsRelations = relations(
  ideaBoardCardComments,
  ({ one }) => ({
    card: one(ideaBoardCards, {
      fields: [ideaBoardCardComments.cardId],
      references: [ideaBoardCards.id],
    }),
  }),
);

export const ideaBoardSelectSchema = createSelectSchema(ideaBoards);
export const ideaBoardInsertSchema = createInsertSchema(ideaBoards);
export const ideaBoardUpdateSchema = createUpdateSchema(ideaBoards);

export const ideaBoardCardSelectSchema = createSelectSchema(ideaBoardCards);
export const ideaBoardCardInsertSchema = createInsertSchema(ideaBoardCards);
export const ideaBoardCardUpdateSchema = createUpdateSchema(ideaBoardCards);

export const ideaBoardCardCommentSelectSchema = createSelectSchema(
  ideaBoardCardComments,
);
export const ideaBoardCardCommentInsertSchema = createInsertSchema(
  ideaBoardCardComments,
);

export const ideaBoardCardLinkSelectSchema =
  createSelectSchema(ideaBoardCardLinks);
export const ideaBoardCardLinkInsertSchema =
  createInsertSchema(ideaBoardCardLinks);

export type IdeaBoardSelect = typeof ideaBoards.$inferSelect;
export type IdeaBoardInsert = typeof ideaBoards.$inferInsert;
export type IdeaBoardCardSelect = typeof ideaBoardCards.$inferSelect;
export type IdeaBoardCardInsert = typeof ideaBoardCards.$inferInsert;
export type IdeaBoardCardCommentSelect =
  typeof ideaBoardCardComments.$inferSelect;
export type IdeaBoardCardCommentInsert =
  typeof ideaBoardCardComments.$inferInsert;
export type IdeaBoardCardLinkSelect = typeof ideaBoardCardLinks.$inferSelect;
export type IdeaBoardCardLinkInsert = typeof ideaBoardCardLinks.$inferInsert;
