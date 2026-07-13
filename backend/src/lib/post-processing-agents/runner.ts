/**
 * Abstract agentic post-processing runner.
 *
 * Loads a parsed document into a {@link VirtualDocument} and lets a language
 * model rework it via coding-agent-style tools (outline, windowed reads,
 * search, line-range edits). The scaffold is reusable: concrete post-processors
 * differ only by the injected task profile (`instructions`) and optional
 * model/step overrides. The full text never enters the model context — the
 * agent works through windows — so 500-page documents are workable.
 *
 * Failure is non-fatal by design: on any LLM/tool-loop error we return the
 * document's current state with `aborted: true`, so the caller (the post
 * processor) can still complete the import rather than losing it.
 */
import { generateText, Output, stepCountIs } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import * as v from "valibot";
import { getModel, assertOpenRouterConfigured } from "../../ai";
import { VirtualDocument } from "./virtual-document";
import { createVirtualDocumentTools, type AgentOutputSink } from "./tools";

const DEV_STUB = process.env.POSTPROCESSING_DEV_STUB === "true";

const DEFAULT_MAX_STEPS = 40;
const HARD_MAX_STEPS = 100;
const DEFAULT_TIMEOUT_MS = 240_000;

export type RunPostProcessingAgentParams = {
  text: string;
  title?: string;
  /** the per-agent task profile (what the UI-managed agents differ by) */
  instructions: string;
  /** OpenRouter model id override; defaults to AI_MODEL_ID from ../ai */
  modelId?: string;
  /** step budget; default 40, hard-capped at 100 */
  maxSteps?: number;
  /** wall-clock budget; default 240s, aborts the loop via AbortSignal */
  timeoutMs?: number;
};

export type RunPostProcessingAgentResult = {
  /** the final virtual-document content */
  text: string;
  title?: string;
  meta?: Record<string, unknown>;
  /** short natural-language description of what was done */
  summary: string;
  /** number of document mutations applied */
  editCount: number;
  /** true if the step/time budget was hit or the loop errored — best effort */
  aborted: boolean;
};

const SCAFFOLD = `You are a document post-processing agent. A document was parsed from an external
source (usually PDF→markdown) and is loaded as a virtual document you edit via tools.

METHOD
1. Orient: call doc_stats and view_outline first. Never ask for the full text of a
   large document; work through it in windows.
2. Plan top-down: fix global noise first (repeated headers/footers, page numbers,
   broken hyphenation) via search_document + replace_exact(replaceAll) — then
   restructure section by section with read_lines + replace_lines.
3. After each replace_lines, line numbers change. Trust the returned totalLines and
   re-read before the next range edit. Use the anchor parameters.
4. Keep the result clean GitHub-flavored markdown with a sensible heading hierarchy
   (# / ## used for top-level sections — the importer splits blocks at these).
5. Preserve ALL substantive information unless the task profile says otherwise.
   You clean and restructure; you do not summarize away content.
6. Optionally set a better title (set_title) and structured metadata (set_meta).
7. Finish by returning a one/two-sentence summary of what you changed.

TASK PROFILE (what this specific agent is for):
`;

const buildSystemPrompt = (instructions: string): string =>
  `${SCAFFOLD}${instructions.trim()}`;

/**
 * Deterministic dev stub — no LLM, no network. Prepends a marker so the whole
 * import → post-process → store flow can be exercised without an OpenRouter key
 * (mirrors PROTOCOL_DEV_STUB in ../knowledge/document-agent.ts).
 */
const runDevStub = (
  params: RunPostProcessingAgentParams,
): RunPostProcessingAgentResult => {
  const marker = "<!-- post-processed (dev stub) -->";
  const text = params.text.startsWith(marker)
    ? params.text
    : `${marker}\n${params.text}`;
  return {
    text,
    title: params.title,
    meta: {},
    summary: "Dev stub: prepended a marker (no LLM was called).",
    editCount: 1,
    aborted: false,
  };
};

export const runPostProcessingAgent = async (
  params: RunPostProcessingAgentParams,
): Promise<RunPostProcessingAgentResult> => {
  if (DEV_STUB) {
    return runDevStub(params);
  }

  const doc = new VirtualDocument(params.text);
  const out: AgentOutputSink = { title: params.title, meta: {} };

  const maxSteps = Math.min(
    HARD_MAX_STEPS,
    Math.max(1, Math.floor(params.maxSteps ?? DEFAULT_MAX_STEPS)),
  );
  const timeoutMs =
    Number.isFinite(params.timeoutMs) && (params.timeoutMs ?? 0) > 0
      ? params.timeoutMs!
      : DEFAULT_TIMEOUT_MS;

  const finalize = (
    summary: string,
    aborted: boolean,
  ): RunPostProcessingAgentResult => ({
    text: doc.getContent(),
    title: out.title,
    meta: out.meta,
    summary,
    editCount: doc.version,
    aborted,
  });

  try {
    assertOpenRouterConfigured();
    const tools = createVirtualDocumentTools(doc, out);

    const result = await generateText({
      model: getModel(params.modelId),
      system: buildSystemPrompt(params.instructions),
      prompt:
        `A document titled "${params.title ?? "(untitled)"}" is loaded as a virtual ` +
        `document. Post-process it according to your task profile. Start by calling ` +
        `doc_stats and view_outline.`,
      tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal: AbortSignal.timeout(timeoutMs),
      experimental_output: Output.object({
        schema: valibotSchema(v.object({ summary: v.string() })),
      }),
    });

    const summary =
      result.experimental_output?.summary?.trim() ||
      (doc.version > 0
        ? "Document post-processed."
        : "No changes were necessary.");
    return finalize(summary, false);
  } catch (e) {
    // Non-fatal: keep whatever edits already landed and let the caller decide
    // whether to fall back to the unprocessed text.
    const message = (e as Error).message ?? String(e);
    return finalize(`Post-processing aborted: ${message}`, true);
  }
};
