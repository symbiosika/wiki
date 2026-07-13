/**
 * Post-processing agents — org-scoped CRUD.
 *
 * A post-processing agent is a tenant-managed config (name + prompt, plus
 * optional model/step overrides) that the reusable runner in ./runner.ts turns
 * into an actual document-reworking agent. Every read and write filters by
 * `organisationId`: the row id is never trusted on its own, so one tenant can
 * never read, mutate, run, or even probe another tenant's agents.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import {
  postProcessingAgents,
  type PostProcessingAgentSelect,
} from "../../db/schema";

export interface AgentContext {
  organisationId: string;
  userId?: string;
}

const nowIso = () => new Date().toISOString();

const MAX_STEPS_LIMIT = 100;

/** Validate the shared, user-editable fields. Throws on invalid input. */
const assertValidAgentInput = (input: {
  name?: string;
  prompt?: string;
  maxSteps?: number | null;
}): void => {
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new Error("name must not be empty.");
  }
  if (input.prompt !== undefined && input.prompt.trim().length === 0) {
    throw new Error("prompt must not be empty.");
  }
  if (
    input.maxSteps !== undefined &&
    input.maxSteps !== null &&
    (!Number.isInteger(input.maxSteps) ||
      input.maxSteps < 1 ||
      input.maxSteps > MAX_STEPS_LIMIT)
  ) {
    throw new Error(`maxSteps must be an integer between 1 and ${MAX_STEPS_LIMIT}.`);
  }
};

export const listAgents = async (
  ctx: AgentContext,
): Promise<PostProcessingAgentSelect[]> =>
  getDb()
    .select()
    .from(postProcessingAgents)
    .where(eq(postProcessingAgents.organisationId, ctx.organisationId))
    .orderBy(desc(postProcessingAgents.updatedAt));

/** Only the enabled agents — used to populate the import dialog picker. */
export const listEnabledAgents = async (
  ctx: AgentContext,
): Promise<PostProcessingAgentSelect[]> =>
  getDb()
    .select()
    .from(postProcessingAgents)
    .where(
      and(
        eq(postProcessingAgents.organisationId, ctx.organisationId),
        eq(postProcessingAgents.enabled, true),
      ),
    )
    .orderBy(desc(postProcessingAgents.updatedAt));

export const getAgentById = async (
  ctx: AgentContext,
  id: string,
): Promise<PostProcessingAgentSelect | null> => {
  const rows = await getDb()
    .select()
    .from(postProcessingAgents)
    .where(
      and(
        eq(postProcessingAgents.id, id),
        eq(postProcessingAgents.organisationId, ctx.organisationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

export interface CreateAgentInput {
  name: string;
  description?: string | null;
  prompt: string;
  modelId?: string | null;
  maxSteps?: number | null;
  enabled?: boolean;
}

export const createAgent = async (
  ctx: AgentContext,
  input: CreateAgentInput,
): Promise<PostProcessingAgentSelect> => {
  assertValidAgentInput(input);
  const rows = await getDb()
    .insert(postProcessingAgents)
    .values({
      organisationId: ctx.organisationId,
      name: input.name.trim(),
      description: input.description ?? null,
      prompt: input.prompt,
      modelId: input.modelId ?? null,
      maxSteps: input.maxSteps ?? null,
      enabled: input.enabled ?? true,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  return rows[0]!;
};

export interface UpdateAgentInput {
  name?: string;
  description?: string | null;
  prompt?: string;
  modelId?: string | null;
  maxSteps?: number | null;
  enabled?: boolean;
}

export const updateAgent = async (
  ctx: AgentContext,
  id: string,
  input: UpdateAgentInput,
): Promise<PostProcessingAgentSelect | null> => {
  assertValidAgentInput(input);
  const existing = await getAgentById(ctx, id);
  if (!existing) return null;
  const rows = await getDb()
    .update(postProcessingAgents)
    .set({
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.prompt !== undefined && { prompt: input.prompt }),
      ...(input.modelId !== undefined && { modelId: input.modelId }),
      ...(input.maxSteps !== undefined && { maxSteps: input.maxSteps }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(postProcessingAgents.id, id),
        eq(postProcessingAgents.organisationId, ctx.organisationId),
      ),
    )
    .returning();
  return rows[0] ?? null;
};

export const deleteAgent = async (
  ctx: AgentContext,
  id: string,
): Promise<boolean> => {
  const existing = await getAgentById(ctx, id);
  if (!existing) return false;
  await getDb()
    .delete(postProcessingAgents)
    .where(
      and(
        eq(postProcessingAgents.id, id),
        eq(postProcessingAgents.organisationId, ctx.organisationId),
      ),
    );
  return true;
};
