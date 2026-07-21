<template>
  <Popover
    ref="el"
    unstyled
    :pt="theme"
    :ptOptions="{
      mergeProps: ptViewMerge,
    }"
  >
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </Popover>
</template>

<script setup lang="ts">
import Popover, {
  type PopoverPassThroughOptions,
  type PopoverProps,
} from 'primevue/popover'
import { ref } from 'vue'
import { ptViewMerge } from './utils'

interface Props extends /* @vue-ignore */ PopoverProps {}
defineProps<Props>()

const theme = ref<PopoverPassThroughOptions>({
  root: `bg-surface-0 dark:bg-surface-900
        text-surface-700 dark:text-surface-0
        border border-surface-200 dark:border-surface-700
        rounded-md shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]
        before:absolute before:-top-[9px] before:start-[calc(var(--p-anchor-left,1.25rem))]
        before:w-0 before:h-0 before:border-x-[8px] before:border-x-transparent
        before:border-b-[9px] before:border-b-surface-200 dark:before:border-b-surface-700
        after:absolute after:-top-2 after:start-[calc(var(--p-anchor-left,1.25rem))]
        after:w-0 after:h-0 after:border-x-[8px] after:border-x-transparent
        after:border-b-[8px] after:border-b-surface-0 dark:after:border-b-surface-900`,
  content: `p-3`,
  transition: {
    enterFromClass: 'opacity-0 scale-y-90',
    enterActiveClass: 'transition duration-120 ease-[cubic-bezier(0,0,0.2,1)]',
    leaveActiveClass: 'transition-opacity duration-100 ease-linear',
    leaveToClass: 'opacity-0',
  },
})

const el = ref()
defineExpose({
  toggle: (event: any, target?: any) => el.value.toggle(event, target),
  show: (event: any, target?: any) => el.value.show(event, target),
  hide: () => el.value.hide(),
})
</script>
