<script setup lang="ts">
/**
 * The collection table.
 *
 * Built on PrimeVue's DataTable with client-side filtering and sorting: the
 * records are already in memory (see useCollection), so typing in the search
 * box or clicking a header is instant. What the DataTable does not do for us is
 * type-aware comparison — a jsonb column holds numbers, booleans and dates
 * behind one key — so sorting goes through our own `sortValue` via
 * `sortField` as a function, and the per-column filters are custom templates.
 *
 * Editing works two ways on purpose:
 *   - inline cell edit for a quick correction (click a cell, type, tab away)
 *   - the row dialog for adding a record and for long text
 */
import IconPlus from '~icons/mdi/plus'
import IconSettings from '~icons/mdi/cog-outline'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconExpand from '~icons/mdi/arrow-expand'
import IconSearch from '~icons/mdi/magnify'
import IconClose from '~icons/mdi/close'
import IconFilter from '~icons/mdi/filter-variant'
import IconExport from '~icons/mdi/tray-arrow-down'
import IconCheck from '~icons/mdi/check'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import {
  toCsv,
  toMarkdownBlocks,
  csvFileName,
} from '@/utils/collectionExport'
import {
  displayValue,
  sortValue,
  matchesSearch,
  choiceClasses,
  recordLabel,
  isNarrowType,
  type Collection,
  type CollectionField,
  type CollectionRecord,
} from '@/utils/collections'

const props = defineProps<{
  collection: Collection
  records: CollectionRecord[]
  fields: CollectionField[]
  loading?: boolean
  saving?: boolean
  editable?: boolean
  truncated?: boolean
  total?: number
}>()

/**
 * `done` on the record emits is how the row dialog learns whether its save
 * worked: it stays open on failure so the user can correct what they typed.
 * Inline cell edits leave it out — they report through a toast and a revert.
 */
const emit = defineEmits<{
  createRecord: [{ data: Record<string, unknown>; done?: (error: string | null) => void }]
  updateRecord: [
    { id: string; data: Record<string, unknown>; done?: (error: string | null) => void },
  ]
  deleteRecord: [string]
  deleteRecords: [string[]]
  addField: [any]
  updateField: [{ id: string; patch: Partial<CollectionField> }]
  removeField: [string]
  reorderFields: [string[]]
  updateCollection: [{ name?: string | null; description?: string | null; settings?: any }]
  deleteCollection: []
}>()

const { t, locale } = useI18n()
const confirm = useConfirm()
const toast = useToast()

const search = ref('')
const selection = ref<CollectionRecord[]>([])
const settingsDialog = ref(false)
const recordDialog = ref(false)
const editingRecord = ref<CollectionRecord | null>(null)
const showFilters = ref(false)

/**
 * Per-column filter values, keyed by field key. Typed as `any` on purpose: the
 * inputs below v-model straight into this map, and a cast at the binding
 * (`v-model="columnFilters[k] as string"`) is not a valid assignment target for
 * the production build, even though vue-tsc accepts it.
 */
const columnFilters = ref<Record<string, any>>({})

const activeFilterCount = computed(
  () =>
    Object.entries(columnFilters.value).filter(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0),
    ).length,
)

/** Does one record pass one column filter? */
function passesColumnFilter(record: CollectionRecord, field: CollectionField): boolean {
  const filter = columnFilters.value[field.key]
  if (filter === null || filter === undefined || filter === '') return true
  const value = record.data[field.key]

  switch (field.type) {
    case 'checkbox':
      // the tri-state select sends 'yes' / 'no'
      return filter === 'yes' ? value === true : value !== true
    case 'select':
      return Array.isArray(filter) ? filter.length === 0 || filter.includes(value) : value === filter
    case 'multiSelect': {
      const values = Array.isArray(value) ? value : []
      const wanted = Array.isArray(filter) ? filter : [filter]
      // "has any of the selected options"
      return wanted.length === 0 || wanted.some((w) => values.includes(w))
    }
    case 'number': {
      const text = String(filter).trim()
      const num = typeof value === 'number' ? value : Number(value)
      // support ">100", "<20", ">=5" as well as a plain substring match
      const range = text.match(/^(>=|<=|>|<)\s*(-?[\d.,]+)$/)
      if (range) {
        const bound = Number(range[2]!.replace(',', '.'))
        if (!Number.isFinite(num) || !Number.isFinite(bound)) return false
        if (range[1] === '>') return num > bound
        if (range[1] === '<') return num < bound
        if (range[1] === '>=') return num >= bound
        return num <= bound
      }
      return displayValue(field, value, locale.value).includes(text)
    }
    default:
      return displayValue(field, value, locale.value)
        .toLowerCase()
        .includes(String(filter).toLowerCase())
  }
}

const filteredRecords = computed(() =>
  props.records.filter(
    (record) =>
      matchesSearch(props.fields, record, search.value, locale.value) &&
      props.fields.every((field) => passesColumnFilter(record, field)),
  ),
)

const isFiltered = computed(
  () => search.value.trim() !== '' || activeFilterCount.value > 0,
)

function clearFilters() {
  search.value = ''
  columnFilters.value = {}
}

/**
 * Sort key handed to the DataTable, so jsonb values compare by their type
 * rather than as strings. PrimeVue types the callback as returning a string;
 * it only ever feeds the result to `<`/`>`, so a number is fine and the cast
 * is the honest way to say so.
 */
function sortFieldFor(field: CollectionField) {
  return ((record: CollectionRecord) => sortValue(field, record)) as unknown as (
    item: any,
  ) => string
}

const choiceOptions = (field: CollectionField) =>
  (field.options?.choices ?? []).map((c) => ({ label: c.value, value: c.value }))

const booleanOptions = computed(() => [
  { label: t('Collections.filter.yes'), value: 'yes' },
  { label: t('Collections.filter.no'), value: 'no' },
])

/** Colour of a select value, for the chip in the cell. */
function colorOf(field: CollectionField, value: unknown): string | undefined {
  return (field.options?.choices ?? []).find((c) => c.value === value)?.color
}

// ---- export -------------------------------------------------------------

/**
 * What an export contains: the checked rows when there is a selection,
 * otherwise everything the current search and filters leave visible. Both
 * readings of "the current selection" end up doing the obvious thing, and
 * neither ever exports rows the user cannot see on screen.
 *
 * Available in read-only mode too — taking a copy of data you are allowed to
 * read is not an edit.
 */
const exportRecords = computed(() =>
  selection.value.length > 0 ? selection.value : filteredRecords.value,
)

const exportMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function downloadCsv() {
  const csv = toCsv(props.fields, exportRecords.value, locale.value)
  // a Blob + object URL, so nothing round-trips through the server
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = csvFileName(props.collection.displayName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // revoke on the next tick: revoking synchronously can cancel the download
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function copyMarkdown() {
  const markdown = toMarkdownBlocks(
    props.collection.displayName,
    props.fields,
    exportRecords.value,
    locale.value,
  )
  try {
    await navigator.clipboard.writeText(markdown)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 2000)
  } catch (error) {
    // a denied clipboard permission is the usual cause, and it is not fixable
    // from here — say so rather than failing silently
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Collections.export.copyFailed'),
      life: 4000,
    })
  }
}

const exportMenuItems = computed(() => [
  {
    label: t('Collections.export.csv', { count: exportRecords.value.length }),
    command: downloadCsv,
  },
  {
    label: t('Collections.export.markdown', { count: exportRecords.value.length }),
    command: copyMarkdown,
  },
])

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

// ---- record actions -----------------------------------------------------

function openCreate() {
  editingRecord.value = null
  recordDialog.value = true
}

function openEdit(record: CollectionRecord) {
  editingRecord.value = record
  recordDialog.value = true
}

/**
 * The dialog closes itself once `done` reports success — closing here would
 * throw away the form (and the user's input) before the server has answered.
 */
function onDialogSave(event: {
  data: Record<string, unknown>
  done: (error: string | null) => void
}) {
  if (editingRecord.value) {
    emit('updateRecord', { id: editingRecord.value.id, data: event.data, done: event.done })
  } else {
    emit('createRecord', { data: event.data, done: event.done })
  }
}

/**
 * Inline cell edit.
 *
 * The editor template binds to `data.data[key]`, i.e. it mutates the record's
 * jsonb document in place. PrimeVue's own `event.newValue` reads `data[field]`
 * — a *top-level* property that does not exist on our rows — so it is always
 * undefined here and must not be used: taking it would send `null` and wipe
 * the cell (and fail outright on a required column). We read the mutated
 * document instead, and compare against a snapshot taken when editing began so
 * an untouched cell sends no request.
 */
const editSnapshot = ref<unknown>(undefined)

function onCellEditInit(event: any) {
  const { data, field } = event as { data: CollectionRecord; field: string }
  editSnapshot.value = structuredClone(data.data[field] ?? null)
}

function onCellEditComplete(event: any) {
  const { data, field } = event as { data: CollectionRecord; field: string }
  if (!props.fields.some((f) => f.key === field)) return
  const next = data.data[field] ?? null
  if (JSON.stringify(editSnapshot.value) === JSON.stringify(next)) return
  emit('updateRecord', { id: data.id, data: { [field]: next } })
}

function confirmDelete(record: CollectionRecord) {
  confirm.require({
    message: t('Collections.record.deleteConfirm', {
      name: recordLabel(props.collection, record),
    }),
    header: t('Collections.record.delete'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: () => emit('deleteRecord', record.id),
  })
}

function confirmDeleteSelected() {
  const ids = selection.value.map((r) => r.id)
  if (ids.length === 0) return
  confirm.require({
    message: t('Collections.record.deleteManyConfirm', { count: ids.length }),
    header: t('Collections.record.delete'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: () => {
      emit('deleteRecords', ids)
      selection.value = []
    },
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- toolbar -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- search -->
      <div class="relative min-w-0 flex-1 sm:max-w-xs">
        <IconSearch
          class="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-surface-400"
        />
        <!--
          `p-small:pl-9` as well as `pl-9`: Volt's InputText sets its small-size
          padding as the VARIANT class `p-small:px-[0.625rem]`, and tailwind-merge
          does not treat a plain `pl-9` as conflicting with it. Without the
          variant form the placeholder keeps its 0.625rem offset and renders on
          top of the magnifier.
        -->
        <InputText
          v-model="search"
          class="w-full pl-9 p-small:pl-9"
          size="small"
          :placeholder="$t('Collections.searchPlaceholder')"
        />
        <button
          v-if="search"
          type="button"
          class="absolute top-1/2 right-2 -translate-y-1/2 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
          :title="$t('Collections.filter.clear')"
          @click="search = ''"
        >
          <IconClose class="h-4 w-4" />
        </button>
      </div>

      <!-- filter toggle -->
      <button
        type="button"
        class="flex items-center gap-1 rounded-full border px-2 py-1.5 text-sm transition-colors"
        :class="
          showFilters || activeFilterCount > 0
            ? 'border-primary text-primary'
            : 'border-surface-200 text-surface-600 hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300'
        "
        :title="$t('Collections.filter.toggle')"
        :aria-label="$t('Collections.filter.toggle')"
        @click="showFilters = !showFilters"
      >
        <IconFilter class="h-4 w-4" />
        <span
          v-if="activeFilterCount > 0"
          class="rounded-full bg-primary px-1.5 text-xs text-white"
        >
          {{ activeFilterCount }}
        </span>
      </button>

      <button
        v-if="isFiltered"
        type="button"
        class="text-sm text-surface-500 underline-offset-2 hover:underline dark:text-surface-400"
        @click="clearFilters"
      >
        {{ $t('Collections.filter.clear') }}
      </button>

      <div class="flex-1" />

      <!--
        Export is offered in read-only mode as well: copying data you may read
        is not an edit, and "give me this list as a spreadsheet" is most of what
        a member table gets used for.
      -->
      <button
        type="button"
        class="flex items-center gap-1 rounded-full border px-2 py-1.5 text-sm transition-colors"
        :class="
          copied
            ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
            : 'border-surface-200 text-surface-600 hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300'
        "
        :title="$t('Collections.export.button')"
        :aria-label="$t('Collections.export.button')"
        @click="exportMenuRef?.toggle($event)"
      >
        <IconCheck v-if="copied" class="h-4 w-4" />
        <IconExport v-else class="h-4 w-4" />
      </button>
      <Menu ref="exportMenuRef" :model="exportMenuItems" popup />

      <!--
        Icon-only actions with a tooltip: the toolbar sits inside a wiki page,
        not on a dedicated admin screen, so it should stay quiet next to the
        prose. The delete action keeps its count as a label — how many rows are
        about to go is not something to hide behind a hover.
      -->
      <Button
        v-if="editable && selection.length > 0"
        :label="$t('Collections.record.deleteSelected', { count: selection.length })"
        severity="danger"
        outlined
        size="small"
        @click="confirmDeleteSelected"
      >
        <template #icon><IconTrash /></template>
      </Button>

      <Button
        v-if="editable"
        severity="secondary"
        outlined
        size="small"
        :title="$t('Collections.settings.button')"
        :aria-label="$t('Collections.settings.button')"
        @click="settingsDialog = true"
      >
        <template #icon><IconSettings /></template>
      </Button>

      <Button
        v-if="editable"
        size="small"
        :title="$t('Collections.record.add')"
        :aria-label="$t('Collections.record.add')"
        @click="openCreate"
      >
        <template #icon><IconPlus /></template>
      </Button>
    </div>

    <!--
      Filter row. Rendered as its own strip under the toolbar rather than inside
      the table header: the DataTable's own filter row would fight the inline
      cell editor for the same column templates.
    -->
    <div
      v-if="showFilters"
      class="flex flex-wrap gap-2 rounded-lg border border-surface-200 bg-surface-50 p-2 dark:border-surface-700 dark:bg-surface-800/50"
    >
      <div
        v-for="field in fields"
        :key="`filter-${field.id}`"
        class="flex min-w-40 flex-1 flex-col gap-1"
      >
        <label class="text-xs text-surface-500 dark:text-surface-400">
          {{ field.label }}
        </label>

        <Select
          v-if="field.type === 'checkbox'"
          v-model="columnFilters[field.key]"
          :options="booleanOptions"
          option-label="label"
          option-value="value"
          show-clear
          size="small"
          class="w-full"
          :placeholder="$t('Collections.filter.any')"
        />

        <MultiSelect
          v-else-if="field.type === 'select' || field.type === 'multiSelect'"
          v-model="columnFilters[field.key]"
          :options="choiceOptions(field)"
          option-label="label"
          option-value="value"
          size="small"
          class="w-full"
          :placeholder="$t('Collections.filter.any')"
        />

        <InputText
          v-else
          v-model="columnFilters[field.key]"
          size="small"
          class="w-full"
          :placeholder="
            field.type === 'number'
              ? $t('Collections.filter.numberHint')
              : $t('Collections.filter.contains')
          "
        />
      </div>
    </div>

    <!--
      The table gets its own horizontal scroll box. A collection with eight
      columns is wider than the wiki's prose column, and a page that scrolls
      sideways as a whole is far worse than a table that does.
    -->
    <div class="w-full overflow-x-auto">
      <DataTable
        v-model:selection="selection"
        :value="filteredRecords"
        data-key="id"
        :loading="loading"
        :edit-mode="editable ? 'cell' : undefined"
        scrollable
        removable-sort
        paginator
        :always-show-paginator="false"
        :rows="25"
        :rows-per-page-options="[25, 50, 100]"
        class="text-sm"
        @cell-edit-init="onCellEditInit"
        @cell-edit-complete="onCellEditComplete"
      >
        <template #empty>
          <div class="px-2 py-8 text-center text-surface-500 dark:text-surface-400">
            <p v-if="isFiltered">{{ $t('Collections.noMatches') }}</p>
            <p v-else>{{ $t('Collections.empty') }}</p>
          </div>
        </template>

        <Column
          v-if="editable"
          selection-mode="multiple"
          header-style="width: 3rem"
        />

        <Column
          v-for="field in fields"
          :key="field.id"
          :field="field.key"
          :sort-field="sortFieldFor(field)"
          :header="field.label"
          sortable
          :style="isNarrowType(field.type) ? 'min-width: 8rem' : 'min-width: 12rem'"
        >
          <template #body="{ data }">
            <!-- checkbox -->
            <span v-if="field.type === 'checkbox'">
              <span
                v-if="data.data[field.key]"
                class="text-emerald-600 dark:text-emerald-400"
                >✓</span
              >
              <span v-else class="text-surface-300 dark:text-surface-600">—</span>
            </span>

            <!-- select: a coloured chip -->
            <span
              v-else-if="field.type === 'select' && data.data[field.key]"
              class="rounded-full px-2 py-0.5 text-xs"
              :class="choiceClasses(colorOf(field, data.data[field.key]))"
            >
              {{ data.data[field.key] }}
            </span>

            <!-- multiSelect: one chip per value -->
            <span
              v-else-if="field.type === 'multiSelect'"
              class="flex flex-wrap gap-1"
            >
              <span
                v-for="value in (data.data[field.key] as string[]) ?? []"
                :key="value"
                class="rounded-full px-2 py-0.5 text-xs"
                :class="choiceClasses(colorOf(field, value))"
              >
                {{ value }}
              </span>
            </span>

            <!-- url / email: clickable, but never swallow the cell-edit click -->
            <a
              v-else-if="field.type === 'url' && data.data[field.key]"
              :href="String(data.data[field.key])"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline"
              @click.stop
            >
              {{ data.data[field.key] }}
            </a>
            <a
              v-else-if="field.type === 'email' && data.data[field.key]"
              :href="`mailto:${data.data[field.key]}`"
              class="text-primary hover:underline"
              @click.stop
            >
              {{ data.data[field.key] }}
            </a>

            <!-- long text is clipped to one line; the row dialog shows it whole -->
            <span
              v-else-if="field.type === 'longText'"
              class="line-clamp-2 whitespace-pre-wrap text-surface-700 dark:text-surface-200"
            >
              {{ displayValue(field, data.data[field.key], locale) }}
            </span>

            <span
              v-else
              :class="
                field.type === 'number'
                  ? 'tabular-nums text-surface-700 dark:text-surface-200'
                  : 'text-surface-700 dark:text-surface-200'
              "
            >
              {{ displayValue(field, data.data[field.key], locale) || '—' }}
            </span>
          </template>

          <template v-if="editable" #editor="{ data }">
            <CollectionValueInput
              v-model="data.data[field.key]"
              :field="field"
              dense
              autofocus
            />
          </template>
        </Column>

        <!-- row actions -->
        <Column v-if="editable" header-style="width: 5rem">
          <template #body="{ data }">
            <div class="flex justify-end gap-0.5">
              <button
                type="button"
                class="rounded p-1 text-surface-400 transition-colors hover:text-primary"
                :title="$t('Collections.record.expand')"
                @click.stop="openEdit(data)"
              >
                <IconExpand class="h-4 w-4" />
              </button>
              <button
                type="button"
                class="rounded p-1 text-surface-400 transition-colors hover:text-rose-500"
                :title="$t('Collections.record.delete')"
                @click.stop="confirmDelete(data)"
              >
                <IconTrash class="h-4 w-4" />
              </button>
            </div>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- footer: counts and the truncation warning -->
    <div
      class="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-500 dark:text-surface-400"
    >
      <span>
        {{
          isFiltered
            ? $t('Collections.countFiltered', {
                shown: filteredRecords.length,
                total: records.length,
              })
            : $t('Collections.count', { count: records.length })
        }}
      </span>
      <span v-if="truncated" class="text-amber-600 dark:text-amber-400">
        {{ $t('Collections.truncated', { total }) }}
      </span>
    </div>

    <CollectionRecordDialog
      v-model:visible="recordDialog"
      :fields="fields"
      :record="editingRecord"
      :saving="saving"
      @save="onDialogSave"
    />

    <CollectionSettingsDialog
      v-model:visible="settingsDialog"
      :collection="collection"
      :fields="collection.fields"
      :saving="saving"
      @add="emit('addField', $event)"
      @update="emit('updateField', $event)"
      @remove="emit('removeField', $event)"
      @reorder="emit('reorderFields', $event)"
      @update-collection="emit('updateCollection', $event)"
      @delete-collection="emit('deleteCollection')"
    />
  </div>
</template>
