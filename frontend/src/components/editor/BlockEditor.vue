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
import { TableKit } from '@tiptap/extension-table'
import UniqueID from '@tiptap/extension-unique-id'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import { WikiImage } from './wikiImage'
import { WikiLink, embedWikiLinkMarkers, type WikiLinkAttrs } from './wikiLink'
import { WikiLinkSuggestion, type WikiPageRef } from './wikiLinkSuggestion'
import { useToast } from 'primevue/usetoast'
import { SlashCommands } from './slashCommands'
import { blocksToEditorHtml, editorHtmlToBlocks } from '@/utils/wikiBlocks'
import { looksLikeMarkdown } from '@/utils/markdownPaste'
import { renderMarkdown } from '@/utils/markdown'
import { useWiki } from '@/stores/wiki'
import type { WikiBlock, WikiTocEntry } from '@/types/wiki'

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
  /** live: the document's headings, for the table of contents */
  toc: [headings: WikiTocEntry[]]
}>()

const { t } = useI18n()
const toast = useToast()
const wiki = useWiki()
const router = useRouter()

const canUploadImages = computed(() => !!props.tenantId && !!props.pageId)

// ----- page references ("[[wikilinks]]") -------------------------------------

/** Search wiki pages for the "[[" reference picker. */
const searchReferences = async (query: string): Promise<WikiPageRef[]> => {
  if (!props.tenantId || !query.trim()) return []
  const results = await wiki.search(props.tenantId, query)
  return results.map((result) => ({ id: result.id, title: result.title }))
}

/**
 * "/" slash command for a page reference: drop the "[[" trigger so the
 * wikilink picker opens (same flow as typing "[[").
 */
const openReferencePicker = ({
  editor: ed,
  range,
}: {
  editor: CoreEditor
  range: Range
}) => {
  ed.chain().focus().deleteRange(range).insertContent('[[').run()
}

/** Open a referenced page; resolve phantom links (no id yet) by title. */
const openReference = async (attrs: WikiLinkAttrs) => {
  if (!props.tenantId) return
  let pageId = attrs.pageId
  if (!pageId) {
    const results = await wiki.search(props.tenantId, attrs.target)
    pageId =
      results.find(
        (result) => result.title.toLowerCase() === attrs.target.toLowerCase(),
      )?.id ?? null
  }
  if (pageId) {
    router.push({
      name: 'WikiPage',
      params: { tenantId: props.tenantId, pageId },
    })
  } else {
    toast.add({
      severity: 'info',
      summary: t('Editor.wikiLink.notFoundTitle'),
      detail: t('Editor.wikiLink.notFound', { title: attrs.target }),
      life: 4000,
    })
  }
}

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

/**
 * Walk the document and collect its headings (H1-H3) for the table of
 * contents. Each heading carries the top-level block id maintained by the
 * UniqueID extension, so the ToC can scroll straight to the matching node.
 * Headings without visible text are skipped (empty placeholder headings).
 */
const collectHeadings = (): WikiTocEntry[] => {
  const ed = editor.value
  if (!ed) return []
  const headings: WikiTocEntry[] = []
  ed.state.doc.descendants((node) => {
    if (node.type.name !== 'heading') return true
    const text = node.textContent.trim()
    const id = node.attrs['block-id'] as string | null | undefined
    if (text && id) {
      headings.push({ id, level: node.attrs.level as number, text })
    }
    return false // headings have no nested headings to descend into
  })
  return headings
}

const emitToc = () => emit('toc', collectHeadings())

const scheduleEmit = () => {
  pendingChanges = true
  // the ToC tracks the document live (no debounce), the save stays debounced
  emitToc()
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
      // GFM tables (e.g. from PDF/markdown import). Without this the table
      // node isn't in the schema and TipTap silently drops any <table> it is
      // asked to load — losing the whole table (and its cell content) on the
      // next save. See utils/wikiBlocks.ts for the markdown → HTML conversion.
      TableKit.configure({ table: { resizable: true } }),
      WikiImage,
      WikiLink.configure({ onNavigate: openReference }),
      WikiLinkSuggestion.configure({ search: searchReferences }),
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
          'table',
        ],
      }),
      SlashCommands.configure({
        onImage: canUploadImages.value ? openImagePicker : undefined,
        onReference: openReferencePicker,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'wiki-prose focus:outline-none',
      },
      handlePaste: (_view, event) => {
        const data = event.clipboardData

        // 1. image files → upload (needs a page id)
        if (canUploadImages.value) {
          const file = Array.from(data?.files ?? []).find((f) =>
            f.type.startsWith('image/'),
          )
          if (file) {
            event.preventDefault()
            uploadAndInsertImage(file)
            return true
          }
        }

        // 2. markdown-as-plain-text → convert to formatted content.
        // Only when the clipboard has no rich HTML of its own: real rich
        // paste (web pages, Word, our own editor) already carries text/html,
        // which TipTap handles natively. Raw markdown comes as text/plain.
        if (!data) return false
        const html = data.getData('text/html')
        if (html && html.trim()) return false
        const text = data.getData('text/plain')
        if (!text || !looksLikeMarkdown(text)) return false
        event.preventDefault()
        insertMarkdown(text)
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
    onCreate: emitToc,
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

/** Current editor content as blocks (used e.g. for PDF export). */
const getBlocks = (): WikiBlock[] =>
  editor.value ? editorHtmlToBlocks(editor.value.getHTML()) : [...props.blocks]

/**
 * Convert a markdown string to sanitized HTML and insert it at the current
 * cursor position. Used both by the smart paste handler and the manual
 * "insert markdown" dialog.
 */
const insertMarkdown = (markdown: string) => {
  if (!editor.value || !markdown.trim()) return
  const html = renderMarkdown(markdown)
  if (!html) return
  // `[[Target]]` in the pasted markdown becomes a real page reference
  const template = document.createElement('template')
  template.innerHTML = html
  embedWikiLinkMarkers(template.content)
  editor.value.chain().focus().insertContent(template.innerHTML).run()
}

defineExpose({ flush, getBlocks, insertMarkdown })
</script>

<style>
@reference '../../assets/base.css';

/* --- Notion-like editor typography (global: ProseMirror renders unscoped) --- */
.wiki-editor .wiki-prose {
  @apply min-h-[50vh] text-[15px] leading-7 text-surface-800 dark:text-surface-200;
  caret-color: var(--p-primary-color);
}

/*
 * A page whose real content is a collection table does not need half a
 * viewport of empty editor between its intro paragraph and the table. The
 * class is set by views/wiki/page.vue once the page is known to have one.
 */
.wiki-page--with-collection .wiki-editor .wiki-prose {
  @apply min-h-32;
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

/* page reference ("[[wikilink]]") chip — never rendered as code */
.wiki-editor .wiki-prose .wiki-link {
  @apply cursor-pointer rounded px-1 font-sans text-[0.95em] font-normal text-primary no-underline transition-colors;
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}
.wiki-editor .wiki-prose .wiki-link:hover {
  background-color: color-mix(in srgb, var(--p-primary-color) 22%, transparent);
}
.wiki-editor .wiki-prose code.wiki-link {
  @apply bg-transparent p-0 text-primary;
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}
.wiki-editor .wiki-prose .wiki-link.ProseMirror-selectednode {
  @apply outline outline-2 outline-offset-1 outline-primary;
}
/* phantom reference: target page doesn't exist yet */
.wiki-editor .wiki-prose .wiki-link--phantom {
  @apply text-surface-500 dark:text-surface-400;
  background-color: color-mix(in srgb, var(--p-surface-500) 12%, transparent);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
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

/* tables (GFM / imported markdown) */
.wiki-editor .wiki-prose .tableWrapper {
  @apply my-3 overflow-x-auto;
}
.wiki-editor .wiki-prose table {
  @apply w-full border-collapse text-sm;
}
.wiki-editor .wiki-prose th,
.wiki-editor .wiki-prose td {
  @apply border border-surface-200 px-3 py-1.5 text-left align-top dark:border-surface-700;
}
.wiki-editor .wiki-prose th {
  @apply bg-surface-50 font-semibold text-surface-900 dark:bg-surface-800 dark:text-surface-0;
}
/* cell selection + column resize affordances (editable mode) */
.wiki-editor .wiki-prose .selectedCell {
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}
.wiki-editor .wiki-prose .column-resize-handle {
  @apply absolute top-0 -right-[2px] bottom-0 w-1 bg-primary;
  pointer-events: none;
}
.wiki-editor .wiki-prose.resize-cursor {
  cursor: col-resize;
}

.wiki-editor .wiki-prose img {
  @apply my-2 block h-auto max-w-full rounded-lg;
}
.wiki-editor .wiki-prose img.ProseMirror-selectednode {
  @apply outline outline-2 outline-offset-2 outline-primary;
}

/* image size (XS … XXL) — width relative to the content column */
.wiki-editor .wiki-prose img[data-size='xs'] {
  width: 25%;
}
.wiki-editor .wiki-prose img[data-size='sm'] {
  width: 40%;
}
.wiki-editor .wiki-prose img[data-size='md'] {
  width: 55%;
}
.wiki-editor .wiki-prose img[data-size='lg'] {
  width: 70%;
}
.wiki-editor .wiki-prose img[data-size='xl'] {
  width: 85%;
}
.wiki-editor .wiki-prose img[data-size='xxl'] {
  width: 100%;
}

/* image alignment within the content column */
.wiki-editor .wiki-prose img[data-align='left'] {
  margin-left: 0;
  margin-right: auto;
}
.wiki-editor .wiki-prose img[data-align='center'] {
  margin-left: auto;
  margin-right: auto;
}
.wiki-editor .wiki-prose img[data-align='right'] {
  margin-left: auto;
  margin-right: 0;
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
