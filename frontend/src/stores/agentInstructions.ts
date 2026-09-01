import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type { AgentInstructions } from '@/types/wiki'

/**
 * The organisation's agent instructions — the briefing every MCP client is
 * handed at the start of a session (see `get_wiki_overview`).
 *
 * An uncached read/write pair for the administration area, matching
 * `knowledgeConfig`.
 */
const api = (tenantId: string) =>
  `/api/v1/tenant/${tenantId}/knowledge/texts/agent-instructions`

export const useAgentInstructions = defineStore('agentInstructions', () => {
  const loading = ref(false)
  const saving = ref(false)

  /** Returns null when the organisation has no instructions yet. */
  const load = async (tenantId: string): Promise<AgentInstructions | null> => {
    loading.value = true
    try {
      const res = await fetcher.get<{
        instructions: AgentInstructions | null
      }>(api(tenantId))
      return res.instructions
    } finally {
      loading.value = false
    }
  }

  /** Upsert: creates the row on first call, replaces the content afterwards. */
  const save = async (
    tenantId: string,
    content: string,
  ): Promise<AgentInstructions> => {
    saving.value = true
    try {
      const res = await fetcher.put<{ instructions: AgentInstructions }>(
        api(tenantId),
        { content },
      )
      return res.instructions
    } finally {
      saving.value = false
    }
  }

  /** Removes the instructions entirely; agents fall back to no briefing. */
  const remove = async (tenantId: string): Promise<void> => {
    saving.value = true
    try {
      await fetcher.delete(api(tenantId))
    } finally {
      saving.value = false
    }
  }

  return { loading, saving, load, save, remove }
})
