import { describe, test, expect } from "bun:test";
import {
  computeToolStats,
  computeToolUsageScore,
  computePageRecall,
  computeFactCoverage,
  computeReferenceScore,
  computeGroundedness,
  isNoAnswerCase,
  computeHardGates,
  verdictFor,
  scoreQuestion,
  computeAggregates,
  type AggregateItem,
} from "./reward";
import type { AiTestClaim, AiTestTrajectoryStep } from "../../db/schema";

const step = (
  toolName: string,
  input: unknown,
  ok = true,
  output: unknown = { success: ok },
): AiTestTrajectoryStep => ({ index: 0, toolName, input, output, ok });

const goodTrajectory = (): AiTestTrajectoryStep[] => [
  step("search_wiki", { query: "vacation" }, true, {
    success: true,
    results: [{ pageId: "p1", title: "Vacation Policy" }],
  }),
  step("read_wiki_page", { pageId: "p1" }, true, {
    success: true,
    pageId: "p1",
    title: "Vacation Policy",
    content: "30 days",
  }),
];

describe("computeToolStats", () => {
  test("counts search, read, failed and duplicate calls", () => {
    const steps: AiTestTrajectoryStep[] = [
      step("search_wiki", { query: "a" }),
      step("search_wiki", { query: "a" }), // exact duplicate
      step("read_wiki_page", { pageId: "p1" }),
      step("read_wiki_page", { pageId: "p2" }, false, { success: false }),
    ];
    const stats = computeToolStats(steps);
    expect(stats.totalToolCalls).toBe(4);
    expect(stats.searchCount).toBe(2);
    expect(stats.readCount).toBe(2);
    expect(stats.failedToolCalls).toBe(1);
    expect(stats.duplicateToolCalls).toBe(1);
  });
});

describe("computeToolUsageScore", () => {
  test("is 0 with no tool calls", () => {
    expect(
      computeToolUsageScore(computeToolStats([])),
    ).toBe(0);
  });

  test("is 1 for a clean search + read", () => {
    expect(computeToolUsageScore(computeToolStats(goodTrajectory()))).toBe(1);
  });

  test("penalises missing search and read", () => {
    const onlyRead = computeToolUsageScore(
      computeToolStats([step("read_wiki_page", { pageId: "p1" })]),
    );
    expect(onlyRead).toBeCloseTo(0.6, 5); // -0.4 for no search
  });

  test("penalises failed and duplicate calls", () => {
    const steps = [
      step("search_wiki", { query: "a" }),
      step("search_wiki", { query: "a" }), // duplicate -0.1
      step("read_wiki_page", { pageId: "p1" }, false, { success: false }), // fail -0.1
    ];
    expect(computeToolUsageScore(computeToolStats(steps))).toBeCloseTo(0.8, 5);
  });
});

describe("reference sub-scores", () => {
  test("page recall is null without expected pages, ratio otherwise", () => {
    expect(computePageRecall(["p1"], [])).toBeNull();
    expect(computePageRecall(["p1", "p2"], ["p1", "p3"])).toBeCloseTo(0.5, 5);
  });

  test("fact coverage ratio", () => {
    expect(computeFactCoverage(undefined)).toBeNull();
    expect(
      computeFactCoverage([
        { fact: "a", covered: true },
        { fact: "b", covered: false },
      ]),
    ).toBeCloseTo(0.5, 5);
  });

  test("reference score means the available sub-scores", () => {
    expect(computeReferenceScore(null, null)).toBeNull();
    expect(computeReferenceScore(1, null)).toBe(1);
    expect(computeReferenceScore(1, 0)).toBeCloseTo(0.5, 5);
  });
});

describe("groundedness", () => {
  const claims = (
    ...verdicts: AiTestClaim["verdict"][]
  ): AiTestClaim[] => verdicts.map((verdict) => ({ claim: "x", verdict }));

  test("no-answer case is fully grounded", () => {
    expect(computeGroundedness(undefined, true)).toBe(1);
  });

  test("share of supported claims", () => {
    expect(
      computeGroundedness(claims("supported", "unsupported"), false),
    ).toBeCloseTo(0.5, 5);
  });

  test("no claims is neutral (1)", () => {
    expect(computeGroundedness([], false)).toBe(1);
  });
});

describe("isNoAnswerCase", () => {
  test("true only when it says no answer, has no claims, and searched", () => {
    expect(
      isNoAnswerCase({
        saysWikiHasNoAnswer: true,
        claims: [],
        searchCount: 1,
      }),
    ).toBe(true);
    expect(
      isNoAnswerCase({
        saysWikiHasNoAnswer: true,
        claims: [],
        searchCount: 0,
      }),
    ).toBe(false);
    expect(
      isNoAnswerCase({
        saysWikiHasNoAnswer: true,
        claims: [{ claim: "x", verdict: "supported" }],
        searchCount: 1,
      }),
    ).toBe(false);
  });
});

describe("hard gates", () => {
  const baseGate = {
    questionType: "answerable",
    claims: undefined,
    citedPageTitles: undefined,
    trajectoryPageTitles: ["Vacation Policy"],
    hasToolCall: true,
    substantiveAnswer: true,
    saysWikiHasNoAnswer: false,
  };

  test("contradicted claim", () => {
    expect(
      computeHardGates({
        ...baseGate,
        claims: [{ claim: "x", verdict: "contradicted" }],
      }),
    ).toContain("contradicted-claim");
  });

  test("invented source (cited title not in trajectory)", () => {
    const reasons = computeHardGates({
      ...baseGate,
      citedPageTitles: ["Ghost Page"],
    });
    expect(reasons.some((r) => r.startsWith("invented-source"))).toBe(true);
  });

  test("cited title present in trajectory passes", () => {
    expect(
      computeHardGates({ ...baseGate, citedPageTitles: ["vacation policy"] }),
    ).toEqual([]);
  });

  test("answer without any tool call", () => {
    expect(
      computeHardGates({ ...baseGate, hasToolCall: false }),
    ).toContain("answer-without-tools");
  });

  test("substantive answer to a not-in-wiki question", () => {
    expect(
      computeHardGates({ ...baseGate, questionType: "not-in-wiki" }),
    ).toContain("answered-not-in-wiki");
  });

  test("honest no-answer to a not-in-wiki question passes", () => {
    expect(
      computeHardGates({
        ...baseGate,
        questionType: "not-in-wiki",
        saysWikiHasNoAnswer: true,
      }),
    ).toEqual([]);
  });
});

describe("verdictFor", () => {
  test("hard gate forces fail regardless of score", () => {
    expect(verdictFor(0.99, ["contradicted-claim"])).toBe("fail");
  });
  test("thresholds", () => {
    expect(verdictFor(0.8, [])).toBe("pass");
    expect(verdictFor(0.6, [])).toBe("warn");
    expect(verdictFor(0.3, [])).toBe("fail");
  });
});

describe("scoreQuestion (integration)", () => {
  test("clean answerable question passes", () => {
    const result = scoreQuestion({
      steps: goodTrajectory(),
      questionType: "answerable",
      expectedPageIds: [],
      relevance: 1,
      claims: [{ claim: "30 days vacation", verdict: "supported" }],
      citedPageTitles: ["Vacation Policy"],
      factsCovered: undefined,
      saysWikiHasNoAnswer: false,
      substantiveAnswer: true,
      durationMs: 1000,
      totalTokens: 500,
    });
    expect(result.verdict).toBe("pass");
    expect(result.scores.total).toBeCloseTo(1, 5);
    expect(result.hardGateReasons).toEqual([]);
  });

  test("substantive answer to not-in-wiki fails via hard gate", () => {
    const result = scoreQuestion({
      steps: goodTrajectory(),
      questionType: "not-in-wiki",
      expectedPageIds: [],
      relevance: 1,
      claims: [{ claim: "made up", verdict: "unsupported" }],
      citedPageTitles: [],
      factsCovered: undefined,
      saysWikiHasNoAnswer: false,
      substantiveAnswer: true,
      durationMs: 1000,
      totalTokens: 500,
    });
    expect(result.verdict).toBe("fail");
    expect(result.hardGateReasons).toContain("answered-not-in-wiki");
    expect(result.generalKnowledgeSuspected).toBe(true);
  });

  test("honest no-answer scores groundedness 1 and flags noAnswerCase", () => {
    const result = scoreQuestion({
      steps: goodTrajectory(),
      questionType: "not-in-wiki",
      expectedPageIds: [],
      relevance: 1,
      claims: [],
      citedPageTitles: [],
      factsCovered: undefined,
      saysWikiHasNoAnswer: true,
      substantiveAnswer: true,
      durationMs: 1000,
      totalTokens: 500,
    });
    expect(result.noAnswerCase).toBe(true);
    expect(result.scores.groundedness).toBe(1);
    expect(result.verdict).toBe("pass");
  });

  test("reference data blends into the total", () => {
    const result = scoreQuestion({
      steps: goodTrajectory(),
      questionType: "answerable",
      expectedPageIds: ["p1", "missing"], // recall 0.5 (only p1 read)
      relevance: 1,
      claims: [{ claim: "x", verdict: "supported" }],
      citedPageTitles: ["Vacation Policy"],
      factsCovered: undefined,
      saysWikiHasNoAnswer: false,
      substantiveAnswer: true,
      durationMs: 1,
      totalTokens: 1,
    });
    // base = 1, reference = 0.5 → 0.8*1 + 0.2*0.5 = 0.9
    expect(result.scores.reference).toBeCloseTo(0.5, 5);
    expect(result.scores.total).toBeCloseTo(0.9, 5);
    expect(result.scores.metrics.pageRecall).toBeCloseTo(0.5, 5);
  });
});

describe("computeAggregates", () => {
  test("means, pass-rate and per-type breakdown", () => {
    const items: AggregateItem[] = [
      {
        questionType: "answerable",
        verdict: "pass",
        toolUsage: 1,
        groundedness: 1,
        relevance: 1,
        total: 1,
        hardGate: false,
      },
      {
        questionType: "not-in-wiki",
        verdict: "fail",
        toolUsage: 1,
        groundedness: 0,
        relevance: 1,
        total: 0.4,
        hardGate: true,
      },
    ];
    const agg = computeAggregates(items);
    expect(agg.passRate).toBeCloseTo(0.5, 5);
    expect(agg.meanTotal).toBeCloseTo(0.7, 5);
    expect(agg.hardGateFails).toBe(1);
    expect(agg.byType.answerable!.passRate).toBe(1);
    expect(agg.byType["not-in-wiki"]!.count).toBe(1);
  });
});
