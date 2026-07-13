/**
 * "[[" suggestion for inserting wiki page references.
 *
 * Typing `[[` opens a filterable menu (WikiLinkMenu.vue) that searches the
 * wiki and inserts a {@link WikiLink} node for the chosen page. When the query
 * matches no existing page the menu offers to create a phantom link to that
 * title — the framework resolves it automatically once a page with that title
 * appears (create or rename), exactly like Obsidian.
 */
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { VueRenderer } from '@tiptap/vue-3'
import { computePosition, flip, shift, offset } from '@floating-ui/dom'
import WikiLinkMenu from './WikiLinkMenu.vue'

/** distinct key so this suggestion doesn't clash with the "/" slash command
 *  (both build on @tiptap/suggestion, which defaults to a shared key) */
const wikiLinkSuggestionKey = new PluginKey('wikiLinkSuggestion')

export interface WikiPageRef {
  id: string
  title: string
}

export interface WikiLinkMenuItem {
  /** page id, or null for a "create new reference" entry */
  id: string | null
  title: string
  isNew?: boolean
}

export interface WikiLinkSuggestionOptions {
  /** search the wiki for pages matching the query */
  search?: (query: string) => Promise<WikiPageRef[]>
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

const buildItems = async (
  query: string,
  search?: (query: string) => Promise<WikiPageRef[]>,
): Promise<WikiLinkMenuItem[]> => {
  const trimmed = query.trim()
  const pages = search ? await search(trimmed) : []
  const items: WikiLinkMenuItem[] = pages
    .slice(0, 8)
    .map((page) => ({ id: page.id, title: page.title }))
  // offer creating a phantom link when the query isn't an exact existing title
  const hasExact = pages.some(
    (page) => page.title.toLowerCase() === trimmed.toLowerCase(),
  )
  if (trimmed && !hasExact) {
    items.push({ id: null, title: trimmed, isNew: true })
  }
  return items
}

export const WikiLinkSuggestion = Extension.create<WikiLinkSuggestionOptions>({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return { search: undefined }
  },

  addProseMirrorPlugins() {
    const search = this.options.search
    return [
      Suggestion<WikiLinkMenuItem>({
        editor: this.editor,
        pluginKey: wikiLinkSuggestionKey,
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        // trigger anywhere, not only after whitespace
        allowedPrefixes: null,
        items: ({ query }) => buildItems(query, search),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertWikiLink({ target: props.title, pageId: props.id })
            .run()
        },
        render: () => {
          let renderer: VueRenderer | null = null

          const destroy = () => {
            renderer?.element?.remove()
            renderer?.destroy()
            renderer = null
          }

          return {
            onStart: (props: SuggestionProps<WikiLinkMenuItem>) => {
              renderer = new VueRenderer(WikiLinkMenu, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              })
              const el = renderer.element as HTMLElement
              el.style.position = 'absolute'
              el.style.zIndex = '50'
              document.body.appendChild(el)
              updateMenuPosition(el, props.clientRect)
            },
            onUpdate: (props: SuggestionProps<WikiLinkMenuItem>) => {
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
                destroy()
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
            onExit: destroy,
          }
        },
      }),
    ]
  },
})
