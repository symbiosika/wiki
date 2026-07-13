<template>
  <div
    class="wiki-link-menu w-80 max-h-80 overflow-y-auto rounded-lg border border-surface-200 bg-surface-0 py-1 shadow-lg dark:border-surface-700 dark:bg-surface-900"
  >
    <template v-if="items.length">
      <button
        v-for="(item, index) in items"
        :key="item.id ?? `new:${item.title}`"
        type="button"
        class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
        :class="
          index === selectedIndex
            ? 'bg-surface-100 dark:bg-surface-800'
            : 'hover:bg-surface-50 dark:hover:bg-surface-800/60'
        "
        @click="selectItem(index)"
        @mousemove="selectedIndex = index"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-surface-200 text-surface-500 dark:border-surface-700 dark:text-surface-400"
        >
          <IconLink v-if="!item.isNew" class="h-4 w-4" />
          <IconPlus v-else class="h-4 w-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span
            class="block truncate text-sm font-medium text-surface-900 dark:text-surface-0"
          >
            <template v-if="item.isNew">
              {{ $t('Editor.wikiLink.createNew', { title: item.title }) }}
            </template>
            <template v-else>{{ item.title }}</template>
          </span>
          <span
            v-if="item.isNew"
            class="block truncate text-xs text-surface-500 dark:text-surface-400"
          >
            {{ $t('Editor.wikiLink.createNewHint') }}
          </span>
        </span>
      </button>
    </template>
    <div
      v-else
      class="px-3 py-2 text-sm text-surface-500 dark:text-surface-400"
    >
      {{ $t('Editor.wikiLink.searching') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import IconLink from '~icons/mdi/link-variant'
import IconPlus from '~icons/mdi/plus'
import type { WikiLinkMenuItem } from './wikiLinkSuggestion'

const props = defineProps<{
  items: WikiLinkMenuItem[]
  command: (item: WikiLinkMenuItem) => void
}>()

const selectedIndex = ref(0)

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  },
)

const selectItem = (index: number) => {
  const item = props.items[index]
  if (item) props.command(item)
}

/** Called by the suggestion plugin (via VueRenderer ref). */
const onKeyDown = (event: KeyboardEvent): boolean => {
  if (!props.items.length) return false
  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }
  if (event.key === 'ArrowUp') {
    selectedIndex.value =
      (selectedIndex.value + props.items.length - 1) % props.items.length
    return true
  }
  if (event.key === 'Enter') {
    selectItem(selectedIndex.value)
    return true
  }
  return false
}

defineExpose({ onKeyDown })
</script>
