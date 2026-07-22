import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  AiTestSuite,
  AiTestSuiteDetail,
  AiTestSuiteInput,
  AiTestQuestion,
  AiTestQuestionInput,
  AiTestQuestionType,
  AiTestRun,
  AiTestRunDetail,
} from '@/types/aiTests'

const api = (tenantId: string) =>
  `/api/v1/tenant/${tenantId}/ai-tests/suites`

export const useAiTests = defineStore('aiTests', () => {
  const suites = ref<AiTestSuite[]>([])
  const loading = ref(false)

  const loadSuites = async (tenantId: string) => {
    loading.value = true
    try {
      suites.value = await fetcher.get<AiTestSuite[]>(api(tenantId))
    } finally {
      loading.value = false
    }
  }

  const createSuite = async (
    tenantId: string,
    input: AiTestSuiteInput,
  ): Promise<AiTestSuite> => {
    const suite = await fetcher.post<AiTestSuite>(api(tenantId), input)
    await loadSuites(tenantId)
    return suite
  }

  const getSuite = (tenantId: string, suiteId: string) =>
    fetcher.get<AiTestSuiteDetail>(`${api(tenantId)}/${suiteId}`)

  const updateSuite = (
    tenantId: string,
    suiteId: string,
    input: Partial<AiTestSuiteInput>,
  ) => fetcher.put<AiTestSuite>(`${api(tenantId)}/${suiteId}`, input)

  const deleteSuite = async (tenantId: string, suiteId: string) => {
    await fetcher.delete(`${api(tenantId)}/${suiteId}`)
    await loadSuites(tenantId)
  }

  const setQuestions = (
    tenantId: string,
    suiteId: string,
    questions: AiTestQuestionInput[],
  ) =>
    fetcher.put<AiTestQuestion[]>(`${api(tenantId)}/${suiteId}/questions`, {
      questions,
    })

  const bulkAddQuestions = (
    tenantId: string,
    suiteId: string,
    text: string,
    type?: AiTestQuestionType,
  ) =>
    fetcher.post<AiTestQuestion[]>(
      `${api(tenantId)}/${suiteId}/questions/bulk`,
      { text, type },
    )

  const runNow = (tenantId: string, suiteId: string) =>
    fetcher.post<AiTestRun>(`${api(tenantId)}/${suiteId}/run`, {})

  const listRuns = (tenantId: string, suiteId: string) =>
    fetcher.get<AiTestRun[]>(`${api(tenantId)}/${suiteId}/runs`)

  const getRun = (tenantId: string, suiteId: string, runId: string) =>
    fetcher.get<AiTestRunDetail>(
      `${api(tenantId)}/${suiteId}/runs/${runId}`,
    )

  const cancelRun = (tenantId: string, suiteId: string, runId: string) =>
    fetcher.post<AiTestRun>(
      `${api(tenantId)}/${suiteId}/runs/${runId}/cancel`,
      {},
    )

  const deleteRun = (tenantId: string, suiteId: string, runId: string) =>
    fetcher.delete(`${api(tenantId)}/${suiteId}/runs/${runId}`)

  return {
    suites,
    loading,
    loadSuites,
    createSuite,
    getSuite,
    updateSuite,
    deleteSuite,
    setQuestions,
    bulkAddQuestions,
    runNow,
    listRuns,
    getRun,
    cancelRun,
    deleteRun,
  }
})
