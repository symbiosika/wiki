/**
 * Bridge tenant-managed agents into the framework post-processor pipeline.
 *
 * A post-processing agent is selectable wherever `usePostProcessors` already
 * works, under the conventional name `agent:<uuid>`. Because the framework only
 * consults its static registry, each agent is registered as a real
 * PostProcessor — at boot for existing agents, and on create for new ones (see
 * registerAgentPostProcessor). The registered `execute` re-loads the config
 * from the DB on every run, so prompt edits need no re-registration and
 * deleted/disabled agents fail cleanly.
 *
 * Security boundary: the processor loads the agent scoped to the *importing*
 * tenant (`input.context.tenantId`). A foreign tenant selecting
 * `agent:<id>` of another tenant gets a clean "not found" — it can never run or
 * even probe another tenant's agent.
 */
import log from "@framework/lib/log";
import {
  type PostProcessor,
  type PostProcessorInput,
  type PostProcessorOutput,
  type PostProcessorResolver,
} from "@framework/index";
import { getAgentForTenant } from "./store";
import { runPostProcessingAgent } from "./runner";

/** Conventional post-processor name for a tenant agent. */
export const agentProcessorName = (agentId: string): string =>
  `agent:${agentId}`;

/**
 * Skip the agent (and record why) when the input is larger than this many
 * approximate tokens. Default ~400k tokens ≈ 1.6 MB of text. Overridable via
 * POSTPROCESSING_MAX_INPUT_TOKENS.
 */
const maxInputTokens = (): number => {
  const raw = Number(process.env.POSTPROCESSING_MAX_INPUT_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : 400_000;
};

const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Build a PostProcessor for a specific agent id. The returned `execute` is
 * tenant-safe and re-loads the agent config on every run.
 */
export const buildAgentPostProcessor = (agentId: string): PostProcessor => ({
  name: agentProcessorName(agentId),
  // Kept generic on purpose: the global post-processors listing endpoint is
  // cross-tenant, so no tenant-specific name/description is exposed there.
  label: "Custom agent",
  description: "",
  execute: async (
    input: PostProcessorInput,
  ): Promise<PostProcessorOutput> => {
    const tenantId = input.context.tenantId;

    // Security boundary: scope the load to the importing tenant.
    const agent = await getAgentForTenant(tenantId, agentId);
    if (!agent) {
      throw new Error(
        `Post-processing agent ${agentId} not found for this tenant.`,
      );
    }
    if (!agent.enabled) {
      throw new Error(`Post-processing agent "${agent.name}" is disabled.`);
    }

    const inputChars = input.text.length;

    // Phase 5 input-size guard: skip huge documents rather than risk a timeout,
    // but never fail the import — return the text unchanged with a marker.
    const tokens = approxTokens(input.text);
    if (tokens > maxInputTokens()) {
      log.info(
        `[post-processing-agent] skipped agentId=${agentId} tenant=${tenantId} ` +
          `reason=too_large inputChars=${inputChars} approxTokens=${tokens}`,
      );
      return {
        text: input.text,
        // omit pages — but text is unchanged so the previous mapping is fine;
        // still drop it to stay consistent with the "agent may rewrite" model.
        title: input.title,
        meta: {
          postProcessing: {
            agentId,
            agentName: agent.name,
            skipped: "too_large",
            approxTokens: tokens,
          },
        },
      };
    }

    const startedAt = Date.now();
    const result = await runPostProcessingAgent({
      text: input.text,
      title: input.title,
      instructions: agent.prompt,
      modelId: agent.modelId ?? undefined,
      maxSteps: agent.maxSteps ?? undefined,
    });
    const durationMs = Date.now() - startedAt;

    log.info(
      `[post-processing-agent] ran agentId=${agentId} tenant=${tenantId} ` +
        `inputChars=${inputChars} editCount=${result.editCount} ` +
        `aborted=${result.aborted} durationMs=${durationMs}`,
    );

    // If the run aborted without landing a single edit, the rewrite is
    // worthless — keep the original text so the import still succeeds.
    const useOriginal = result.aborted && result.editCount === 0;

    return {
      // Omit `pages`: an agentic rewrite invalidates the page mapping by design
      // (the pipeline drops page-level metadata; see post-processors.ts).
      text: useOriginal ? input.text : result.text,
      title: result.title ?? input.title,
      meta: {
        ...(result.meta ?? {}),
        postProcessing: {
          agentId,
          agentName: agent.name,
          summary: result.summary,
          editCount: result.editCount,
          aborted: result.aborted,
        },
      },
    };
  },
});

/**
 * A single resolver for every tenant agent. Registered once at app start via
 * `customPostProcessorResolvers`. It matches the `agent:<uuid>` naming
 * convention and builds a tenant-safe processor on the fly — so tenant agents
 * are never entered into the global registry (no cross-tenant leakage through
 * the global post-processors listing) and CRUD needs no registry mutation.
 */
export const agentPostProcessorResolver: PostProcessorResolver = (name) => {
  if (!name.startsWith("agent:")) return undefined;
  const agentId = name.slice("agent:".length);
  if (!agentId) return undefined;
  return buildAgentPostProcessor(agentId);
};
