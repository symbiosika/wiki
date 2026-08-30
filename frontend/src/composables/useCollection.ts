/**
 * Data layer for the collection attached to one wiki page.
 *
 * Records are loaded in full (up to the server's cap) and then filtered and
 * sorted in the browser. For the few hundred to few thousand rows a collection
 * is meant to hold that is the right trade: typing in the search box filters
 * instantly with no round trip, which is most of what makes the table feel like
 * a spreadsheet rather than a web form. `truncated` reports when a collection
 * outgrew the cap so the UI can say so instead of silently showing a slice.
 */
import { useToast } from 'primevue/usetoast'
import type {
  Collection,
  CollectionField,
  CollectionFieldType,
  CollectionFieldOptions,
  CollectionRecord,
  CollectionSettings,
} from '@/utils/collections'

export function useCollection(
  tenantId: Ref<string | undefined>,
  pageId: Ref<string | undefined>,
) {
  const collection = ref<Collection | null>(null)
  const records = ref<CollectionRecord[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const truncated = ref(false)
  const total = ref(0)

  const toast = useToast()
  const { t } = useI18n()

  const base = () => `/api/v1/tenant/${tenantId.value}/collections`

  /** Surface the server's message — it names the offending column. */
  function reportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    toast.add({
      severity: 'error',
      summary: t('Collections.error'),
      detail: message,
      life: 6000,
    })
  }

  async function loadRecords() {
    if (!collection.value) return
    const result = await fetcher.get<{
      records: CollectionRecord[]
      total: number
      truncated: boolean
    }>(`${base()}/${collection.value.id}/records`)
    records.value = result.records
    total.value = result.total
    truncated.value = result.truncated
  }

  /** Load the collection for the current page; leaves it null for normal pages. */
  async function load() {
    if (!tenantId.value || !pageId.value) return
    loading.value = true
    try {
      collection.value = await fetcher.get<Collection | null>(
        `${base()}/by-page/${pageId.value}`,
      )
      if (collection.value) await loadRecords()
      else records.value = []
    } catch (error) {
      reportError(error)
    } finally {
      loading.value = false
    }
  }

  /** Reload just the schema (after a column change). */
  async function reloadSchema() {
    if (!collection.value) return
    collection.value = await fetcher.get<Collection>(
      `${base()}/${collection.value.id}`,
    )
  }

  async function withSaving<T>(fn: () => Promise<T>): Promise<T | null> {
    saving.value = true
    try {
      return await fn()
    } catch (error) {
      reportError(error)
      return null
    } finally {
      saving.value = false
    }
  }

  /** Turn the current page into a collection, with a sensible starter column. */
  async function createCollection(fields?: Array<{ label: string; type: CollectionFieldType }>) {
    return await withSaving(async () => {
      const created = await fetcher.post<Collection>(base(), {
        knowledgeTextId: pageId.value,
        fields: fields ?? [{ label: t('Collections.defaultColumn'), type: 'text' }],
      })
      collection.value = created
      records.value = []
      total.value = 0
      return created
    })
  }

  async function updateSettings(patch: {
    name?: string | null
    description?: string | null
    settings?: CollectionSettings
  }) {
    if (!collection.value) return null
    return await withSaving(async () => {
      collection.value = await fetcher.put<Collection>(
        `${base()}/${collection.value!.id}`,
        patch,
      )
      return collection.value
    })
  }

  async function removeCollection() {
    if (!collection.value) return
    await withSaving(async () => {
      await fetcher.delete(`${base()}/${collection.value!.id}`)
      collection.value = null
      records.value = []
      total.value = 0
    })
  }

  // ---- fields ------------------------------------------------------------

  async function addField(input: {
    label: string
    type: CollectionFieldType
    options?: CollectionFieldOptions
    required?: boolean
  }) {
    if (!collection.value) return null
    return await withSaving(async () => {
      const field = await fetcher.post<CollectionField>(
        `${base()}/${collection.value!.id}/fields`,
        input,
      )
      await reloadSchema()
      return field
    })
  }

  async function updateField(fieldId: string, patch: Partial<CollectionField>) {
    if (!collection.value) return null
    return await withSaving(async () => {
      const field = await fetcher.put<CollectionField>(
        `${base()}/${collection.value!.id}/fields/${fieldId}`,
        patch,
      )
      await reloadSchema()
      return field
    })
  }

  async function deleteField(fieldId: string) {
    if (!collection.value) return
    await withSaving(async () => {
      await fetcher.delete(`${base()}/${collection.value!.id}/fields/${fieldId}`)
      await reloadSchema()
      // values of the dropped column are gone server-side too
      await loadRecords()
    })
  }

  async function reorderFields(fieldIds: string[]) {
    if (!collection.value) return
    await withSaving(async () => {
      await fetcher.put(`${base()}/${collection.value!.id}/fields/reorder`, {
        fieldIds,
      })
      await reloadSchema()
    })
  }

  // ---- records -----------------------------------------------------------

  async function createRecord(data: Record<string, unknown>) {
    if (!collection.value) return null
    return await withSaving(async () => {
      const created = await fetcher.post<CollectionRecord>(
        `${base()}/${collection.value!.id}/records`,
        { data },
      )
      records.value = [...records.value, created]
      total.value += 1
      return created
    })
  }

  /**
   * Patch a record.
   *
   * On failure the local rows are reloaded: an inline cell edit has already
   * mutated the row in place to give instant feedback, so without this a
   * rejected value (a required field cleared, a number that is not a number)
   * would keep sitting on screen as if it had been saved.
   */
  async function updateRecord(recordId: string, data: Record<string, unknown>) {
    if (!collection.value) return null
    saving.value = true
    try {
      const updated = await fetcher.put<CollectionRecord>(
        `${base()}/${collection.value.id}/records/${recordId}`,
        { data },
      )
      records.value = records.value.map((r) => (r.id === recordId ? updated : r))
      return updated
    } catch (error) {
      reportError(error)
      // Revert IN PLACE rather than reloading the array: an inline editor may
      // still be open and holds a reference to this very row object, so
      // replacing it would leave the editor bound to a detached copy.
      await revertRecord(recordId)
      return null
    } finally {
      saving.value = false
    }
  }

  /** Restore one record's values from the server, keeping its object identity. */
  async function revertRecord(recordId: string) {
    if (!collection.value) return
    try {
      const fresh = await fetcher.get<{ records: CollectionRecord[] }>(
        `${base()}/${collection.value.id}/records`,
      )
      const server = fresh.records.find((r) => r.id === recordId)
      const local = records.value.find((r) => r.id === recordId)
      if (!server || !local) return
      // drop keys the server no longer has, then copy the authoritative values
      for (const key of Object.keys(local.data)) delete local.data[key]
      Object.assign(local.data, server.data)
    } catch {
      // a failed revert is not worth a second error toast; the next load fixes it
    }
  }

  async function deleteRecord(recordId: string) {
    if (!collection.value) return
    await withSaving(async () => {
      await fetcher.delete(`${base()}/${collection.value!.id}/records/${recordId}`)
      records.value = records.value.filter((r) => r.id !== recordId)
      total.value -= 1
    })
  }

  async function deleteRecordsBulk(recordIds: string[]) {
    if (!collection.value || recordIds.length === 0) return
    await withSaving(async () => {
      await fetcher.post(`${base()}/${collection.value!.id}/records/delete`, {
        recordIds,
      })
      const removed = new Set(recordIds)
      records.value = records.value.filter((r) => !removed.has(r.id))
      total.value -= recordIds.length
    })
  }

  /** Visible (non-hidden) columns in their configured order. */
  const visibleFields = computed(
    () => collection.value?.fields.filter((f) => !f.hidden) ?? [],
  )

  return {
    collection,
    records,
    visibleFields,
    loading,
    saving,
    truncated,
    total,
    load,
    loadRecords,
    createCollection,
    updateSettings,
    removeCollection,
    addField,
    updateField,
    deleteField,
    reorderFields,
    createRecord,
    updateRecord,
    deleteRecord,
    deleteRecordsBulk,
  }
}
