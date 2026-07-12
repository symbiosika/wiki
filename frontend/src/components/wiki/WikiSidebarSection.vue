<template>
  <div :class="nested ? 'mt-1' : 'mt-4'">
    <div
      class="group flex items-center justify-between rounded-md px-2 py-1"
      :class="
        nested
          ? 'text-surface-600 dark:text-surface-300'
          : 'text-surface-400 dark:text-surface-500'
      "
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
        @click="$emit('toggle')"
      >
        <IconChevronRight
          class="h-3 w-3 shrink-0 transition-transform"
          :class="{ 'rotate-90': !collapsed }"
        />
        <span
          class="truncate font-semibold"
          :class="
            nested
              ? 'text-[13px]'
              : 'text-[11px] tracking-wider uppercase'
          "
        >
          {{ label }}
        </span>
      </button>
      <button
        type="button"
        :title="$t('Wiki.newPage')"
        class="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 group-hover:visible hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 dark:hover:text-surface-300"
        @click="$emit('add')"
      >
        <IconPlus class="h-3.5 w-3.5" />
      </button>
    </div>
    <div v-show="!collapsed" class="mt-0.5">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import IconChevronRight from '~icons/mdi/chevron-right'
import IconPlus from '~icons/mdi/plus'

defineProps<{
  label: string
  sectionKey: string
  collapsed: boolean
  nested?: boolean
}>()

defineEmits<{
  toggle: []
  add: []
}>()
</script>
