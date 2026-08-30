<script setup lang="ts">
/**
 * The collection section of a wiki page.
 *
 * Renders one of three states:
 *   - the page has a collection → the table
 *   - the page has none and the user may edit → an invitation to add one
 *   - the page has none and the user may not edit → nothing at all
 *
 * The collection sits *below* the page's prose, not instead of it: a table
 * almost always wants a paragraph of context above it ("wer hier fehlt, bitte
 * bei mir melden"), and that is what the normal block editor is for.
 */
import IconTable from '~icons/mdi/table-large'
import IconSettings from '~icons/mdi/tune-variant'
import { useConfirm } from 'primevue/useconfirm'
// src/composables is not in the auto-import dirs (see vite.config.ts)
import { useCollection } from '@/composables/useCollection'

const props = defineProps<{
  tenantId: string
  pageId: string
  editable: boolean
}>()

const emit = defineEmits<{
  /** lets the page collapse the editor's empty space when a table is shown */
  hasCollection: [boolean]
}>()

const { t } = useI18n()
const confirm = useConfirm()

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

const settingsOpen = ref(false)

onMounted(load)
// the page component is reused across routes, so react to the page changing
watch(() => props.pageId, load)
watch(collection, (value) => emit('hasCollection', value !== null), { immediate: true })

const description = computed({
  get: () => collection.value?.description ?? '',
  set: (value: string) => {
    if (collection.value) collection.value.description = value
  },
})

function saveDescription() {
  updateSettings({ description: description.value || null })
}

function toggleMaterialize(value: boolean) {
  updateSettings({ settings: { materialize: value } })
}

function confirmRemove() {
  confirm.require({
    message: t('Collections.deleteConfirm'),
    header: t('Collections.delete'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      await removeCollection()
      settingsOpen.value = false
    },
  })
}
</script>

<template>
  <!--
    On a wide screen the table breaks out of the page's max-w-3xl prose column:
    prose wants a narrow measure, a data table wants room. The width is capped
    well inside the content area so it never collides with the sidebar, and the
    table scrolls inside itself if it is wider still.
  -->
  <section
    v-if="collection || editable"
    class="mt-8"
    :class="collection ? 'xl:ml-[calc(50%-31rem)] xl:w-[62rem]' : ''"
  >
    <!-- the table -->
    <template v-if="collection">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <IconTable class="h-4 w-4 shrink-0 text-surface-400" />
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-0">
              {{ $t('Collections.heading') }}
            </h2>
          </div>
          <!-- description doubles as the table's caption -->
          <input
            v-if="editable"
            v-model="description"
            class="mt-1 w-full bg-transparent text-sm text-surface-500 outline-none placeholder:text-surface-300 dark:text-surface-400 dark:placeholder:text-surface-600"
            :placeholder="$t('Collections.descriptionPlaceholder')"
            @blur="saveDescription"
            @keydown.enter="saveDescription"
          />
          <p
            v-else-if="collection.description"
            class="mt-1 text-sm text-surface-500 dark:text-surface-400"
          >
            {{ collection.description }}
          </p>
        </div>

        <button
          v-if="editable"
          type="button"
          class="mt-0.5 shrink-0 rounded p-1 text-surface-400 transition-colors hover:text-primary"
          :class="{ 'text-primary': settingsOpen }"
          :title="$t('Collections.settings.title')"
          @click="settingsOpen = !settingsOpen"
        >
          <IconSettings class="h-4 w-4" />
        </button>
      </div>

      <!-- collection settings -->
      <div
        v-if="settingsOpen && editable"
        class="mb-3 space-y-3 rounded-lg border border-surface-200 p-3 dark:border-surface-700"
      >
        <div class="flex items-start gap-2">
          <Checkbox
            :model-value="collection.settings?.materialize ?? false"
            binary
            input-id="materialize"
            @update:model-value="toggleMaterialize"
          />
          <label for="materialize" class="text-sm">
            <span class="text-surface-800 dark:text-surface-100">
              {{ $t('Collections.settings.materialize') }}
            </span>
            <!--
              The warning is not decoration: mirroring copies the rows into the
              page body, which is what the AI search and the public view read.
              For a table of members that is a privacy decision.
            -->
            <span class="mt-0.5 block text-xs text-surface-500 dark:text-surface-400">
              {{ $t('Collections.settings.materializeHint') }}
            </span>
          </label>
        </div>

        <div class="border-t border-surface-200 pt-3 dark:border-surface-700">
          <Button
            :label="$t('Collections.delete')"
            severity="danger"
            outlined
            size="small"
            @click="confirmRemove"
          />
          <p class="mt-1.5 text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Collections.deleteHint') }}
          </p>
        </div>
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
      />
    </template>

    <!-- no collection yet -->
    <div v-else-if="editable && !loading" class="flex justify-center">
      <button
        type="button"
        class="flex items-center gap-2 rounded-lg border border-dashed border-surface-300 px-4 py-2.5 text-sm text-surface-500 transition-colors hover:border-primary hover:text-primary dark:border-surface-600 dark:text-surface-400"
        :disabled="saving"
        @click="createCollection()"
      >
        <IconTable class="h-4 w-4" />
        {{ $t('Collections.addToPage') }}
      </button>
    </div>
  </section>
</template>
