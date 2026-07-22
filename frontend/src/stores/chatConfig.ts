import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'

/**
 * Per-organisation configuration of the AI chat agent.
 *
 * Currently a single custom system prompt that is appended to the assistant's
 * built-in instructions on the backend. It is editable both under Verwaltung
 * (the "Chat agent" tab) and via the quick-settings dialog in the chat panel;
 * both edit the same org-wide value, keyed by tenant.
 */
export interface ChatAgentConfig {
  systemPrompt: string
}

/** Keep in sync with MAX_SYSTEM_PROMPT_CHARS on the backend. */
export const MAX_SYSTEM_PROMPT_CHARS = 8000

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/chat/config`

export const useChatConfig = defineStore('chatConfig', () => {
  const loading = ref(false)
  const saving = ref(false)

  const loadConfig = async (tenantId: string): Promise<ChatAgentConfig> => {
    loading.value = true
    try {
      return await fetcher.get<ChatAgentConfig>(api(tenantId))
    } finally {
      loading.value = false
    }
  }

  const saveConfig = async (
    tenantId: string,
    config: ChatAgentConfig,
  ): Promise<ChatAgentConfig> => {
    saving.value = true
    try {
      return await fetcher.put<ChatAgentConfig>(api(tenantId), {
        systemPrompt: config.systemPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS),
      })
    } finally {
      saving.value = false
    }
  }

  return { loading, saving, loadConfig, saveConfig }
})
