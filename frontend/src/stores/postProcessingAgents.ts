import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  PostProcessingAgent,
  PostProcessingAgentInput,
  PostProcessingAgentTestRun,
} from '@/types/postProcessingAgents'

const api = (tenantId: string) =>
  `/api/v1/tenant/${tenantId}/post-processing-agents`

export const usePostProcessingAgents = defineStore(
  'postProcessingAgents',
  () => {
    const agents = ref<PostProcessingAgent[]>([])
    const loading = ref(false)

    const loadAgents = async (tenantId: string) => {
      loading.value = true
      try {
        agents.value = await fetcher.get<PostProcessingAgent[]>(api(tenantId))
      } finally {
        loading.value = false
      }
    }

    const createAgent = async (
      tenantId: string,
      input: PostProcessingAgentInput,
    ): Promise<PostProcessingAgent> => {
      const agent = await fetcher.post<PostProcessingAgent>(api(tenantId), input)
      await loadAgents(tenantId)
      return agent
    }

    const updateAgent = async (
      tenantId: string,
      id: string,
      input: Partial<PostProcessingAgentInput>,
    ): Promise<PostProcessingAgent> => {
      const agent = await fetcher.put<PostProcessingAgent>(
        `${api(tenantId)}/${id}`,
        input,
      )
      await loadAgents(tenantId)
      return agent
    }

    const deleteAgent = async (tenantId: string, id: string) => {
      await fetcher.delete(`${api(tenantId)}/${id}`)
      await loadAgents(tenantId)
    }

    const testRun = (
      tenantId: string,
      id: string,
      text: string,
      title?: string,
    ) =>
      fetcher.post<PostProcessingAgentTestRun>(
        `${api(tenantId)}/${id}/test-run`,
        { text, title },
      )

    return {
      agents,
      loading,
      loadAgents,
      createAgent,
      updateAgent,
      deleteAgent,
      testRun,
    }
  },
)
