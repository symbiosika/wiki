/**
 * Notion-style "/" slash command menu for the block editor.
 *
 * Built on @tiptap/suggestion: typing "/" at the start of an (empty) line
 * opens a filterable command menu rendered by SlashMenu.vue.
 */
import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import { computePosition, flip, shift, offset } from '@floating-ui/dom'
import { i18n } from '@/i18n'
import SlashMenu from './SlashMenu.vue'

export interface SlashCommandItem {
  key: string
  title: string
  description: string
  /** iconify-style label rendered by the menu (plain text/emoji fallback) */
  icon: string
  keywords: string[]
  command: (ctx: { editor: Editor; range: Range }) => void
}

const t = (key: string) => i18n.global.t(key)

export const getSlashCommandItems = (query: string): SlashCommandItem[] => {
  const items: SlashCommandItem[] = [
    {
      key: 'text',
      title: t('Editor.slash.text'),
      description: t('Editor.slash.textDescription'),
      icon: 'T',
      keywords: ['text', 'paragraph', 'absatz'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
      key: 'h1',
      title: t('Editor.slash.h1'),
      description: t('Editor.slash.h1Description'),
      icon: 'H1',
      keywords: ['heading', 'h1', 'überschrift', 'titel'],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setHeading({ level: 1 })
          .run(),
    },
    {
      key: 'h2',
      title: t('Editor.slash.h2'),
      description: t('Editor.slash.h2Description'),
      icon: 'H2',
      keywords: ['heading', 'h2', 'überschrift'],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setHeading({ level: 2 })
          .run(),
    },
    {
      key: 'h3',
      title: t('Editor.slash.h3'),
      description: t('Editor.slash.h3Description'),
      icon: 'H3',
      keywords: ['heading', 'h3', 'überschrift'],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setHeading({ level: 3 })
          .run(),
    },
    {
      key: 'bulletList',
      title: t('Editor.slash.bulletList'),
      description: t('Editor.slash.bulletListDescription'),
      icon: '•',
      keywords: ['list', 'bullet', 'liste', 'aufzählung', 'ul'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      key: 'orderedList',
      title: t('Editor.slash.orderedList'),
      description: t('Editor.slash.orderedListDescription'),
      icon: '1.',
      keywords: ['list', 'ordered', 'numbered', 'nummerierte', 'ol'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      key: 'taskList',
      title: t('Editor.slash.taskList'),
      description: t('Editor.slash.taskListDescription'),
      icon: '☑',
      keywords: ['todo', 'task', 'checkbox', 'aufgabe'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      key: 'blockquote',
      title: t('Editor.slash.quote'),
      description: t('Editor.slash.quoteDescription'),
      icon: '"',
      keywords: ['quote', 'blockquote', 'zitat'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setBlockquote().run(),
    },
    {
      key: 'codeBlock',
      title: t('Editor.slash.code'),
      description: t('Editor.slash.codeDescription'),
      icon: '</>',
      keywords: ['code', 'codeblock', 'snippet'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setCodeBlock().run(),
    },
    {
      key: 'divider',
      title: t('Editor.slash.divider'),
      description: t('Editor.slash.dividerDescription'),
      icon: '—',
      keywords: ['divider', 'rule', 'separator', 'trennlinie', 'hr'],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
  ]

  const q = query.toLowerCase().trim()
  if (!q) return items
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((keyword) => keyword.includes(q)),
  )
}

/** Anchor the menu at the caret position using floating-ui. */
const updateMenuPosition = (
  element: HTMLElement,
  clientRect: (() => DOMRect | null) | null | undefined,
) => {
  const rect = clientRect?.()
  if (!rect) return
  const virtualEl = { getBoundingClientRect: () => rect }
  computePosition(virtualEl, element, {
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    Object.assign(element.style, { left: `${x}px`, top: `${y}px` })
  })
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ query }) => getSlashCommandItems(query),
        render: () => {
          let renderer: VueRenderer | null = null

          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              renderer = new VueRenderer(SlashMenu, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              })
              const el = renderer.element as HTMLElement
              el.style.position = 'absolute'
              el.style.zIndex = '50'
              document.body.appendChild(el)
              updateMenuPosition(el, props.clientRect)
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              renderer?.updateProps({
                items: props.items,
                command: props.command,
              })
              if (renderer) {
                updateMenuPosition(
                  renderer.element as HTMLElement,
                  props.clientRect,
                )
              }
            },
            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === 'Escape') {
                renderer?.destroy()
                renderer?.element?.remove()
                renderer = null
                return true
              }
              return (
                (
                  renderer?.ref as {
                    onKeyDown?: (event: KeyboardEvent) => boolean
                  } | null
                )?.onKeyDown?.(props.event) ?? false
              )
            },
            onExit: () => {
              renderer?.element?.remove()
              renderer?.destroy()
              renderer = null
            },
          }
        },
      }),
    ]
  },
})
