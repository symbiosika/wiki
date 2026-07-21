import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  KnowledgeAttributeDefinition,
  WikiKnowledgeConfig,
} from '@/types/wiki'

/**
 * Per-organisation knowledge configuration used by the administration area.
 *
 * The wiki store keeps a session-cached copy of the same config for the
 * document view; this store is a thin, uncached read/write pair used by the
 * organisation-details page so admins always edit fresh data and can persist
 * changes. The `attributes` list defines the per-organisation key-value
 * metadata (tags) every document may use — the primary thing this store edits.
 */
const api = (tenantId: string) =>
  `/api/v1/tenant/${tenantId}/knowledge/texts/config`

export const useKnowledgeConfig = defineStore('knowledgeConfig', () => {
  const loading = ref(false)
  const saving = ref(false)

  const loadConfig = async (
    tenantId: string,
  ): Promise<WikiKnowledgeConfig> => {
    loading.value = true
    try {
      return await fetcher.get<WikiKnowledgeConfig>(api(tenantId))
    } finally {
      loading.value = false
    }
  }

  /**
   * Persist the per-organisation attribute (tag) definitions. The backend
   * replaces the whole `attributes` array and returns the updated config.
   */
  const saveAttributes = async (
    tenantId: string,
    attributes: KnowledgeAttributeDefinition[],
  ): Promise<WikiKnowledgeConfig> => {
    saving.value = true
    try {
      return await fetcher.put<WikiKnowledgeConfig>(api(tenantId), {
        attributes,
      })
    } finally {
      saving.value = false
    }
  }

  return { loading, saving, loadConfig, saveAttributes }
})
