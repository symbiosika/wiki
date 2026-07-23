/**
 * Shared types for AI test suites (mirrors the backend app API).
 */

export type AiTestQuestionType =
  | 'answerable'
  | 'synthesis'
  | 'not-in-wiki'
  | 'ambiguous'

export type AiTestRunStatus =
  | 'running'
  | 'success'
  | 'partial'
  | 'error'
  | 'cancelled'

export type AiTestVerdict = 'pass' | 'warn' | 'fail'

export type AiTestClaimVerdict = 'supported' | 'unsupported' | 'contradicted'

export interface AiTestSuite {
  id: string
  organisationId: string
  name: string
  description: string | null
  judgeModelId: string | null
  stepLimit: number | null
  createdBy: string | null
  lastRunId: string | null
  lastRunAt: string | null
  lastRunStatus: AiTestRunStatus | null
  createdAt: string
  updatedAt: string
}

export interface AiTestQuestion {
  id: string
  suiteId: string
  organisationId: string
  question: string
  type: AiTestQuestionType
  expectedPageIds: string[]
  expectedFacts: string[]
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface AiTestRunAggregates {
  passRate: number
  meanTotal: number
  meanToolUsage: number
  meanGroundedness: number
  meanRelevance: number
  hardGateFails: number
  byType: Record<
    string,
    { count: number; passRate: number; meanTotal: number }
  >
}

export interface AiTestRun {
  id: string
  suiteId: string
  organisationId: string
  status: AiTestRunStatus
  startedBy: string
  judgeModelId: string | null
  total: number
  completed: number
  failed: number
  passed: number
  warned: number
  hardGateFails: number
  aggregates: AiTestRunAggregates | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface AiTestTrajectoryStep {
  index: number
  toolName: string
  input: unknown
  output: unknown
  ok: boolean
}

export interface AiTestTrajectory {
  steps: AiTestTrajectoryStep[]
  stepCount: number
  finishReason?: string
}

export interface AiTestClaim {
  claim: string
  verdict: AiTestClaimVerdict
  reasoning?: string
}

export interface AiTestJudgeReport {
  relevance: number
  relevanceReasoning?: string
  saysWikiHasNoAnswer?: boolean
  trajectoryVerdict?: string
  citedPageTitles?: string[]
  factsCovered?: { fact: string; covered: boolean }[]
  claims?: AiTestClaim[]
  flags: {
    generalKnowledgeSuspected?: boolean
    noAnswerCase?: boolean
    hardGateReasons?: string[]
  }
}

export interface AiTestMetrics {
  durationMs: number
  totalTokens: number
  steps: number
  searchCount: number
  readCount: number
  failedToolCalls: number
  duplicateToolCalls: number
  pageRecall?: number | null
}

export interface AiTestScores {
  toolUsage: number
  groundedness: number
  relevance: number
  reference?: number | null
  total: number
  metrics: AiTestMetrics
}

export interface AiTestResult {
  id: string
  runId: string
  organisationId: string
  questionId: string | null
  questionText: string
  questionType: AiTestQuestionType
  expectedPageIds: string[]
  expectedFacts: string[]
  answer: string | null
  trajectory: AiTestTrajectory | null
  scores: AiTestScores | null
  judgeReport: AiTestJudgeReport | null
  verdict: AiTestVerdict | null
  toolUsageScore: number | null
  groundednessScore: number | null
  relevanceScore: number | null
  referenceScore: number | null
  totalScore: number | null
  durationMs: number | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  error: string | null
  createdAt: string
}

export interface AiTestSuiteDetail {
  suite: AiTestSuite
  questions: AiTestQuestion[]
  runs: AiTestRun[]
}

export interface AiTestRunDetail {
  run: AiTestRun
  results: AiTestResult[]
}

/** Payload to create/update a suite. */
export interface AiTestSuiteInput {
  name: string
  description?: string | null
  judgeModelId?: string | null
  stepLimit?: number | null
}

/** One question in the id-preserving replace payload. */
export interface AiTestQuestionInput {
  id?: string
  question: string
  type?: AiTestQuestionType
  expectedPageIds?: string[]
  expectedFacts?: string[]
  active?: boolean
}
