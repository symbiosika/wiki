<template>
  <div>
    <div
      class="group flex items-center gap-0.5 rounded-md px-1 py-1.5 text-sm transition-colors lg:py-[3px]"
      :class="
        isActive
          ? 'bg-primary-50 font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
          : 'text-surface-700 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
      "
      :style="{ paddingLeft: `${4 + depth * 14}px` }"
    >
      <!-- expand / collapse -->
      <button
        type="button"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-surface-400 hover:bg-surface-200 hover:text-surface-600 active:bg-surface-200 lg:h-5 lg:w-5 dark:hover:bg-surface-700 dark:hover:text-surface-300 dark:active:bg-surface-700"
        :class="{ 'invisible group-hover:visible': !node.children.length }"
        :aria-label="expanded ? 'collapse' : 'expand'"
        @click.stop="toggleExpanded"
      >
        <IconChevronRight
          class="h-3.5 w-3.5 transition-transform"
          :class="{ 'rotate-90': expanded && node.children.length }"
        />
      </button>

      <!-- title -->
      <button
        type="button"
        class="min-w-0 flex-1 cursor-pointer truncate text-left"
        @click="openPage"
      >
        {{ node.title || $t('Wiki.untitled') }}
      </button>

      <!-- actions: always visible on touch, hover-revealed on desktop -->
      <span
        class="flex shrink-0 items-center lg:hidden lg:group-hover:flex"
        @click.stop
      >
        <button
          type="button"
          :title="$t('Wiki.newSubPage')"
          class="flex h-7 w-7 items-center justify-center rounded text-surface-400 hover:bg-surface-200 hover:text-surface-600 active:bg-surface-200 lg:h-5 lg:w-5 dark:hover:bg-surface-700 dark:hover:text-surface-300 dark:active:bg-surface-700"
          @click="$emit('add-child', node)"
        >
          <IconPlus class="h-4 w-4 lg:h-3.5 lg:w-3.5" />
        </button>
        <button
          type="button"
          :title="$t('Wiki.deletePage')"
          class="flex h-7 w-7 items-center justify-center rounded text-surface-400 hover:bg-surface-200 hover:text-red-600 active:bg-surface-200 lg:h-5 lg:w-5 dark:hover:bg-surface-700 dark:hover:text-red-400 dark:active:bg-surface-700"
          @click="$emit('delete', node)"
        >
          <IconTrash class="h-4 w-4 lg:h-3.5 lg:w-3.5" />
        </button>
      </span>
    </div>

    <div v-if="expanded && node.children.length">
      <WikiTreeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        @add-child="$emit('add-child', $event)"
        @delete="$emit('delete', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import IconChevronRight from '~icons/mdi/chevron-right'
import IconPlus from '~icons/mdi/plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import type { WikiTreeNode } from '@/types/wiki'

const props = withDefaults(
  defineProps<{
    node: WikiTreeNode
    depth?: number
  }>(),
  { depth: 0 },
)

defineEmits<{
  'add-child': [node: WikiTreeNode]
  delete: [node: WikiTreeNode]
}>()

const route = useRoute()
const router = useRouter()

/** shared expansion state, provided by WikiSidebar */
const expandedIds = inject<Ref<Set<string>>>(
  'wikiExpandedIds',
  ref(new Set<string>()),
)

const expanded = computed(() => expandedIds.value.has(props.node.id))
const isActive = computed(() => route.params.pageId === props.node.id)

const toggleExpanded = () => {
  const next = new Set(expandedIds.value)
  if (next.has(props.node.id)) {
    next.delete(props.node.id)
  } else {
    next.add(props.node.id)
  }
  expandedIds.value = next
}

const openPage = () => {
  router.push({
    name: 'WikiPage',
    params: { tenantId: route.params.tenantId, pageId: props.node.id },
  })
}
</script>
