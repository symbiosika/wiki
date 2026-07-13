<template>
  <div class="wiki-editor relative">
    <template v-if="editor">
      <DragHandle
        :editor="editor"
        class="drag-handle"
        :compute-position-config="{ placement: 'left-start' }"
      >
        <span
          class="flex h-6 w-5 cursor-grab items-center justify-center rounded text-surface-300 opacity-70 transition-colors hover:bg-surface-100 hover:text-surface-500 active:cursor-grabbing dark:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-400"
        >
          ⠿
        </span>
      </DragHandle>
      <EditorBubbleMenu :editor="editor" />
    </template>
    <EditorContent :editor="editor" />
    <!-- hidden picker for the "/image" slash command -->
    <input
      ref="imageInputRef"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onImageInputChange"
    />
  </div>
</template>

<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import type { Editor as CoreEditor, Range } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import UniqueID from '@tiptap/extension-unique-id'
import Image from '@tiptap/extension-image'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import { useToast } from 'primevue/usetoast'
import { SlashCommands } from './slashCommands'
import { blocksToEditorHtml, editorHtmlToBlocks } from '@/utils/wikiBlocks'
import { useWiki } from '@/stores/wiki'
import type { WikiBlock } from '@/types/wiki'

const props = withDefaults(
  defineProps<{
    blocks: WikiBlock[]
    editable?: boolean
    /** enables image uploads (both required to upload) */
    tenantId?: string
    pageId?: string
  }>(),
  { editable: true },
)

const emit = defineEmits<{
  /** debounced: emitted with the current document as backend blocks */
  change: [blocks: WikiBlock[]]
}>()

const { t } = useI18n()
const toast = useToast()
const wiki = useWiki()

const canUploadImages = computed(() => !!props.tenantId && !!props.pageId)

// ----- image upload ----------------------------------------------------------

const imageInputRef = ref<HTMLInputElement | null>(null)

/** Opened by the "/image" slash command: strip the command text, then pick. */
const openImagePicker = ({
  editor: ed,
  range,
}: {
  editor: CoreEditor
  range: Range
}) => {
  ed.chain().focus().deleteRange(range).run()
  imageInputRef.value?.click()
}

const onImageInputChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-selecting the same file later
  if (file) uploadAndInsertImage(file)
}

/** Upload an image and insert it at the current cursor position. */
const uploadAndInsertImage = async (file: File) => {
  if (!editor.value || !props.tenantId || !props.pageId) return
  if (!file.type.startsWith('image/')) return
  try {
    const result = await wiki.uploadImage(props.tenantId, props.pageId, file)
    editor.value
      .chain()
      .focus()
      .setImage({ src: result.path, alt: file.name })
      .run()
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Editor.imageUploadError'),
      life: 5000,
    })
  }
}

const DEBOUNCE_MS = 700
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingChanges = false

const emitBlocks = () => {
  pendingChanges = false
  if (!editor.value) return
  emit('change', editorHtmlToBlocks(editor.value.getHTML()))
}

const scheduleEmit = () => {
  pendingChanges = true
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(emitBlocks, DEBOUNCE_MS)
}

/** Save immediately (used on blur / unmount / page switch). */
const flush = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (pendingChanges) emitBlocks()
}

const editor = shallowRef<Editor | undefined>(undefined)

onMounted(() => {
  editor.value = new Editor({
    editable: props.editable,
    content: blocksToEditorHtml(props.blocks),
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') {
            return t('Editor.placeholderHeading')
          }
          return t('Editor.placeholder')
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      UniqueID.configure({
        attributeName: 'block-id',
        types: [
          'paragraph',
          'heading',
          'blockquote',
          'codeBlock',
          'bulletList',
          'orderedList',
          'taskList',
          'horizontalRule',
          'image',
        ],
      }),
      SlashCommands.configure({
        onImage: canUploadImages.value ? openImagePicker : undefined,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'wiki-prose focus:outline-none',
      },
      handlePaste: (_view, event) => {
        if (!canUploadImages.value) return false
        const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
          f.type.startsWith('image/'),
        )
        if (!file) return false
        event.preventDefault()
        uploadAndInsertImage(file)
        return true
      },
      handleDrop: (_view, event) => {
        if (!canUploadImages.value) return false
        const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
          f.type.startsWith('image/'),
        )
        if (!file) return false
        event.preventDefault()
        uploadAndInsertImage(file)
        return true
      },
    },
    onUpdate: scheduleEmit,
    onBlur: flush,
  })
})

watch(
  () => props.editable,
  (editable) => editor.value?.setEditable(editable),
)

onBeforeUnmount(() => {
  flush()
  editor.value?.destroy()
})

defineExpose({ flush })
</script>

<style>
@reference '../../assets/base.css';

/* --- Notion-like editor typography (global: ProseMirror renders unscoped) --- */
.wiki-editor .wiki-prose {
  @apply min-h-[50vh] text-[15px] leading-7 text-surface-800 dark:text-surface-200;
  caret-color: var(--p-primary-color);
}

.wiki-editor .wiki-prose > * + * {
  margin-top: 0.375rem;
}

.wiki-editor .wiki-prose h1 {
  @apply mt-8 mb-2 text-3xl font-bold text-surface-900 dark:text-surface-0;
}
.wiki-editor .wiki-prose h2 {
  @apply mt-6 mb-1.5 text-2xl font-semibold text-surface-900 dark:text-surface-0;
}
.wiki-editor .wiki-prose h3 {
  @apply mt-4 mb-1 text-xl font-semibold text-surface-900 dark:text-surface-0;
}

.wiki-editor .wiki-prose a {
  @apply cursor-pointer text-primary underline decoration-primary-300 underline-offset-2 hover:decoration-primary;
}

.wiki-editor .wiki-prose code {
  @apply rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[0.85em] text-pink-600 dark:bg-surface-800 dark:text-pink-400;
}

.wiki-editor .wiki-prose pre {
  @apply my-2 overflow-x-auto rounded-lg bg-surface-900 p-4 font-mono text-sm text-surface-100 dark:bg-surface-950;
}
.wiki-editor .wiki-prose pre code {
  @apply bg-transparent p-0 text-inherit;
}

.wiki-editor .wiki-prose blockquote {
  @apply my-2 border-l-[3px] border-surface-300 pl-4 text-surface-600 dark:border-surface-600 dark:text-surface-400;
}

.wiki-editor .wiki-prose ul:not([data-type='taskList']) {
  @apply list-disc pl-6;
}
.wiki-editor .wiki-prose ol {
  @apply list-decimal pl-6;
}
.wiki-editor .wiki-prose li > p {
  margin: 0;
}

.wiki-editor .wiki-prose ul[data-type='taskList'] {
  @apply list-none pl-1;
}
.wiki-editor .wiki-prose ul[data-type='taskList'] li {
  @apply flex items-start gap-2;
}
.wiki-editor .wiki-prose ul[data-type='taskList'] li > label {
  @apply mt-1.5 flex shrink-0 items-center;
}
.wiki-editor .wiki-prose ul[data-type='taskList'] li > div {
  @apply min-w-0 flex-1;
}
.wiki-editor
  .wiki-prose
  ul[data-type='taskList']
  li[data-checked='true']
  > div {
  @apply text-surface-400 line-through dark:text-surface-500;
}
.wiki-editor .wiki-prose ul[data-type='taskList'] input[type='checkbox'] {
  @apply h-4 w-4 cursor-pointer accent-primary;
}

.wiki-editor .wiki-prose hr {
  @apply my-6 border-t border-surface-200 dark:border-surface-700;
}

.wiki-editor .wiki-prose img {
  @apply my-2 h-auto max-w-full rounded-lg;
}
.wiki-editor .wiki-prose img.ProseMirror-selectednode {
  @apply outline outline-2 outline-offset-2 outline-primary;
}

/* Placeholder */
.wiki-editor .wiki-prose p.is-empty::before,
.wiki-editor .wiki-prose h1.is-empty::before,
.wiki-editor .wiki-prose h2.is-empty::before,
.wiki-editor .wiki-prose h3.is-empty::before {
  content: attr(data-placeholder);
  @apply pointer-events-none float-left h-0 text-surface-400 dark:text-surface-600;
}
/* only show the paragraph placeholder on the focused (or only) empty node */
.wiki-editor .wiki-prose p.is-empty:not(.has-focus):not(:only-child)::before {
  content: '';
}

/* Drag handle */
.drag-handle {
  z-index: 10;
}

/* selection */
.wiki-editor .wiki-prose ::selection {
  @apply bg-primary-100 dark:bg-primary-900;
}
</style>
