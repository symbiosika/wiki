<script setup lang="ts">
/**
 * One level of the published page tree, recursing into its children.
 *
 * The branch containing the current page is expanded on load and stays open
 * while the visitor moves around inside it.
 *
 * The whole row is the link, with the twisty as a separate control on top of
 * it. That way the easy-to-hit target does the common thing (open the page)
 * and only the small deliberate target folds the branch.
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
  /** Organisation slug, for building page links. */
  slug: string
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
    opened.value = new Set(opened.value)
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
  <ul
    :class="
      depth === 0
        ? ''
        : 'ml-[11px] border-l border-[var(--color-line)] pl-1.5'
    "
  >
    <li v-for="node in nodes" :key="node.id">
      <div
        class="group relative flex items-stretch rounded-md transition-colors"
        :class="
          node.id === activeId
            ? 'bg-[var(--color-surface)]'
            : 'hover:bg-[var(--color-hover)]'
        "
      >
        <!-- twisty; a placeholder keeps leaf titles aligned with parents -->
        <button
          v-if="node.children.length > 0"
          type="button"
          class="flex w-6 shrink-0 items-center justify-center rounded-l-md text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          :aria-label="isOpen(node) ? 'Unterseiten zuklappen' : 'Unterseiten aufklappen'"
          :aria-expanded="isOpen(node)"
          @click="toggle(node)"
        >
          <svg
            class="size-3 transition-transform duration-150"
            :class="isOpen(node) ? 'rotate-90' : ''"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M4 2l4 4-4 4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span v-else class="w-6 shrink-0" aria-hidden="true" />

        <RouterLink
          :to="`/${slug}/page/${node.id}`"
          class="min-w-0 flex-1 truncate py-1.5 pr-2 text-sm leading-snug"
          :class="
            node.id === activeId
              ? 'font-medium text-[var(--color-accent)]'
              : 'text-[var(--color-ink)]'
          "
          :title="node.title"
        >
          {{ node.title }}
        </RouterLink>

        <!-- active marker, drawn over the parent's indent guide -->
        <span
          v-if="node.id === activeId"
          class="absolute inset-y-1 -left-[7px] w-0.5 rounded-full bg-[var(--color-accent)]"
          aria-hidden="true"
        />
      </div>

      <PageTree
        v-if="node.children.length > 0 && isOpen(node)"
        :nodes="node.children"
        :slug="slug"
        :active-id="activeId"
        :depth="depth + 1"
      />
    </li>
  </ul>
</template>
