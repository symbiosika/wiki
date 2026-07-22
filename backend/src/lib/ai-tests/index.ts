/**
 * AI test suites — business logic (CRUD layer).
 *
 * A suite owns a list of test questions and a run history. This module is the
 * CRUD layer; runner.ts drives the actual evaluation. Everything is scoped by
 * `organisationId` (== tenantId) so one tenant can never read or mutate
 * another tenant's suites.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import {
  aiTestSuites,
  aiTestQuestions,
  aiTestRuns,
  aiTestResults,
  AI_TEST_QUESTION_TYPES,
  type AiTestSuiteSelect,
  type AiTestQuestionSelect,
  type AiTestRunSelect,
  type AiTestResultSelect,
} from "../../db/schema";

export interface AiTestContext {
  organisationId: string;
  userId?: string;
}

const nowIso = () => new Date().toISOString();

type QuestionType = (typeof AI_TEST_QUESTION_TYPES)[number];

const normalizeType = (type?: string | null): QuestionType =>
  (AI_TEST_QUESTION_TYPES as readonly string[]).includes(type ?? "")
    ? (type as QuestionType)
    : "answerable";

// ---- suites -----------------------------------------------------------------

export interface CreateSuiteInput {
  name: string;
  description?: string | null;
  judgeModelId?: string | null;
  stepLimit?: number | null;
}

export const createSuite = async (
  ctx: AiTestContext,
  input: CreateSuiteInput,
): Promise<AiTestSuiteSelect> => {
  const rows = await getDb()
    .insert(aiTestSuites)
    .values({
      organisationId: ctx.organisationId,
      name: input.name,
      description: input.description ?? null,
      judgeModelId: input.judgeModelId ?? null,
      stepLimit: input.stepLimit ?? null,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  return rows[0]!;
};

export const listSuites = async (
  ctx: AiTestContext,
): Promise<AiTestSuiteSelect[]> =>
  getDb()
    .select()
    .from(aiTestSuites)
    .where(eq(aiTestSuites.organisationId, ctx.organisationId))
    .orderBy(desc(aiTestSuites.createdAt));

export const getSuite = async (
  ctx: AiTestContext,
  suiteId: string,
): Promise<AiTestSuiteSelect | null> => {
  const rows = await getDb()
    .select()
    .from(aiTestSuites)
    .where(
      and(
        eq(aiTestSuites.id, suiteId),
        eq(aiTestSuites.organisationId, ctx.organisationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

export interface UpdateSuiteInput {
  name?: string;
  description?: string | null;
  judgeModelId?: string | null;
  stepLimit?: number | null;
}

export const updateSuite = async (
  ctx: AiTestContext,
  suiteId: string,
  input: UpdateSuiteInput,
): Promise<AiTestSuiteSelect | null> => {
  const existing = await getSuite(ctx, suiteId);
  if (!existing) return null;
  const rows = await getDb()
    .update(aiTestSuites)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.judgeModelId !== undefined && {
        judgeModelId: input.judgeModelId,
      }),
      ...(input.stepLimit !== undefined && { stepLimit: input.stepLimit }),
      updatedAt: nowIso(),
    })
    .where(eq(aiTestSuites.id, suiteId))
    .returning();
  return rows[0] ?? null;
};

export const deleteSuite = async (
  ctx: AiTestContext,
  suiteId: string,
): Promise<boolean> => {
  const existing = await getSuite(ctx, suiteId);
  if (!existing) return false;
  // questions + runs + results cascade via FK
  await getDb().delete(aiTestSuites).where(eq(aiTestSuites.id, suiteId));
  return true;
};

// ---- questions --------------------------------------------------------------

export const listQuestions = async (
  suiteId: string,
): Promise<AiTestQuestionSelect[]> =>
  getDb()
    .select()
    .from(aiTestQuestions)
    .where(eq(aiTestQuestions.suiteId, suiteId))
    .orderBy(asc(aiTestQuestions.sortOrder), asc(aiTestQuestions.createdAt));

export const getActiveQuestions = async (
  suiteId: string,
): Promise<AiTestQuestionSelect[]> => {
  const all = await listQuestions(suiteId);
  return all.filter((q) => q.active);
};

export interface QuestionInput {
  /** present for existing rows so their id (and thus time series) survives */
  id?: string;
  question: string;
  type?: string;
  expectedPageIds?: string[];
  expectedFacts?: string[];
  active?: boolean;
}

/**
 * Replace a suite's question list, preserving the ids of rows that stay so
 * per-question time series survive an edit. Rows carrying a known id are
 * updated in place; new rows are inserted; rows no longer present are deleted.
 * Order follows the input list.
 */
export const setQuestions = async (
  ctx: AiTestContext,
  suiteId: string,
  items: QuestionInput[],
): Promise<AiTestQuestionSelect[]> => {
  const db = getDb();
  const existing = await listQuestions(suiteId);
  const existingIds = new Set(existing.map((q) => q.id));
  const keepIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const values = {
      question: item.question,
      type: normalizeType(item.type),
      expectedPageIds: item.expectedPageIds ?? [],
      expectedFacts: item.expectedFacts ?? [],
      active: item.active ?? true,
      sortOrder: i,
      updatedAt: nowIso(),
    };
    if (item.id && existingIds.has(item.id)) {
      keepIds.add(item.id);
      await db
        .update(aiTestQuestions)
        .set(values)
        .where(eq(aiTestQuestions.id, item.id));
    } else {
      const inserted = await db
        .insert(aiTestQuestions)
        .values({
          suiteId,
          organisationId: ctx.organisationId,
          ...values,
        })
        .returning();
      keepIds.add(inserted[0]!.id);
    }
  }

  const toDelete = existing
    .filter((q) => !keepIds.has(q.id))
    .map((q) => q.id);
  if (toDelete.length > 0) {
    await db
      .delete(aiTestQuestions)
      .where(inArray(aiTestQuestions.id, toDelete));
  }

  return listQuestions(suiteId);
};

/**
 * Append questions from a plain-text block — one question per line. This is
 * how the real customer-question list is imported. Empty lines are ignored;
 * new rows are appended after the existing ones.
 */
export const bulkAddQuestions = async (
  ctx: AiTestContext,
  suiteId: string,
  text: string,
  type: string = "answerable",
): Promise<AiTestQuestionSelect[]> => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return listQuestions(suiteId);

  const existing = await listQuestions(suiteId);
  const base = existing.length;
  const normalizedType = normalizeType(type);

  await getDb()
    .insert(aiTestQuestions)
    .values(
      lines.map((question, i) => ({
        suiteId,
        organisationId: ctx.organisationId,
        question,
        type: normalizedType,
        sortOrder: base + i,
      })),
    );

  return listQuestions(suiteId);
};

// ---- runs -------------------------------------------------------------------

export const listRuns = async (
  suiteId: string,
  limit = 20,
): Promise<AiTestRunSelect[]> =>
  getDb()
    .select()
    .from(aiTestRuns)
    .where(eq(aiTestRuns.suiteId, suiteId))
    .orderBy(desc(aiTestRuns.startedAt))
    .limit(limit);

export const getRun = async (
  suiteId: string,
  runId: string,
): Promise<AiTestRunSelect | null> => {
  const rows = await getDb()
    .select()
    .from(aiTestRuns)
    .where(and(eq(aiTestRuns.id, runId), eq(aiTestRuns.suiteId, suiteId)))
    .limit(1);
  return rows[0] ?? null;
};

export const listRunResults = async (
  runId: string,
): Promise<AiTestResultSelect[]> =>
  getDb()
    .select()
    .from(aiTestResults)
    .where(eq(aiTestResults.runId, runId))
    .orderBy(asc(aiTestResults.createdAt));

export const deleteRun = async (
  suiteId: string,
  runId: string,
): Promise<boolean> => {
  const existing = await getRun(suiteId, runId);
  if (!existing) return false;
  // results cascade via FK
  await getDb().delete(aiTestRuns).where(eq(aiTestRuns.id, runId));
  return true;
};
