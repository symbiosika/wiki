/**
 * Run the wiki agent once against a single test question.
 *
 * Production parity is the whole point: this drives the *same* agent config as
 * the live chat (see ai/wiki-agent.ts), just non-streaming (`generateText`) so
 * we can inspect the full trajectory, the final answer and the token usage
 * after the fact. It runs in read mode with the run-starter's permissions, so
 * a run sees exactly the pages that user sees.
 *
 * `AI_TESTS_DEV_STUB=true` (read at import time) short-circuits the model with
 * a fixed answer + a plausible fake trajectory, so route/runner tests are
 * deterministic and need no OPENROUTER_API_KEY.
 */
import { generateText } from "ai";
import { getChatAgentConfig } from "../chat-config/store";
import { buildWikiAgentConfig } from "../../ai/wiki-agent";
import type {
  AiTestTrajectory,
  AiTestTrajectoryStep,
} from "../../db/schema";

const DEV_STUB = process.env.AI_TESTS_DEV_STUB === "true";

/** How much of each tool output is kept in the stored trajectory. */
const STORED_OUTPUT_CHARS = 4000;

/** Wall-clock cap for a single agent run. */
export const AGENT_TIMEOUT_MS = 120_000;

export interface AgentRunResult {
  answer: string;
  trajectory: AiTestTrajectory;
  /** ungekürzte, concatenated tool outputs — the judge's only source of truth */
  fullToolOutputs: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const clip = (text: string, max: number): string =>
  text.length <= max
    ? text
    : `${text.slice(0, max)}\n…[truncated, ${text.length - max} more characters]`;

const stringifyOutput = (output: unknown): string => {
  try {
    return typeof output === "string" ? output : JSON.stringify(output);
  } catch {
    return String(output);
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const outputOk = (output: unknown): boolean =>
  !(isRecord(output) && output.success === false);

/** Build a stub trajectory that exercises a search + a read of a real-ish page. */
function stubResult(question: string): AgentRunResult {
  const steps: AiTestTrajectoryStep[] = [
    {
      index: 0,
      toolName: "search_wiki",
      input: { query: question },
      output: {
        success: true,
        count: 1,
        results: [
          { pageId: "stub-page-1", title: "Stub Page", path: "Stub Page" },
        ],
      },
      ok: true,
    },
    {
      index: 1,
      toolName: "read_wiki_page",
      input: { pageId: "stub-page-1" },
      output: {
        success: true,
        pageId: "stub-page-1",
        title: "Stub Page",
        content: "This is stub wiki content used for deterministic tests.",
      },
      ok: true,
    },
  ];
  return {
    answer:
      "According to the Stub Page, this is a deterministic stub answer for testing.",
    trajectory: { steps, stepCount: steps.length, finishReason: "stop" },
    fullToolOutputs: steps.map((s) => stringifyOutput(s.output)).join("\n\n"),
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  };
}

/**
 * Run the agent for one question. `stepLimit` overrides the default agent step
 * budget (suite-configurable). Throws on timeout or model error — the runner
 * catches it per question so one failure never aborts the whole run.
 */
export async function runAgentForQuestion(params: {
  tenantId: string;
  userId: string;
  question: string;
  stepLimit?: number | null;
}): Promise<AgentRunResult> {
  if (DEV_STUB) return stubResult(params.question);

  const { systemPrompt: orgSystemPrompt } = await getChatAgentConfig(
    params.tenantId,
  );

  const config = buildWikiAgentConfig({
    tenantId: params.tenantId,
    userId: params.userId,
    mode: "read",
    orgSystemPrompt,
    stepLimit: params.stepLimit ?? undefined,
  });

  const result = await withTimeout(
    generateText({ ...config, prompt: params.question }),
    AGENT_TIMEOUT_MS,
  );

  const steps: AiTestTrajectoryStep[] = [];
  const fullOutputs: string[] = [];
  let index = 0;
  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      const output = (toolResult as { output: unknown }).output;
      const full = stringifyOutput(output);
      fullOutputs.push(full);
      steps.push({
        index: index++,
        toolName: toolResult.toolName,
        input: (toolResult as { input: unknown }).input,
        output: clip(full, STORED_OUTPUT_CHARS),
        ok: outputOk(output),
      });
    }
  }

  const usage = result.totalUsage;
  return {
    answer: result.text ?? "",
    trajectory: {
      steps,
      stepCount: steps.length,
      finishReason: result.finishReason,
    },
    fullToolOutputs: fullOutputs.join("\n\n"),
    usage: {
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Agent run timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
