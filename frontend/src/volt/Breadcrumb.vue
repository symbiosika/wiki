<template>
    <Breadcrumb
        unstyled
        :pt="theme"
        :ptOptions="{
            mergeProps: ptViewMerge
        }"
        :model="model"
    >
        <template #item="{ item }">
            <router-link
                v-if="item.to"
                :to="item.to"
                :class="[
                    'no-underline flex items-center gap-2 transition-colors duration-200 rounded-md',
                    'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-0',
                    'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    item.class
                ]"
            >
                {{ item.label }}
            </router-link>
            <span
                v-else
                :class="[
                    'flex items-center gap-2',
                    item.class || 'text-surface-500 dark:text-surface-400'
                ]"
            >
                {{ item.label }}
            </span>
        </template>
        <template #separator>
            <IconChevronRight class="w-3 h-3 text-surface-400 dark:text-surface-500 mx-1" />
        </template>
        <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
            <slot :name="slotName" v-bind="slotProps ?? {}" />
        </template>
    </Breadcrumb>
</template>

<script setup lang="ts">
import Breadcrumb, { type BreadcrumbPassThroughOptions, type BreadcrumbProps } from 'primevue/breadcrumb';
import { ref } from 'vue';
import { ptViewMerge } from './utils';
import type { MenuItem } from 'primevue/menuitem';
import IconChevronRight from '~icons/mdi/chevron-right';

interface Props extends /* @vue-ignore */ BreadcrumbProps {
    model?: MenuItem[];
}
defineProps<Props>();

const theme = ref<BreadcrumbPassThroughOptions>({
    root: `bg-surface-0 dark:bg-surface-900 p-4 overflow-x-auto`,
    list: `m-0 p-0 list-none flex items-center flex-nowrap gap-1`,
    item: `flex items-center`,
    itemLink: `no-underline flex items-center gap-1 transition-colors duration-200 rounded-md
        text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-0
        focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary`,
    itemIcon: ``,
    itemLabel: ``,
    separator: `flex items-center text-surface-400 dark:text-surface-500 mx-1`,
    separatorIcon: ``
});
</script>
