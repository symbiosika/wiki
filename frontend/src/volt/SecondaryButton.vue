<template>
    <Button
        unstyled
        :pt="theme"
        :ptOptions="{
            mergeProps: ptViewMerge
        }"
    >
        <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
            <slot :name="slotName" v-bind="slotProps ?? {}" />
        </template>
    </Button>
</template>

<script setup lang="ts">
import Button, { type ButtonPassThroughOptions, type ButtonProps } from 'primevue/button';
import { ref } from 'vue';
import { ptViewMerge } from './utils';

interface Props extends /* @vue-ignore */ ButtonProps {}
defineProps<Props>();

const theme = ref<ButtonPassThroughOptions>({
    root: `inline-flex cursor-pointer select-none items-center justify-center overflow-hidden relative
        px-3 py-2 gap-2 rounded-md disabled:pointer-events-none disabled:opacity-60 transition-colors duration-200
        bg-secondary-100 enabled:hover:bg-secondary-200 enabled:active:bg-secondary-300
        border border-secondary-100 enabled:hover:border-secondary-200 enabled:active:border-secondary-300
        text-secondary-600 enabled:hover:text-secondary-700 enabled:active:text-secondary-800
        dark:bg-secondary-800 dark:enabled:hover:bg-secondary-700 dark:enabled:active:bg-secondary-600
        dark:border-secondary-800 dark:enabled:hover:border-secondary-700 dark:enabled:active:border-secondary-600
        dark:text-secondary-300 dark:enabled:hover:text-secondary-200 dark:enabled:active:text-secondary-100
        focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2
        focus-visible:outline-secondary-600 dark:focus-visible:outline-secondary-300
        p-vertical:flex-col p-fluid:w-full p-fluid:p-icon-only:w-10
        p-icon-only:w-10 p-icon-only:px-0 p-icon-only:gap-0
        p-icon-only:p-rounded:rounded-full p-icon-only:p-rounded:h-10
        p-small:text-sm p-small:px-[0.625rem] p-small:py-[0.375rem]
        p-large:text-[1.125rem] p-large:px-[0.875rem] p-large:py-[0.625rem]
        p-raised:shadow-sm p-rounded:rounded-[2rem]
        p-outlined:bg-transparent enabled:hover:p-outlined:bg-secondary-50 enabled:active:p-outlined:bg-secondary-100
        p-outlined:border-secondary-200 enabled:hover:p-outlined:border-secondary-200 enabled:active:p-outlined:border-secondary-200
        p-outlined:text-secondary-500 enabled:hover:p-outlined:text-secondary-500 enabled:active:p-outlined:text-secondary-500
        dark:p-outlined:bg-transparent dark:enabled:hover:p-outlined:bg-white/5 dark:enabled:active:p-outlined:bg-white/15
        dark:p-outlined:border-secondary-700 dark:enabled:hover:p-outlined:border-secondary-700 dark:enabled:active:p-outlined:border-secondary-700
        dark:p-outlined:text-secondary-400 dark:enabled:hover:p-outlined:text-secondary-400 dark:enabled:active:p-outlined:text-secondary-400
        p-text:bg-transparent enabled:hover:p-text:bg-secondary-50 enabled:active:p-text:bg-secondary-100
        p-text:border-transparent enabled:hover:p-text:border-transparent enabled:active:p-text:border-transparent
        p-text:text-secondary-500 enabled:hover:p-text:text-secondary-500 enabled:active:p-text:text-secondary-500
        dark:p-text:bg-transparent dark:enabled:hover:p-text:bg-secondary-800 dark:enabled:active:p-text:bg-secondary-700
        dark:p-text:border-transparent dark:enabled:hover:p-text:border-transparent dark:enabled:active:p-text:border-transparent
        dark:p-text:text-secondary-400 dark:enabled:hover:p-text:text-secondary-400 dark:enabled:active:p-text:text-secondary-400
    `,
    loadingIcon: ``,
    icon: `p-right:order-1 p-bottom:order-2`,
    label: `font-medium p-icon-only:invisible p-icon-only:w-0
        p-small:text-sm p-large:text-[1.125rem]`,
    pcBadge: {
        root: `min-w-4 h-4 leading-4`
    }
});
</script>
