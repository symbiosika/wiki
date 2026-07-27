<script setup lang="ts">
/**
 * One level of the published page tree, recursing into its children.
 *
 * The branch containing the current page is expanded on load and stays open
 * while the visitor moves around inside it.
 */
import { computed, ref, watch } from 'vue'

/**
 * Structurally readonly node type.
 *
 * The tree comes out of the store wrapped in `readonly()`, which makes it
 * deeply readonly. Declaring the prop that way (instead of casting the
 * readonly-ness away at the call site) keeps the store's guarantee intact and
 * still accepts a plain mutable tree.
 */
interface TreeNode {
  readonly id: string
  readonly title: string
  readonly children: readonly TreeNode[]
}

const props = defineProps<{
  nodes: readonly TreeNode[]
  tenantId: string
  activeId: string | null
  depth?: number
}>()

const depth = computed(() => props.depth ?? 0)

/** ids of nodes the visitor opened or that contain the active page */
const opened = ref(new Set<string>())

const containsActive = (node: TreeNode): boolean => {
  if (!props.activeId) return false
  if (node.id === props.activeId) return true
  return node.children.some(containsActive)
}

watch(
  () => props.activeId,
  () => {
    for (const node of props.nodes) {
      if (containsActive(node)) opened.value.add(node.id)
    }
  },
  { immediate: true },
)

const isOpen = (node: TreeNode) => opened.value.has(node.id)

const toggle = (node: TreeNode) => {
  if (isOpen(node)) opened.value.delete(node.id)
  else opened.value.add(node.id)
  // reassign so the Set change is picked up
  opened.value = new Set(opened.value)
}
</script>

<template>
  <ul :class="depth === 0 ? '' : 'ml-3 border-l border-[var(--color-line)] pl-2'">
    <li v-for="node in nodes" :key="node.id" class="py-0.5">
      <div class="flex items-start gap-1">
        <button
          v-if="node.children.length > 0"
          type="button"
          class="mt-1 shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          :aria-label="isOpen(node) ? 'Zuklappen' : 'Aufklappen'"
          :aria-expanded="isOpen(node)"
          @click="toggle(node)"
        >
          <svg
            class="size-3 transition-transform"
            :class="isOpen(node) ? 'rotate-90' : ''"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        <span v-else class="size-3 shrink-0" aria-hidden="true" />

        <RouterLink
          :to="`/${tenantId}/page/${node.id}`"
          class="rounded px-1 py-0.5 text-sm leading-snug hover:bg-[var(--color-surface)]"
          :class="
            node.id === activeId
              ? 'font-semibold text-[var(--color-accent)]'
              : 'text-[var(--color-ink)]'
          "
        >
          {{ node.title }}
        </RouterLink>
      </div>

      <PageTree
        v-if="node.children.length > 0 && isOpen(node)"
        :nodes="node.children"
        :tenant-id="tenantId"
        :active-id="activeId"
        :depth="depth + 1"
      />
    </li>
  </ul>
</template>
