<template>
  <div
    class="slash-menu w-72 max-h-80 overflow-y-auto rounded-lg border border-surface-200 bg-surface-0 py-1 shadow-lg dark:border-surface-700 dark:bg-surface-900"
  >
    <template v-if="items.length">
      <button
        v-for="(item, index) in items"
        :key="item.key"
        type="button"
        class="flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors"
        :class="
          index === selectedIndex
            ? 'bg-surface-100 dark:bg-surface-800'
            : 'hover:bg-surface-50 dark:hover:bg-surface-800/60'
        "
        @click="selectItem(index)"
        @mousemove="selectedIndex = index"
      >
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-200 bg-surface-0 font-mono text-xs font-semibold text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300"
        >
          {{ item.icon }}
        </span>
        <span class="min-w-0">
          <span
            class="block truncate text-sm font-medium text-surface-900 dark:text-surface-0"
          >
            {{ item.title }}
          </span>
          <span
            class="block truncate text-xs text-surface-500 dark:text-surface-400"
          >
            {{ item.description }}
          </span>
        </span>
      </button>
    </template>
    <div
      v-else
      class="px-3 py-2 text-sm text-surface-500 dark:text-surface-400"
    >
      {{ $t('Editor.slash.noResults') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SlashCommandItem } from './slashCommands'

const props = defineProps<{
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
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
