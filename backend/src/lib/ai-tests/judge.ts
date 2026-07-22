/**
 * LLM-as-judge for a single answer. At most two structured calls per question:
 *
 *   Call 1 (combined): answer relevance (0–1 + reasoning), a "the wiki has no
 *     answer" flag, the page titles the answer cites, optional must-have-fact
 *     coverage, and the decomposition of the answer into atomic factual claims.
 *   Call 2 (only when there are claims): each claim is checked against the
 *     concatenated tool outputs → supported | unsupported | contradicted.
 *
 * The judge's hard rule (in the prompt): only the tool outputs count as truth,
 * the judge's own world knowledge does not. That is what turns "unsupported"
 * into a model-knowledge / hallucination signal.
 *
 * Uses `generateJudgeObject` so the judge model is overridable per suite and
 * the token usage is captured. `AI_TESTS_DEV_STUB=true` returns fixed output.
 */
import * as v from "valibot";
import { generateJudgeObject } from "../../ai";
import type { AiTestClaim } from "../../db/schema";

const DEV_STUB = process.env.AI_TESTS_DEV_STUB === "true";

const call1Schema = v.object({
  relevance: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  relevanceReasoning: v.string(),
  saysWikiHasNoAnswer: v.boolean(),
  citedPageTitles: v.array(v.string()),
  factsCovered: v.array(
    v.object({ fact: v.string(), covered: v.boolean() }),
  ),
  claims: v.array(v.string()),
});

const call2Schema = v.object({
  verdicts: v.array(
    v.object({
      claim: v.string(),
      verdict: v.picklist(["supported", "unsupported", "contradicted"]),
      reasoning: v.string(),
    }),
  ),
});

export interface JudgeInput {
  question: string;
  questionType: string;
  answer: string;
  /** ungekürzte, concatenated tool outputs — the ONLY source of truth */
  toolOutputs: string;
  expectedFacts: string[];
  judgeModelId?: string | null;
}

export interface JudgeResult {
  relevance: number;
  relevanceReasoning: string;
  saysWikiHasNoAnswer: boolean;
  citedPageTitles: string[];
  factsCovered: { fact: string; covered: boolean }[];
  claims: AiTestClaim[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const zeroUsage = () => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

function stubJudge(input: JudgeInput): JudgeResult {
  return {
    relevance: 1,
    relevanceReasoning: "Stub judge: deterministic pass.",
    saysWikiHasNoAnswer: false,
    citedPageTitles: ["Stub Page"],
    factsCovered: input.expectedFacts.map((fact) => ({ fact, covered: true })),
    claims: [
      {
        claim: "Stub claim from the answer.",
        verdict: "supported",
        reasoning: "Stub judge: supported by stub tool output.",
      },
    ],
    usage: zeroUsage(),
  };
}

const JUDGE_SYSTEM = `You are a strict, impartial evaluator of an AI wiki assistant's answer.
Core rule: the assistant may ONLY use the wiki's own content, surfaced through tool outputs. When you judge whether a statement is supported, the ONLY source of truth is the provided tool outputs — your own world knowledge does NOT count and must never be used to mark something supported. If a statement is not backed by the tool outputs, it is unsupported even if you personally know it to be true. Be terse and objective in every reasoning field.`;

export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  if (DEV_STUB) return stubJudge(input);

  const factsBlock =
    input.expectedFacts.length > 0
      ? `\n\nThe answer SHOULD cover these facts (mark each covered true/false):\n${input.expectedFacts
          .map((f, i) => `${i + 1}. ${f}`)
          .join("\n")}`
      : "\n\nThere are no must-have facts configured; return an empty factsCovered array.";

  const call1Prompt = `Question (type: ${input.questionType}):
${input.question}

The assistant's answer:
${input.answer}

Evaluate and return JSON:
- relevance (0..1): how well the answer addresses the question, in the question's language, with sources. 0 = irrelevant/empty, 1 = fully on point.
- relevanceReasoning: one or two sentences.
- saysWikiHasNoAnswer: true if the answer honestly states the wiki does not contain the information (rather than answering).
- citedPageTitles: the exact page titles the answer references/cites (empty if none).
- factsCovered: for each must-have fact, whether the answer covers it.
- claims: decompose the answer into atomic, individually-checkable factual statements (exclude hedging, questions, and pure meta-commentary). Empty if the answer makes no factual claims.${factsBlock}`;

  const call1 = await generateJudgeObject({
    schema: call1Schema,
    system: JUDGE_SYSTEM,
    prompt: call1Prompt,
    modelId: input.judgeModelId ?? undefined,
  });

  const usage = {
    promptTokens: call1.usage.inputTokens ?? 0,
    completionTokens: call1.usage.outputTokens ?? 0,
    totalTokens: call1.usage.totalTokens ?? 0,
  };

  let claims: AiTestClaim[] = [];
  if (call1.object.claims.length > 0) {
    const call2Prompt = `Below are the ONLY tool outputs the assistant had access to (the wiki content it retrieved). Treat them as the sole source of truth.

=== TOOL OUTPUTS START ===
${input.toolOutputs || "(no tool outputs)"}
=== TOOL OUTPUTS END ===

For EACH claim, decide strictly against the tool outputs above:
- "supported": the tool outputs directly back this claim.
- "unsupported": the tool outputs neither state nor contradict it (likely the model's own knowledge).
- "contradicted": the tool outputs state the opposite.

Claims:
${call1.object.claims.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;

    const call2 = await generateJudgeObject({
      schema: call2Schema,
      system: JUDGE_SYSTEM,
      prompt: call2Prompt,
      modelId: input.judgeModelId ?? undefined,
    });

    usage.promptTokens += call2.usage.inputTokens ?? 0;
    usage.completionTokens += call2.usage.outputTokens ?? 0;
    usage.totalTokens += call2.usage.totalTokens ?? 0;

    claims = call2.object.verdicts.map((verdictEntry) => ({
      claim: verdictEntry.claim,
      verdict: verdictEntry.verdict,
      reasoning: verdictEntry.reasoning,
    }));
  }

  return {
    relevance: call1.object.relevance,
    relevanceReasoning: call1.object.relevanceReasoning,
    saysWikiHasNoAnswer: call1.object.saysWikiHasNoAnswer,
    citedPageTitles: call1.object.citedPageTitles,
    factsCovered: call1.object.factsCovered,
    claims,
    usage,
  };
}
