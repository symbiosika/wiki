/**
 * Reward pipeline for the AI test suite — pure functions, no LLM, no IO.
 *
 * Everything here is deterministic so it can be unit-tested without a model or
 * a database. The runner (runner.ts) gathers the trajectory + judge report and
 * feeds them through {@link scoreQuestion}; the individual helpers are exported
 * so the heuristics can be tested in isolation.
 *
 * Signal layers (see the architecture abstract):
 *   A — deterministic tool-usage checks + metrics (this file)
 *   B — LLM-as-judge: relevance, claim decomposition, groundedness (runner.ts)
 *   C — optional reference data: expected pages (recall) + must-have facts
 *
 * Scoring: total = 0.25·toolUsage + 0.45·groundedness + 0.30·relevance,
 * blended 0.8/0.2 with the mean reference sub-score when reference data exists.
 * Hard gates override the weighting and force a `fail`.
 */
import type {
  AiTestClaim,
  AiTestMetrics,
  AiTestRunAggregates,
  AiTestScores,
  AiTestTrajectoryStep,
} from "../../db/schema";

export const SCORE_WEIGHTS = {
  toolUsage: 0.25,
  groundedness: 0.45,
  relevance: 0.3,
} as const;

/** Blend factor for reference sub-scores when reference data exists. */
export const REFERENCE_BLEND = 0.2;

export const PASS_THRESHOLD = 0.75;
export const WARN_THRESHOLD = 0.5;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ---- trajectory extraction --------------------------------------------------

/** Read-tool + failure counts derived purely from the trajectory. */
export interface ToolStats {
  totalToolCalls: number;
  searchCount: number;
  readCount: number;
  failedToolCalls: number;
  duplicateToolCalls: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

export function computeToolStats(steps: AiTestTrajectoryStep[]): ToolStats {
  const seen = new Set<string>();
  let searchCount = 0;
  let readCount = 0;
  let failedToolCalls = 0;
  let duplicateToolCalls = 0;

  for (const step of steps) {
    if (step.toolName === "search_wiki") searchCount++;
    if (step.toolName === "read_wiki_page") readCount++;
    if (!step.ok) failedToolCalls++;

    const key = `${step.toolName}:${JSON.stringify(step.input ?? null)}`;
    if (seen.has(key)) duplicateToolCalls++;
    else seen.add(key);
  }

  return {
    totalToolCalls: steps.length,
    searchCount,
    readCount,
    failedToolCalls,
    duplicateToolCalls,
  };
}

/** pageIds actually read via read_wiki_page (for recall against expected). */
export function extractReadPageIds(steps: AiTestTrajectoryStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.toolName !== "read_wiki_page") continue;
    const input = step.input;
    if (isRecord(input) && typeof input.pageId === "string") {
      ids.push(input.pageId);
    }
  }
  return ids;
}

/**
 * Every page title surfaced anywhere in the tool outputs. Used by the
 * invented-source hard gate: a title the answer cites that never appeared in
 * the trajectory is a fabricated citation. Collected generically (any string
 * under a `title` key) so it survives changes to the tool output shapes.
 */
export function extractTrajectoryPageTitles(
  steps: AiTestTrajectoryStep[],
): string[] {
  const titles = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "title" && typeof value === "string" && value.trim()) {
        titles.add(value.trim());
      } else if (typeof value === "object" && value !== null) {
        walk(value);
      }
    }
  };
  for (const step of steps) walk(step.output);
  return [...titles];
}

// ---- layer A: deterministic tool-usage score --------------------------------

/**
 * Tool-usage score 0–1. No tool calls at all ⇒ 0. Otherwise start at 1 and
 * subtract for missing search / missing read and for each failed or exactly
 * duplicated call.
 */
export function computeToolUsageScore(stats: ToolStats): number {
  if (stats.totalToolCalls === 0) return 0;
  let score = 1;
  if (stats.searchCount === 0) score -= 0.4;
  if (stats.readCount === 0) score -= 0.3;
  score -= 0.1 * stats.failedToolCalls;
  score -= 0.1 * stats.duplicateToolCalls;
  return clamp01(score);
}

// ---- layer B: groundedness --------------------------------------------------

/**
 * Whether this is the honest "the wiki has no answer" case: the answer says so,
 * makes no factual claims, and a real search was performed. Such a case is
 * treated as fully grounded (groundedness = 1) rather than penalised.
 */
export function isNoAnswerCase(input: {
  saysWikiHasNoAnswer: boolean;
  claims: AiTestClaim[] | undefined;
  searchCount: number;
}): boolean {
  return (
    input.saysWikiHasNoAnswer &&
    (input.claims?.length ?? 0) === 0 &&
    input.searchCount > 0
  );
}

/**
 * Groundedness = share of claims supported by the tool outputs. The honest
 * no-answer case scores 1. With no claims (and not a no-answer case) there is
 * nothing ungrounded, so it also scores 1 — answer emptiness is caught by
 * relevance and the hard gates, not here.
 */
export function computeGroundedness(
  claims: AiTestClaim[] | undefined,
  noAnswerCase: boolean,
): number {
  if (noAnswerCase) return 1;
  if (!claims || claims.length === 0) return 1;
  const supported = claims.filter((c) => c.verdict === "supported").length;
  return clamp01(supported / claims.length);
}

// ---- layer C: reference sub-scores ------------------------------------------

/** read∩expected / expected. null when no expected pages are configured. */
export function computePageRecall(
  readPageIds: string[],
  expectedPageIds: string[],
): number | null {
  if (expectedPageIds.length === 0) return null;
  const read = new Set(readPageIds);
  const hit = expectedPageIds.filter((id) => read.has(id)).length;
  return clamp01(hit / expectedPageIds.length);
}

/** covered / total. null when no must-have facts are configured. */
export function computeFactCoverage(
  factsCovered: { fact: string; covered: boolean }[] | undefined,
): number | null {
  if (!factsCovered || factsCovered.length === 0) return null;
  const covered = factsCovered.filter((f) => f.covered).length;
  return clamp01(covered / factsCovered.length);
}

/** Mean of the reference sub-scores that exist, or null when none do. */
export function computeReferenceScore(
  pageRecall: number | null,
  factCoverage: number | null,
): number | null {
  const parts = [pageRecall, factCoverage].filter(
    (v): v is number => v !== null,
  );
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

// ---- hard gates -------------------------------------------------------------

export interface HardGateInput {
  questionType: string;
  claims: AiTestClaim[] | undefined;
  citedPageTitles: string[] | undefined;
  trajectoryPageTitles: string[];
  hasToolCall: boolean;
  /** answer contains real content (not just "I couldn't find anything") */
  substantiveAnswer: boolean;
  saysWikiHasNoAnswer: boolean;
}

/** Case-insensitive, trimmed title match. */
const titleMatches = (cited: string, known: string[]): boolean => {
  const c = cited.trim().toLowerCase();
  return known.some((k) => k.trim().toLowerCase() === c);
};

/**
 * Hard-gate reasons. Any non-empty result forces a `fail` regardless of the
 * weighted score.
 */
export function computeHardGates(input: HardGateInput): string[] {
  const reasons: string[] = [];

  if (input.claims?.some((c) => c.verdict === "contradicted")) {
    reasons.push("contradicted-claim");
  }

  if (input.citedPageTitles && input.citedPageTitles.length > 0) {
    const invented = input.citedPageTitles.filter(
      (t) => t.trim() && !titleMatches(t, input.trajectoryPageTitles),
    );
    if (invented.length > 0) {
      reasons.push(`invented-source:${invented.join(", ")}`);
    }
  }

  if (input.substantiveAnswer && !input.hasToolCall) {
    reasons.push("answer-without-tools");
  }

  if (
    input.questionType === "not-in-wiki" &&
    input.substantiveAnswer &&
    !input.saysWikiHasNoAnswer
  ) {
    reasons.push("answered-not-in-wiki");
  }

  return reasons;
}

// ---- verdict + orchestration ------------------------------------------------

export type Verdict = "pass" | "warn" | "fail";

export function verdictFor(total: number, hardGates: string[]): Verdict {
  if (hardGates.length > 0) return "fail";
  if (total >= PASS_THRESHOLD) return "pass";
  if (total >= WARN_THRESHOLD) return "warn";
  return "fail";
}

export interface ScoreInput {
  steps: AiTestTrajectoryStep[];
  questionType: string;
  expectedPageIds: string[];
  // judge-derived
  relevance: number;
  claims: AiTestClaim[] | undefined;
  citedPageTitles: string[] | undefined;
  factsCovered: { fact: string; covered: boolean }[] | undefined;
  saysWikiHasNoAnswer: boolean;
  substantiveAnswer: boolean;
  // deterministic metrics
  durationMs: number;
  totalTokens: number;
}

export interface ScoreResult {
  scores: AiTestScores;
  verdict: Verdict;
  hardGateReasons: string[];
  noAnswerCase: boolean;
  /** true when unsupported claims suggest the model used its own knowledge */
  generalKnowledgeSuspected: boolean;
}

/** Full per-question scoring. Deterministic given the trajectory + judge data. */
export function scoreQuestion(input: ScoreInput): ScoreResult {
  const stats = computeToolStats(input.steps);
  const toolUsage = computeToolUsageScore(stats);

  const noAnswerCase = isNoAnswerCase({
    saysWikiHasNoAnswer: input.saysWikiHasNoAnswer,
    claims: input.claims,
    searchCount: stats.searchCount,
  });
  const groundedness = computeGroundedness(input.claims, noAnswerCase);
  const relevance = clamp01(input.relevance);

  const base =
    SCORE_WEIGHTS.toolUsage * toolUsage +
    SCORE_WEIGHTS.groundedness * groundedness +
    SCORE_WEIGHTS.relevance * relevance;

  const pageRecall = computePageRecall(
    extractReadPageIds(input.steps),
    input.expectedPageIds,
  );
  const factCoverage = computeFactCoverage(input.factsCovered);
  const reference = computeReferenceScore(pageRecall, factCoverage);

  const total =
    reference === null
      ? base
      : (1 - REFERENCE_BLEND) * base + REFERENCE_BLEND * reference;

  const hardGateReasons = computeHardGates({
    questionType: input.questionType,
    claims: input.claims,
    citedPageTitles: input.citedPageTitles,
    trajectoryPageTitles: extractTrajectoryPageTitles(input.steps),
    hasToolCall: stats.totalToolCalls > 0,
    substantiveAnswer: input.substantiveAnswer,
    saysWikiHasNoAnswer: input.saysWikiHasNoAnswer,
  });

  const generalKnowledgeSuspected =
    !noAnswerCase &&
    (input.claims?.some((c) => c.verdict === "unsupported") ?? false);

  const metrics: AiTestMetrics = {
    durationMs: input.durationMs,
    totalTokens: input.totalTokens,
    steps: stats.totalToolCalls,
    searchCount: stats.searchCount,
    readCount: stats.readCount,
    failedToolCalls: stats.failedToolCalls,
    duplicateToolCalls: stats.duplicateToolCalls,
    pageRecall,
  };

  const scores: AiTestScores = {
    toolUsage,
    groundedness,
    relevance,
    reference,
    total,
    metrics,
  };

  return {
    scores,
    verdict: verdictFor(total, hardGateReasons),
    hardGateReasons,
    noAnswerCase,
    generalKnowledgeSuspected,
  };
}

// ---- run-level aggregation --------------------------------------------------

/** Minimal per-result shape the aggregation needs. */
export interface AggregateItem {
  questionType: string;
  verdict: Verdict;
  toolUsage: number;
  groundedness: number;
  relevance: number;
  total: number;
  hardGate: boolean;
}

const mean = (nums: number[]): number =>
  nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;

/**
 * Run-level aggregates: overall means, pass-rate and hard-gate count, plus the
 * same broken down per question type. Ignores errored questions (they carry no
 * scores and should be passed in already filtered out).
 */
export function computeAggregates(items: AggregateItem[]): AiTestRunAggregates {
  const passRate = (list: AggregateItem[]): number =>
    list.length === 0
      ? 0
      : list.filter((i) => i.verdict === "pass").length / list.length;

  const grouped = new Map<string, AggregateItem[]>();
  for (const item of items) {
    const list = grouped.get(item.questionType) ?? [];
    list.push(item);
    grouped.set(item.questionType, list);
  }
  const byTypeResult: AiTestRunAggregates["byType"] = {};
  for (const [type, list] of grouped) {
    byTypeResult[type] = {
      count: list.length,
      passRate: passRate(list),
      meanTotal: mean(list.map((i) => i.total)),
    };
  }

  return {
    passRate: passRate(items),
    meanTotal: mean(items.map((i) => i.total)),
    meanToolUsage: mean(items.map((i) => i.toolUsage)),
    meanGroundedness: mean(items.map((i) => i.groundedness)),
    meanRelevance: mean(items.map((i) => i.relevance)),
    hardGateFails: items.filter((i) => i.hardGate).length,
    byType: byTypeResult,
  };
}
