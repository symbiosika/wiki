/**
 * AI test-suite routes.
 *
 *   GET    /ai-tests/suites                         list suites
 *   POST   /ai-tests/suites                         create suite
 *   GET    /ai-tests/suites/:suiteId                suite + questions + runs
 *   PUT    /ai-tests/suites/:suiteId                update suite settings
 *   DELETE /ai-tests/suites/:suiteId                delete suite (cascades)
 *   PUT    /ai-tests/suites/:suiteId/questions      replace question list (id-preserving)
 *   POST   /ai-tests/suites/:suiteId/questions/bulk add questions, one per line
 *   POST   /ai-tests/suites/:suiteId/run            start a run now (async, 202)
 *   GET    /ai-tests/suites/:suiteId/runs           run history
 *   GET    /ai-tests/suites/:suiteId/runs/:runId    run detail + results
 *   POST   /ai-tests/suites/:suiteId/runs/:runId/cancel  cancel a running run
 *   DELETE /ai-tests/suites/:suiteId/runs/:runId    delete a run
 *
 * All routes are authenticated and tenant-scoped (isTenantMember). Every suite
 * operation is additionally scoped by tenantId in the lib layer, so a
 * member of tenant A can never touch tenant B's suites.
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
import { AI_TEST_QUESTION_TYPES } from "../../../../db/schema";
import {
  createSuite,
  listSuites,
  getSuite,
  updateSuite,
  deleteSuite,
  listQuestions,
  setQuestions,
  bulkAddQuestions,
  listRuns,
  getRun,
  listRunResults,
  deleteRun,
} from "../../../../lib/ai-tests";
import { enqueueRun, cancelRun } from "../../../../lib/ai-tests/runner";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });
const suiteParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  suiteId: v.pipe(v.string(), v.uuid()),
});
const runParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  suiteId: v.pipe(v.string(), v.uuid()),
  runId: v.pipe(v.string(), v.uuid()),
});

// Sensible limits so a suite/run stays bounded (cost + payload).
const MAX_QUESTION_LEN = 2000;
const MAX_QUESTIONS_PER_SUITE = 200;
const MAX_BULK_CHARS = 50_000;

const nullableString = v.nullable(v.string());
const questionType = v.picklist(AI_TEST_QUESTION_TYPES);

const createSuiteBody = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  description: v.optional(nullableString),
  judgeModelId: v.optional(nullableString),
  stepLimit: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
  ),
});

const updateSuiteBody = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
  description: v.optional(nullableString),
  judgeModelId: v.optional(nullableString),
  stepLimit: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
  ),
});

const questionsBody = v.object({
  questions: v.pipe(
    v.array(
      v.object({
        id: v.optional(v.pipe(v.string(), v.uuid())),
        question: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_QUESTION_LEN)),
        type: v.optional(questionType),
        expectedPageIds: v.optional(v.array(v.pipe(v.string(), v.uuid()))),
        expectedFacts: v.optional(v.array(v.pipe(v.string(), v.maxLength(500)))),
        active: v.optional(v.boolean()),
      }),
    ),
    v.maxLength(MAX_QUESTIONS_PER_SUITE),
  ),
});

const bulkBody = v.object({
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_BULK_CHARS)),
  type: v.optional(questionType),
});

const ok = { 200: { description: "Successful response" } };

export default function defineAiTestRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/ai-tests`;

  // list suites --------------------------------------------------------------
  app.get(
    `${base}/suites`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "List AI test suites",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const suites = await listSuites({ tenantId: tenantId });
      return c.json(suites);
    },
  );

  // create suite -------------------------------------------------------------
  app.post(
    `${base}/suites`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Create an AI test suite",
      responses: ok,
    }),
    validator("param", tenantParam),
    validator("json", createSuiteBody),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const body = c.req.valid("json");
      const suite = await createSuite(
        { tenantId: tenantId, userId: c.get("usersId") },
        body,
      );
      return c.json(suite);
    },
  );

  // get suite (with questions + recent runs) ---------------------------------
  app.get(
    `${base}/suites/:suiteId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Get a suite with its questions and recent runs",
      responses: ok,
    }),
    validator("param", suiteParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const [questions, runs] = await Promise.all([
        listQuestions(suiteId),
        listRuns(suiteId),
      ]);
      return c.json({ suite, questions, runs });
    },
  );

  // update suite -------------------------------------------------------------
  app.put(
    `${base}/suites/:suiteId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Update a suite's settings",
      responses: ok,
    }),
    validator("param", suiteParam),
    validator("json", updateSuiteBody),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const body = c.req.valid("json");
      const suite = await updateSuite(
        { tenantId: tenantId },
        suiteId,
        body,
      );
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      return c.json(suite);
    },
  );

  // delete suite -------------------------------------------------------------
  app.delete(
    `${base}/suites/:suiteId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Delete a suite",
      responses: ok,
    }),
    validator("param", suiteParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const deleted = await deleteSuite({ tenantId: tenantId }, suiteId);
      if (!deleted) throw new HTTPException(404, { message: "Suite not found" });
      return c.json({ success: true });
    },
  );

  // replace question list ----------------------------------------------------
  app.put(
    `${base}/suites/:suiteId/questions`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Replace a suite's question list (id-preserving)",
      responses: ok,
    }),
    validator("param", suiteParam),
    validator("json", questionsBody),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const { questions } = c.req.valid("json");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const saved = await setQuestions(
        { tenantId: tenantId },
        suiteId,
        questions,
      );
      return c.json(saved);
    },
  );

  // bulk-add questions -------------------------------------------------------
  app.post(
    `${base}/suites/:suiteId/questions/bulk`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Add questions from text, one per line",
      responses: ok,
    }),
    validator("param", suiteParam),
    validator("json", bulkBody),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const { text, type } = c.req.valid("json");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const existing = await listQuestions(suiteId);
      const incoming = text.split("\n").filter((l) => l.trim()).length;
      if (existing.length + incoming > MAX_QUESTIONS_PER_SUITE) {
        throw new HTTPException(400, {
          message: `A suite may hold at most ${MAX_QUESTIONS_PER_SUITE} questions`,
        });
      }
      const saved = await bulkAddQuestions(
        { tenantId: tenantId },
        suiteId,
        text,
        type,
      );
      return c.json(saved);
    },
  );

  // start a run now ----------------------------------------------------------
  app.post(
    `${base}/suites/:suiteId/run`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Trigger a run now (runs async in the background)",
      responses: ok,
    }),
    validator("param", suiteParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const run = await enqueueRun(
        { tenantId: tenantId, userId: c.get("usersId") },
        suiteId,
      );
      if (!run) throw new HTTPException(404, { message: "Suite not found" });
      return c.json(run, 202);
    },
  );

  // run history --------------------------------------------------------------
  app.get(
    `${base}/suites/:suiteId/runs`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "List a suite's runs",
      responses: ok,
    }),
    validator("param", suiteParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId } = c.req.valid("param");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const runs = await listRuns(suiteId);
      return c.json(runs);
    },
  );

  // run detail (with per-question results) -----------------------------------
  app.get(
    `${base}/suites/:suiteId/runs/:runId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Get a run with its per-question results",
      responses: ok,
    }),
    validator("param", runParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId, runId } = c.req.valid("param");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const run = await getRun(suiteId, runId);
      if (!run) throw new HTTPException(404, { message: "Run not found" });
      const results = await listRunResults(runId);
      return c.json({ run, results });
    },
  );

  // cancel a run -------------------------------------------------------------
  app.post(
    `${base}/suites/:suiteId/runs/:runId/cancel`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Cancel a running run",
      responses: ok,
    }),
    validator("param", runParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId, runId } = c.req.valid("param");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const run = await cancelRun(suiteId, runId);
      if (!run) throw new HTTPException(404, { message: "Run not found" });
      return c.json(run);
    },
  );

  // delete a run -------------------------------------------------------------
  app.delete(
    `${base}/suites/:suiteId/runs/:runId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["ai-tests"],
      summary: "Delete a run",
      responses: ok,
    }),
    validator("param", runParam),
    isTenantMember,
    async (c) => {
      const { tenantId, suiteId, runId } = c.req.valid("param");
      const suite = await getSuite({ tenantId: tenantId }, suiteId);
      if (!suite) throw new HTTPException(404, { message: "Suite not found" });
      const deleted = await deleteRun(suiteId, runId);
      if (!deleted) throw new HTTPException(404, { message: "Run not found" });
      return c.json({ success: true });
    },
  );
}
