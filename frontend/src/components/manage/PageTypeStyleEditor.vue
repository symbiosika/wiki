<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="pageType in pageTypes"
      :key="pageType"
      class="flex flex-wrap items-center gap-3 rounded-lg border border-surface-200 p-3 dark:border-surface-800"
    >
      <PageTypeIconPicker
        :model-value="styleFor(pageType).icon"
        @update:model-value="setIcon(pageType, $event)"
      />

      <div class="flex min-w-40 flex-1 flex-col gap-1">
        <label
          class="text-xs font-medium text-surface-500 dark:text-surface-400"
        >
          {{ pageType }}
        </label>
        <InputText
          :model-value="styleFor(pageType).label ?? ''"
          class="w-full"
          :placeholder="pageType"
          @update:model-value="setLabel(pageType, $event)"
        />
      </div>

      <!--
        colour swatches. The leftmost option clears the colour, which falls back
        to the muted surface tone rather than to a random hue.
      -->
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-full border border-surface-300 text-surface-400 transition-transform hover:scale-110 dark:border-surface-600"
          :class="{
            'ring-2 ring-primary ring-offset-1 dark:ring-offset-surface-900':
              !styleFor(pageType).color,
          }"
          :title="$t('UserTenants.pageTypes.noColor')"
          :aria-label="$t('UserTenants.pageTypes.noColor')"
          @click="setColor(pageType, undefined)"
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
                styleFor(pageType).color === color,
            },
          ]"
          :title="color"
          :aria-label="color"
          @click="setColor(pageType, color)"
        />
      </div>
    </div>

    <div
      v-if="pageTypes.length === 0"
      class="rounded-lg border border-dashed border-surface-200 p-4 text-center text-sm text-surface-400 dark:border-surface-800 dark:text-surface-500"
    >
      {{ $t('UserTenants.pageTypes.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import IconClose from '~icons/mdi/close'
import type { WikiPageTypeStyle } from '@/types/wiki'
import PageTypeIconPicker from '@/components/manage/PageTypeIconPicker.vue'
import {
  PAGE_TYPE_COLORS,
  pageTypeSwatchClasses,
  type PageTypeColor,
} from '@/utils/pageTypeStyle'

const props = defineProps<{
  /** The tenant's page type vocabulary — one row per entry. */
  pageTypes: string[]
  modelValue: Record<string, WikiPageTypeStyle>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, WikiPageTypeStyle>]
}>()

const styleFor = (pageType: string): WikiPageTypeStyle =>
  props.modelValue[pageType] ?? {}

/**
 * Write one field of one page type's style. Entries that end up empty are
 * dropped instead of stored as `{}`, so the saved config stays free of noise
 * and "has a style" stays equivalent to "has something to show".
 */
const patch = (pageType: string, change: Partial<WikiPageTypeStyle>) => {
  const next: Record<string, WikiPageTypeStyle> = { ...props.modelValue }
  const merged: WikiPageTypeStyle = { ...styleFor(pageType), ...change }
  for (const key of Object.keys(merged) as (keyof WikiPageTypeStyle)[]) {
    if (merged[key] === undefined || merged[key] === '') delete merged[key]
  }
  if (Object.keys(merged).length === 0) {
    delete next[pageType]
  } else {
    next[pageType] = merged
  }
  emit('update:modelValue', next)
}

const setIcon = (pageType: string, icon: string | undefined) =>
  patch(pageType, { icon })

const setColor = (pageType: string, color: PageTypeColor | undefined) =>
  patch(pageType, { color })

const setLabel = (pageType: string, label: string | undefined) =>
  patch(pageType, { label: label?.trim() ?? '' })
</script>
