import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetcher } from '@/utils/fetcher'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
  error?: boolean
}

export interface AssistResult {
  success: boolean
  summary: string
  appliedEdits: number
}

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/document-assistant`

/**
 * State + actions for the per-page "talk to your document" assistant. A single
 * instance is mounted on the wiki page; messages are the running chat log for
 * the currently open page.
 */
export const useDocumentAssistant = defineStore('documentAssistant', () => {
  const open = ref(false)
  const busy = ref(false)
  const messages = ref<AssistantMessage[]>([])

  const openPanel = () => {
    open.value = true
  }
  const closePanel = () => {
    open.value = false
  }
  const reset = () => {
    messages.value = []
  }

  /** Send one instruction; the agent works it into the page. */
  const assist = async (
    tenantId: string,
    entryId: string,
    instruction: string,
  ): Promise<AssistResult> => {
    busy.value = true
    messages.value.push({ role: 'user', text: instruction })
    const idx =
      messages.value.push({ role: 'assistant', text: '', pending: true }) - 1
    try {
      const res = await fetcher.post<AssistResult>(api(tenantId), {
        entryId,
        instruction,
      })
      messages.value[idx] = {
        role: 'assistant',
        text: res.summary || '…',
        error: !res.success,
      }
      return res
    } catch (error) {
      messages.value[idx] = {
        role: 'assistant',
        text: '',
        error: true,
      }
      throw error
    } finally {
      busy.value = false
    }
  }

  return { open, busy, messages, openPanel, closePanel, reset, assist }
})
