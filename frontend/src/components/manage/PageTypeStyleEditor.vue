<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="rounded-lg border border-surface-200 p-3 dark:border-surface-800"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.pageTypes.icon') }}
          </label>
          <PageTypeIconPicker
            :model-value="row.style.icon"
            @update:model-value="setIcon(index, $event)"
          />
        </div>

        <div class="flex min-w-36 flex-1 flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.pageTypes.key') }}
          </label>
          <InputText
            :model-value="row.key"
            class="w-full"
            :disabled="isLocked(row)"
            :placeholder="$t('UserTenants.pageTypes.keyPlaceholder')"
            @update:model-value="setKey(index, $event)"
          />
        </div>

        <div class="flex min-w-36 flex-1 flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.pageTypes.label') }}
          </label>
          <InputText
            :model-value="row.style.label ?? ''"
            class="w-full"
            :placeholder="row.key || $t('UserTenants.pageTypes.keyPlaceholder')"
            @update:model-value="setLabel(index, $event)"
          />
        </div>

        <!--
        colour swatches. The leftmost option clears the colour, which falls back
        to the muted surface tone rather than to a random hue.
      -->
        <div class="flex shrink-0 flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.pageTypes.color') }}
          </label>
          <div class="flex items-center gap-1 py-1.5">
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded-full border border-surface-300 text-surface-400 transition-transform hover:scale-110 dark:border-surface-600"
              :class="{
                'ring-2 ring-primary ring-offset-1 dark:ring-offset-surface-900':
                  !row.style.color,
              }"
              :title="$t('UserTenants.pageTypes.noColor')"
              :aria-label="$t('UserTenants.pageTypes.noColor')"
              @click="setColor(index, undefined)"
            >
              <IconClose class="h-3 w-3" />
            </button>
            <button
              v-for="color in PAGE_TYPE_COLORS"
              :key="color"
              type="button"
              class="h-6 w-6 rounded-full transition-transform hover:scale-110"
              :class="[
                pageTypeSwatchClasses(color),
                {
                  'ring-2 ring-primary ring-offset-1 dark:ring-offset-surface-900':
                    row.style.color === color,
                },
              ]"
              :title="color"
              :aria-label="color"
              @click="setColor(index, color)"
            />
          </div>
        </div>

        <button
          type="button"
          class="mb-1.5 shrink-0 rounded p-2 transition-colors"
          :class="
            isLocked(row)
              ? 'cursor-not-allowed text-surface-300 dark:text-surface-700'
              : 'text-surface-400 hover:bg-surface-100 hover:text-red-500 dark:hover:bg-surface-800'
          "
          :disabled="isLocked(row)"
          :title="
            isLocked(row)
              ? $t('UserTenants.pageTypes.inUseLocked', {
                  count: usageFor(row),
                })
              : $t('UserTenants.pageTypes.remove')
          "
          @click="removeRow(index)"
        >
          <IconTrash class="h-4 w-4" />
        </button>
      </div>

      <!--
        The key is the value stored on every page and validated on write, so
        renaming one that is in use would leave those pages unsaveable. The
        field is locked rather than hidden, and the count is the reason — given
        its own line so it never changes the height of the input columns.
      -->
      <p
        v-if="row.originalKey"
        class="mt-2 text-xs text-surface-400 dark:text-surface-500"
      >
        {{
          isLocked(row)
            ? $t('UserTenants.pageTypes.inUseLocked', { count: usageFor(row) })
            : $t('UserTenants.pageTypes.unused')
        }}
      </p>
    </div>

    <div
      v-if="rows.length === 0"
      class="rounded-lg border border-dashed border-surface-200 p-4 text-center text-sm text-surface-400 dark:border-surface-800 dark:text-surface-500"
    >
      {{ $t('UserTenants.pageTypes.empty') }}
    </div>

    <div>
      <SecondaryButton
        :label="$t('UserTenants.pageTypes.add')"
        size="small"
        @click="addRow"
      >
        <template #icon><IconPlus /></template>
      </SecondaryButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconClose from '~icons/mdi/close'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconPlus from '~icons/mdi/plus'
import type { WikiPageTypeStyle } from '@/types/wiki'
import PageTypeIconPicker from '@/components/manage/PageTypeIconPicker.vue'
import {
  PAGE_TYPE_COLORS,
  pageTypeSwatchClasses,
  type PageTypeColor,
} from '@/utils/pageTypeStyle'

/**
 * One editable page type.
 *
 * The editor works on rows rather than on the `{ pageTypes, pageTypeStyles }`
 * shape it ultimately saves, because a key is edited character by character:
 * mid-typing it can be empty or briefly collide with another row. Rows keep
 * that transient state harmless, and the parent converts and validates once on
 * save.
 */
export interface PageTypeRow {
  /** The key as currently edited — this is what pages store. */
  key: string
  /** The key as loaded; null for a row added in this session. */
  originalKey: string | null
  style: WikiPageTypeStyle
}

const props = defineProps<{
  modelValue: PageTypeRow[]
  /** Pages per page type, organisation-wide. A missing key means unused. */
  usage: Record<string, number>
}>()

const emit = defineEmits<{ 'update:modelValue': [value: PageTypeRow[]] }>()

const rows = computed(() => props.modelValue)

/**
 * Usage is keyed by the stored value, so it is looked up by `originalKey`: a
 * freshly added row has no pages yet no matter what it is called, and a locked
 * row cannot have been renamed.
 */
const usageFor = (row: PageTypeRow): number =>
  row.originalKey ? (props.usage[row.originalKey] ?? 0) : 0

/** A page type that pages still carry can be restyled but not renamed or removed. */
const isLocked = (row: PageTypeRow): boolean => usageFor(row) > 0

const write = (index: number, patch: Partial<PageTypeRow>) => {
  const next = props.modelValue.map((row, i) =>
    i === index ? { ...row, ...patch } : row,
  )
  emit('update:modelValue', next)
}

/**
 * Write one field of a row's style, dropping it when it ends up empty so the
 * saved config stays free of `{}` entries.
 */
const writeStyle = (index: number, change: Partial<WikiPageTypeStyle>) => {
  const merged: WikiPageTypeStyle = {
    ...props.modelValue[index]!.style,
    ...change,
  }
  for (const key of Object.keys(merged) as (keyof WikiPageTypeStyle)[]) {
    if (merged[key] === undefined || merged[key] === '') delete merged[key]
  }
  write(index, { style: merged })
}

const setKey = (index: number, key: string | undefined) =>
  write(index, { key: key ?? '' })

const setIcon = (index: number, icon: string | undefined) =>
  writeStyle(index, { icon })

const setColor = (index: number, color: PageTypeColor | undefined) =>
  writeStyle(index, { color })

const setLabel = (index: number, label: string | undefined) =>
  writeStyle(index, { label: label?.trim() ?? '' })

const addRow = () =>
  emit('update:modelValue', [
    ...props.modelValue,
    { key: '', originalKey: null, style: {} },
  ])

const removeRow = (index: number) => {
  if (isLocked(props.modelValue[index]!)) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}
</script>
