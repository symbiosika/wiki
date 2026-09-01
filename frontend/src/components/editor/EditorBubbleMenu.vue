<template>
  <BubbleMenu
    :editor="editor"
    :options="{ placement: 'top', offset: 8 }"
    :should-show="shouldShow"
  >
    <!-- image selected: size + alignment controls -->
    <div
      v-if="editor.isActive('image')"
      class="flex flex-col gap-1 rounded-lg border border-surface-200 bg-surface-0 p-1 shadow-lg dark:border-surface-700 dark:bg-surface-900"
    >
      <div class="flex items-center gap-0.5">
        <button
          v-for="size in sizes"
          :key="size.value"
          type="button"
          :title="size.label"
          class="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors"
          :class="
            imageSize() === size.value
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
              : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
          "
          @click="setSize(size.value)"
        >
          {{ size.label }}
        </button>

        <span class="mx-1 h-5 w-px bg-surface-200 dark:bg-surface-700" />

        <button
          v-for="align in aligns"
          :key="align.value"
          type="button"
          :title="align.label"
          class="flex h-7 min-w-7 items-center justify-center rounded transition-colors"
          :class="
            imageAlign() === align.value
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
              : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
          "
          @click="setAlign(align.value)"
        >
          <component :is="align.icon" class="h-4 w-4" />
        </button>

        <span class="mx-1 h-5 w-px bg-surface-200 dark:bg-surface-700" />

        <!-- description: what the picture shows. Folded away in the page, but
             it is what search, embeddings and AI clients read. -->
        <button
          type="button"
          :title="$t('Editor.image.descriptionHint')"
          class="flex h-7 items-center gap-1 rounded px-1.5 text-xs font-medium transition-colors"
          :class="
            imageDescription()
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
              : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
          "
          @click="toggleDescriptionInput"
        >
          <IconImageText class="h-4 w-4" />
          {{ $t('Editor.image.description') }}
        </button>
      </div>

      <!-- the description itself gets its own row: a long text stays readable
           and editable instead of scrolling inside a one-line field -->
      <div
        v-if="showDescriptionInput"
        class="flex flex-col gap-1 border-t border-surface-200 pt-1 dark:border-surface-700"
      >
        <textarea
          ref="descriptionInputRef"
          v-model="descriptionText"
          rows="4"
          :placeholder="$t('Editor.image.descriptionPlaceholder')"
          class="w-full min-w-[24rem] resize-y rounded border border-surface-200 bg-surface-0 px-2 py-1.5 text-xs leading-relaxed text-surface-900 outline-none focus:border-primary dark:border-surface-700 dark:bg-surface-950 dark:text-surface-0"
          @keydown.enter.exact.prevent="applyDescription"
          @keydown.ctrl.enter.prevent="applyDescription"
          @keydown.meta.enter.prevent="applyDescription"
          @keydown.escape.prevent="showDescriptionInput = false"
        />
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-surface-500 dark:text-surface-400">
            {{ $t('Editor.image.descriptionEditHint') }}
          </span>
          <button
            type="button"
            class="flex h-7 items-center rounded px-2 text-xs font-medium text-primary hover:bg-primary-50 dark:hover:bg-primary-900/30"
            @click="applyDescription"
          >
            {{ $t('Common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- text selected: inline formatting -->
    <div
      v-else
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
import IconAlignLeft from '~icons/mdi/format-align-left'
import IconAlignCenter from '~icons/mdi/format-align-center'
import IconAlignRight from '~icons/mdi/format-align-right'
import IconImageText from '~icons/mdi/image-text'
import {
  IMAGE_SIZES,
  normalizeImageDescription,
  type ImageSize,
  type ImageAlign,
} from './wikiImage'

const props = defineProps<{ editor: Editor }>()

const { t } = useI18n()

const showLinkInput = ref(false)
const linkUrl = ref('')
const linkInputRef = ref<HTMLInputElement | null>(null)

const showDescriptionInput = ref(false)
const descriptionText = ref('')
const descriptionInputRef = ref<HTMLTextAreaElement | null>(null)

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

// ----- image controls --------------------------------------------------------

const sizes = IMAGE_SIZES.map((value) => ({
  value,
  label: value.toUpperCase(),
}))

const aligns: { value: ImageAlign; label: string; icon: unknown }[] = [
  { value: 'left', label: t('Editor.image.alignLeft'), icon: IconAlignLeft },
  {
    value: 'center',
    label: t('Editor.image.alignCenter'),
    icon: IconAlignCenter,
  },
  { value: 'right', label: t('Editor.image.alignRight'), icon: IconAlignRight },
]

const imageSize = () =>
  (props.editor.getAttributes('image').size as ImageSize | null) ?? null
const imageAlign = () =>
  (props.editor.getAttributes('image').align as ImageAlign | null) ?? null

const setSize = (size: ImageSize) => {
  props.editor
    .chain()
    .focus()
    .updateAttributes('image', { size: imageSize() === size ? null : size })
    .run()
}

const imageDescription = () =>
  (props.editor.getAttributes('image').description as string | null) ?? null

/**
 * Open the editor prefilled with what the image already says, or close it.
 * The field wraps over several lines for comfort, but the description is stored
 * as one line — it travels as an html attribute and as one line of markdown,
 * so `normalizeImageDescription` collapses any break the author typed.
 */
const toggleDescriptionInput = () => {
  showDescriptionInput.value = !showDescriptionInput.value
  if (!showDescriptionInput.value) return
  descriptionText.value = imageDescription() ?? ''
  void nextTick(() => descriptionInputRef.value?.focus())
}

/** Store the description on the image (an empty field removes it). */
const applyDescription = () => {
  const description = normalizeImageDescription(descriptionText.value)
  props.editor.chain().focus().updateAttributes('image', { description }).run()
  showDescriptionInput.value = false
}

const setAlign = (align: ImageAlign) => {
  props.editor
    .chain()
    .focus()
    .updateAttributes('image', { align: imageAlign() === align ? null : align })
    .run()
}

/** show for non-empty text selections OR when an image node is selected */
const shouldShow = ({
  editor,
  state,
}: {
  editor: CoreEditor
  state: EditorState
}) => {
  if (editor.isActive('image')) return true
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
