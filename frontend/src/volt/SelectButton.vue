<template>
  <SelectButton
    unstyled
    :pt="theme"
    :ptOptions="{
      mergeProps: ptViewMerge,
    }"
  >
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </SelectButton>
</template>

<script setup lang="ts">
import SelectButton, {
  type SelectButtonPassThroughOptions,
  type SelectButtonProps,
} from 'primevue/selectbutton'
import { ref } from 'vue'
import { ptViewMerge } from './utils'

interface Props extends /* @vue-ignore */ SelectButtonProps {}
defineProps<Props>()

const theme = ref<SelectButtonPassThroughOptions>({
  root: `inline-flex select-none rounded-md p-0.5 gap-0.5
        border border-surface-100 dark:border-surface-950
        bg-surface-100 dark:bg-surface-950`,
  pcToggleButton: {
    root: `inline-flex items-center justify-center overflow-hidden relative cursor-pointer select-none
            rounded-md
            text-surface-500 dark:text-surface-400
            p-checked:text-surface-700 dark:p-checked:text-surface-0
            text-sm font-medium
            focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary
            disabled:cursor-default disabled:opacity-60
            p-invalid:border-red-400 dark:p-invalid:border-red-300
            transition-colors duration-200`,
    content: `relative flex-auto inline-flex items-center justify-center gap-2 py-1 px-3
            rounded-md transition-colors duration-200
            p-checked:bg-surface-0 dark:p-checked:bg-surface-800 p-checked:shadow-[0px_1px_2px_0px_rgba(0,0,0,0.02),0px_1px_2px_0px_rgba(0,0,0,0.04)]`,
    label: ``,
    icon: ``,
  },
})
</script>
