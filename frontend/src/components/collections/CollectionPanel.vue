<script setup lang="ts">
/**
 * The collection section of a wiki page.
 *
 * Renders one of three things:
 *   - the page has a collection → the table
 *   - the page is EMPTY and editable → an invitation to start a table, right
 *     under the editor's own "type / for commands" line, so the two ways of
 *     filling a blank page sit next to each other
 *   - anything else → nothing
 *
 * The invitation is deliberately not offered on a page that already has prose:
 * once someone has written something, a standing "add a table" button at the
 * bottom is furniture nobody asked for. They can still start one from an empty
 * page, or the API.
 *
 * The table sits *below* the page's prose: a table usually wants a sentence of
 * context above it ("wer hier fehlt, bitte bei mir melden"), and that is what
 * the block editor is for.
 */
import IconTable from '~icons/mdi/table-large'
// src/composables is not in the auto-import dirs (see vite.config.ts)
import { useCollection } from '@/composables/useCollection'

const props = defineProps<{
  tenantId: string
  pageId: string
  editable: boolean
  /** true while the page body has no content yet */
  pageEmpty?: boolean
}>()

const emit = defineEmits<{
  /** lets the page collapse the editor's empty space when a table is shown */
  hasCollection: [boolean]
}>()

const tenantId = computed(() => props.tenantId)
const pageId = computed(() => props.pageId)

const {
  collection,
  records,
  visibleFields,
  loading,
  saving,
  truncated,
  total,
  load,
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
} = useCollection(tenantId, pageId)

onMounted(load)
// the page component is reused across routes, so react to the page changing
watch(() => props.pageId, load)
watch(collection, (value) => emit('hasCollection', value !== null), {
  immediate: true,
})

/** Offer to start a table only on a blank page nobody has written on yet. */
const showInvitation = computed(
  () => props.editable && props.pageEmpty && !collection.value && !loading.value,
)
</script>

<template>
  <section v-if="collection" class="mt-3">
    <!--
      On a wide screen the table breaks out of the page's max-w-3xl prose
      column: prose wants a narrow measure, a data table wants room. The width
      is capped well inside the content area so it never collides with the
      sidebar, and the table scrolls inside itself if it is wider still.
    -->
    <div class="xl:ml-[calc(50%-31rem)] xl:w-[62rem]">
      <div class="mb-2 flex items-baseline gap-2">
        <IconTable class="h-4 w-4 shrink-0 self-center text-surface-400" />
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-0">
          {{ collection.displayName }}
        </h2>
        <span
          v-if="collection.description"
          class="min-w-0 truncate text-sm text-surface-500 dark:text-surface-400"
        >
          {{ collection.description }}
        </span>
      </div>

      <CollectionTable
        :collection="collection"
        :records="records"
        :fields="visibleFields"
        :loading="loading"
        :saving="saving"
        :editable="editable"
        :truncated="truncated"
        :total="total"
        @create-record="createRecord"
        @update-record="updateRecord($event.id, $event.data)"
        @delete-record="deleteRecord"
        @delete-records="deleteRecordsBulk"
        @add-field="addField"
        @update-field="updateField($event.id, $event.patch)"
        @remove-field="deleteField"
        @reorder-fields="reorderFields"
        @update-collection="updateSettings"
        @delete-collection="removeCollection"
      />
    </div>
  </section>

  <!--
    Blank page: sits directly under the editor's placeholder line as the second
    half of one sentence — write text, or make this a table.
  -->
  <p
    v-else-if="showInvitation"
    class="-mt-1 text-[15px] leading-7 text-surface-400 dark:text-surface-500"
  >
    {{ $t('Collections.orStartTable') }}
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded text-primary underline-offset-2 hover:underline disabled:opacity-60"
      :disabled="saving"
      @click="createCollection()"
    >
      <IconTable class="h-4 w-4" />
      {{ $t('Collections.startTable') }}
    </button>
  </p>
</template>
