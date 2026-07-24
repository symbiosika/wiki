<template>
  <Transition name="toc-slide">
    <aside
      v-if="open"
      class="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-surface-200 bg-surface-0 shadow-xl sm:w-[300px] dark:border-surface-700 dark:bg-surface-900"
    >
      <!-- header -->
      <div
        class="flex items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700"
      >
        <IconListBox class="h-5 w-5 text-primary" />
        <span class="flex-1 font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('Wiki.toc.title') }}
        </span>
        <button
          type="button"
          class="rounded-md p-1 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
          :aria-label="$t('Common.close')"
          @click="$emit('close')"
        >
          <IconClose class="h-5 w-5" />
        </button>
      </div>

      <!-- headings -->
      <nav class="flex-1 overflow-y-auto px-2 py-3">
        <p
          v-if="headings.length === 0"
          class="px-2 text-sm leading-relaxed text-surface-400 dark:text-surface-500"
        >
          {{ $t('Wiki.toc.empty') }}
        </p>
        <ul v-else class="space-y-0.5">
          <li v-for="h in headings" :key="h.id">
            <button
              type="button"
              class="block w-full truncate rounded-md py-1 pr-2 text-left text-sm transition-colors"
              :class="
                h.id === activeId
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-surface-0'
              "
              :style="{ paddingLeft: `${(h.level - 1) * 0.875 + 0.5}rem` }"
              :title="h.text"
              @click="$emit('navigate', h.id)"
            >
              {{ h.text }}
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import IconListBox from '~icons/mdi/format-list-bulleted'
import IconClose from '~icons/mdi/close'
import type { WikiTocEntry } from '@/types/wiki'

const props = defineProps<{
  open: boolean
  headings: WikiTocEntry[]
}>()

defineEmits<{
  close: []
  /** scroll the document to the block id of the clicked heading */
  navigate: [blockId: string]
}>()

// ----- scroll spy: highlight the heading the reader is currently under -------

const activeId = ref('')

/** The scrollable container the document lives in (the app's <main>). */
const scrollEl = (): HTMLElement | null => {
  const prose = document.querySelector<HTMLElement>('.wiki-editor .wiki-prose')
  let node: HTMLElement | null = prose?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

/** DOM element of a heading, addressed by its block id. */
const headingEl = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)

const updateActive = () => {
  if (!props.open || props.headings.length === 0) return
  const scroller = scrollEl()
  const top = scroller ? scroller.getBoundingClientRect().top : 0
  // the last heading whose top has scrolled past the reading line wins
  let current = props.headings[0]!.id
  for (const h of props.headings) {
    const el = headingEl(h.id)
    if (!el) continue
    if (el.getBoundingClientRect().top - top < 96) current = h.id
    else break
  }
  activeId.value = current
}

// throttle scroll handling to one update per animation frame
let frame = 0
const onScroll = () => {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    updateActive()
  })
}

let scroller: HTMLElement | null = null

const attach = () => {
  scroller = scrollEl()
  scroller?.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  nextTick(updateActive)
}

const detach = () => {
  scroller?.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  scroller = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

watch(
  () => props.open,
  (open) => (open ? attach() : detach()),
)

// recompute when the heading set changes (edits, page switch) while open
watch(
  () => props.headings,
  () => {
    if (props.open) nextTick(updateActive)
  },
)

onMounted(() => {
  if (props.open) attach()
})

onBeforeUnmount(detach)
</script>

<style scoped>
.toc-slide-enter-active,
.toc-slide-leave-active {
  transition: transform 0.2s ease;
}
.toc-slide-enter-from,
.toc-slide-leave-to {
  transform: translateX(100%);
}
</style>
