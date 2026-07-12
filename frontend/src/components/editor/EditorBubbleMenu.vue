<template>
  <BubbleMenu
    :editor="editor"
    :options="{ placement: 'top', offset: 8 }"
    :should-show="shouldShow"
  >
    <div
      class="flex items-center gap-0.5 rounded-lg border border-surface-200 bg-surface-0 p-1 shadow-lg dark:border-surface-700 dark:bg-surface-900"
    >
      <button
        v-for="mark in marks"
        :key="mark.name"
        type="button"
        :title="mark.label"
        class="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors"
        :class="
          mark.isActive()
            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
            : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
        "
        @click="mark.toggle()"
      >
        <span :class="mark.class">{{ mark.icon }}</span>
      </button>

      <span class="mx-1 h-5 w-px bg-surface-200 dark:bg-surface-700" />

      <button
        type="button"
        :title="$t('Editor.bubble.link')"
        class="flex h-7 items-center justify-center rounded px-1.5 text-sm transition-colors"
        :class="
          editor.isActive('link')
            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
            : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
        "
        @click="toggleLinkInput"
      >
        🔗
      </button>

      <template v-if="showLinkInput">
        <input
          ref="linkInputRef"
          v-model="linkUrl"
          type="url"
          :placeholder="$t('Editor.bubble.linkPlaceholder')"
          class="h-7 w-48 rounded border border-surface-200 bg-surface-0 px-2 text-xs text-surface-900 outline-none focus:border-primary dark:border-surface-700 dark:bg-surface-950 dark:text-surface-0"
          @keydown.enter.prevent="applyLink"
          @keydown.escape.prevent="showLinkInput = false"
        />
        <button
          type="button"
          class="flex h-7 items-center rounded px-2 text-xs font-medium text-primary hover:bg-primary-50 dark:hover:bg-primary-900/30"
          @click="applyLink"
        >
          {{ $t('Common.save') }}
        </button>
      </template>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { Editor as CoreEditor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { isTextSelection } from '@tiptap/core'

const props = defineProps<{ editor: Editor }>()

const showLinkInput = ref(false)
const linkUrl = ref('')
const linkInputRef = ref<HTMLInputElement | null>(null)

const marks = [
  {
    name: 'bold',
    label: 'Bold',
    icon: 'B',
    class: 'font-bold',
    isActive: () => props.editor.isActive('bold'),
    toggle: () => props.editor.chain().focus().toggleBold().run(),
  },
  {
    name: 'italic',
    label: 'Italic',
    icon: 'I',
    class: 'italic',
    isActive: () => props.editor.isActive('italic'),
    toggle: () => props.editor.chain().focus().toggleItalic().run(),
  },
  {
    name: 'underline',
    label: 'Underline',
    icon: 'U',
    class: 'underline',
    isActive: () => props.editor.isActive('underline'),
    toggle: () => props.editor.chain().focus().toggleUnderline().run(),
  },
  {
    name: 'strike',
    label: 'Strikethrough',
    icon: 'S',
    class: 'line-through',
    isActive: () => props.editor.isActive('strike'),
    toggle: () => props.editor.chain().focus().toggleStrike().run(),
  },
  {
    name: 'code',
    label: 'Code',
    icon: '<>',
    class: 'font-mono text-xs',
    isActive: () => props.editor.isActive('code'),
    toggle: () => props.editor.chain().focus().toggleCode().run(),
  },
]

/** only show for non-empty text selections (not node selections, not code blocks) */
const shouldShow = ({
  editor,
  state,
}: {
  editor: CoreEditor
  state: EditorState
}) => {
  const { selection } = state
  if (selection.empty) return false
  if (!isTextSelection(selection)) return false
  if (editor.isActive('codeBlock')) return false
  return true
}

const toggleLinkInput = async () => {
  if (props.editor.isActive('link') && !showLinkInput.value) {
    // one click on an active link removes it
    props.editor.chain().focus().unsetLink().run()
    return
  }
  showLinkInput.value = !showLinkInput.value
  if (showLinkInput.value) {
    linkUrl.value = props.editor.getAttributes('link').href ?? ''
    await nextTick()
    linkInputRef.value?.focus()
  }
}

const applyLink = () => {
  const url = linkUrl.value.trim()
  if (url) {
    props.editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run()
  } else {
    props.editor.chain().focus().unsetLink().run()
  }
  showLinkInput.value = false
  linkUrl.value = ''
}

watch(
  () => props.editor.state.selection,
  () => {
    if (!showLinkInput.value) linkUrl.value = ''
  },
)
</script>
