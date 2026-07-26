<template>
  <div
    class="absolute flex flex-col rounded-md shadow-sm transition-shadow"
    :class="[
      colorClass,
      selected ? 'ring-2 ring-primary' : 'hover:shadow-md',
      card.kind === 'heading' ? 'border-0 bg-transparent shadow-none' : 'border',
    ]"
    :style="{
      left: `${card.x}px`,
      top: `${card.y}px`,
      width: `${card.width}px`,
    }"
    @pointerdown.stop="emit('select')"
  >
    <!--
      Drag handle. Dragging is deliberately restricted to this strip so a click
      into the text never moves the card — the two gestures would otherwise be
      indistinguishable on a card you can both type in and drag.
    -->
    <div
      v-if="!readonly"
      class="flex h-5 shrink-0 cursor-grab items-center justify-center rounded-t-md active:cursor-grabbing"
      :title="$t('IdeaBoards.dragHint')"
      @pointerdown.stop.prevent="emit('drag-start', $event)"
    >
      <IconDrag class="h-3.5 w-3.5 text-surface-400/70 dark:text-surface-500" />
    </div>

    <textarea
      ref="textarea"
      :value="card.text"
      :readonly="readonly"
      :placeholder="
        card.kind === 'heading'
          ? $t('IdeaBoards.headingPlaceholder')
          : $t('IdeaBoards.notePlaceholder')
      "
      rows="1"
      class="w-full resize-none bg-transparent px-2 outline-none placeholder:text-surface-400/80"
      :class="
        card.kind === 'heading'
          ? 'pb-1 text-base font-semibold text-surface-800 dark:text-surface-100'
          : 'pb-1 text-sm text-surface-800 dark:text-surface-100'
      "
      @input="onInput"
    />

    <!-- badges: author, comments, links, promoted page -->
    <div
      v-if="hasFooter"
      class="flex items-center gap-2 px-2 pb-1 text-[10px] text-surface-500 dark:text-surface-400"
    >
      <span v-if="showAuthor && initials" :title="card.authorLabel ?? ''">
        ({{ initials }})
      </span>
      <span class="ml-auto flex items-center gap-2">
        <span
          v-if="commentCount > 0"
          class="flex items-center gap-0.5"
          :title="$t('IdeaBoards.commentCount', { count: commentCount })"
        >
          <IconComment class="h-3 w-3" />{{ commentCount }}
        </span>
        <span
          v-if="linkCount > 0"
          class="flex items-center gap-0.5"
          :title="$t('IdeaBoards.linkCount', { count: linkCount })"
        >
          <IconLink class="h-3 w-3" />{{ linkCount }}
        </span>
        <IconPage
          v-if="card.pageId"
          class="h-3 w-3"
          :title="$t('IdeaBoards.hasPage')"
        />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconDrag from '~icons/mdi/drag-horizontal-variant'
import IconComment from '~icons/mdi/comment-outline'
import IconLink from '~icons/mdi/link-variant'
import IconPage from '~icons/mdi/file-document-outline'
import { cardInitials } from '@/utils/ideaBoards'
import type { IdeaCard } from '@/types/ideaBoards'

const props = defineProps<{
  card: IdeaCard
  selected: boolean
  commentCount: number
  linkCount: number
  showAuthor: boolean
  readonly: boolean
}>()

const emit = defineEmits<{
  (e: 'update:text', value: string): void
  (e: 'select'): void
  /** fired from the grip strip only, so typing in the card never drags it */
  (e: 'drag-start', event: PointerEvent): void
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)

/** Grow the textarea with its content so a card never scrolls internally. */
const autoGrow = () => {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const onInput = (event: Event) => {
  emit('update:text', (event.target as HTMLTextAreaElement).value)
  autoGrow()
}

onMounted(autoGrow)
// text can also change from outside (another tab, a reload)
watch(() => props.card.text, () => nextTick(autoGrow))
watch(() => props.card.width, () => nextTick(autoGrow))

const hasFooter = computed(
  () =>
    props.card.kind !== 'heading' &&
    (props.commentCount > 0 ||
      props.linkCount > 0 ||
      !!props.card.pageId ||
      (props.showAuthor && !!initials.value)),
)

const initials = computed(() => cardInitials(props.card.authorLabel))

const colorClass = computed(() => {
  const map: Record<string, string> = {
    yellow:
      'border-yellow-300 bg-yellow-100 dark:border-yellow-500/30 dark:bg-yellow-500/15',
    green:
      'border-green-300 bg-green-100 dark:border-green-500/30 dark:bg-green-500/15',
    blue: 'border-blue-300 bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/15',
    purple:
      'border-purple-300 bg-purple-100 dark:border-purple-500/30 dark:bg-purple-500/15',
    pink: 'border-pink-300 bg-pink-100 dark:border-pink-500/30 dark:bg-pink-500/15',
    neutral:
      'border-surface-300 bg-surface-100 dark:border-surface-600 dark:bg-surface-800',
  }
  return map[props.card.color ?? 'yellow'] ?? map.yellow
})
</script>
