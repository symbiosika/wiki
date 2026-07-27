<template>
  <div>
    <!--
      Row wrapper is `relative` so the drop indicator lines can be positioned
      against the row itself (not the whole subtree). Drag-over / drop live here
      so the whole row width is a drop zone.
    -->
    <div
      class="relative"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div
        class="group flex items-center gap-0.5 rounded-md px-1 py-1.5 text-sm transition-colors lg:py-[3px]"
        :class="[
          isActive
            ? 'bg-primary-50 font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
            : 'text-surface-700 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800',
          isDragging ? 'opacity-40' : '',
          dropMode === 'inside'
            ? 'ring-1 ring-primary ring-inset bg-primary-50 dark:bg-primary-900/30'
            : '',
          draggable ? 'cursor-grab active:cursor-grabbing' : '',
        ]"
        :style="{ paddingLeft: `${4 + depth * 14}px` }"
        :draggable="draggable"
        @dragstart="onDragStart"
        @dragend="onDragEnd"
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

        <!--
          published marker — icon only, so the tree stays scannable. Shown on
          every page reachable without a login, including those that are public
          only through an ancestor, which is exactly the case a reader cannot
          infer from the tree itself.
        -->
        <span
          v-if="node.publicEffective"
          class="flex shrink-0 items-center rounded-full bg-blue-50 px-1 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          :title="$t('Wiki.public.chipHint')"
          :aria-label="$t('Wiki.public.chipHint')"
        >
          <IconGlobe class="h-3 w-3" />
        </span>

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

      <!-- drop indicators (drag & drop) -->
      <div
        v-if="dropMode === 'before'"
        class="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-primary"
      />
      <div
        v-if="dropMode === 'after'"
        class="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-primary"
      />
    </div>

    <div v-if="expanded && node.children.length">
      <WikiTreeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :ancestor-dragged="isDraggedSubtree"
        @add-child="$emit('add-child', $event)"
        @delete="$emit('delete', $event)"
        @move="$emit('move', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import IconChevronRight from '~icons/mdi/chevron-right'
import IconPlus from '~icons/mdi/plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconGlobe from '~icons/mdi/earth'
import type {
  WikiDragState,
  WikiMovePayload,
  WikiTreeNode,
} from '@/types/wiki'

const props = withDefaults(
  defineProps<{
    node: WikiTreeNode
    depth?: number
    /** True when this node sits inside the subtree currently being dragged. */
    ancestorDragged?: boolean
  }>(),
  { depth: 0, ancestorDragged: false },
)

const emit = defineEmits<{
  'add-child': [node: WikiTreeNode]
  delete: [node: WikiTreeNode]
  move: [payload: WikiMovePayload]
}>()

const route = useRoute()
const router = useRouter()
const readOnly = useReadOnly()

/** shared expansion state, provided by WikiSidebar */
const expandedIds = inject<Ref<Set<string>>>(
  'wikiExpandedIds',
  ref(new Set<string>()),
)

/** shared drag state, provided by WikiSidebar */
const dragState = inject<Ref<WikiDragState | null>>(
  'wikiDragState',
  ref(null),
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

// ----- drag & drop ---------------------------------------------------------

/** Which sidebar section this node belongs to; moves stay within one section. */
const scopeKey = computed(() =>
  props.node.teamId
    ? `team:${props.node.teamId}`
    : props.node.tenantWide
      ? 'org'
      : 'personal',
)

// Dragging is only possible while editing (read-only mode is the safe default).
const draggable = computed(() => !readOnly.readOnly)

const isDragging = computed(() => dragState.value?.id === props.node.id)

/** This node is the dragged one, or lives inside the dragged subtree. */
const isDraggedSubtree = computed(
  () => props.ancestorDragged || isDragging.value,
)

/** A valid drop target: something is being dragged, from the same section, and
 * not the dragged node itself or one of its descendants. */
const isValidTarget = computed(
  () =>
    !!dragState.value &&
    !isDraggedSubtree.value &&
    dragState.value.scopeKey === scopeKey.value,
)

const dropMode = ref<'before' | 'inside' | 'after' | null>(null)

const onDragStart = (e: DragEvent) => {
  if (!draggable.value) return
  dragState.value = { id: props.node.id, scopeKey: scopeKey.value }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox only starts a drag when some data is set
    e.dataTransfer.setData('text/plain', props.node.id)
  }
}

const onDragEnd = () => {
  dragState.value = null
  dropMode.value = null
}

const onDragOver = (e: DragEvent) => {
  if (!isValidTarget.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const offset = (e.clientY - rect.top) / rect.height
  dropMode.value = offset < 0.28 ? 'before' : offset > 0.72 ? 'after' : 'inside'
}

const onDragLeave = (e: DragEvent) => {
  // ignore leaves that only move onto a child element of the row
  const related = e.relatedTarget as Node | null
  if (related && (e.currentTarget as HTMLElement).contains(related)) return
  dropMode.value = null
}

const onDrop = (e: DragEvent) => {
  if (!isValidTarget.value || !dropMode.value || !dragState.value) return
  e.preventDefault()
  emit('move', {
    dragId: dragState.value.id,
    targetId: props.node.id,
    mode: dropMode.value,
  })
  dropMode.value = null
}
</script>
