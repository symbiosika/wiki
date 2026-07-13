/**
 * Wiki page reference ("wikilink") node — Obsidian-style `[[Page Title]]`.
 *
 * The framework already understands `[[Title]]` (or `[[Title|alias]]`) markers
 * in a page's content: on every save it extracts them into a link graph
 * (resolved links + phantom links to not-yet-existing titles) and exposes
 * outgoing links, backlinks and related pages. This node is the editor side of
 * that feature: a way to insert, render and navigate those references.
 *
 * Serialization is the tricky part. The block editor stores its content as
 * HTML blocks, and the backend materializes a page's plain-text (used for the
 * link extraction, search and embeddings) by running that HTML through
 * Turndown. Turndown escapes square brackets (`[[X]]` → `\[\[X\]\]`), which
 * would break the extraction regex — UNLESS the marker sits inside a `<code>`
 * element, whose content Turndown passes through verbatim. So the node
 * serializes to `<code data-wiki-link="Title">[[Title]]</code>`, which
 * materializes to `` `[[Title]]` `` and is picked up by the framework exactly
 * like a hand-typed wikilink. In the editor itself a node view renders it as a
 * clean, clickable chip (never as code).
 */
import { Node, mergeAttributes } from '@tiptap/core'

export interface WikiLinkAttrs {
  /** the referenced page title (what the backend resolves the link by) */
  target: string
  /** optional display text (`[[Target|alias]]`) */
  alias: string | null
  /** resolved page id, kept for navigation; null for phantom links */
  pageId: string | null
}

export interface WikiLinkOptions {
  /** invoked when a chip is clicked (host wires up router navigation) */
  onNavigate?: (attrs: WikiLinkAttrs) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      /** insert a page reference at the current selection */
      insertWikiLink: (
        attrs: Partial<WikiLinkAttrs> & { target: string },
      ) => ReturnType
    }
  }
}

/** Build the raw `[[Target]]` / `[[Target|alias]]` marker. */
export const wikiLinkMarker = (
  target: string,
  alias?: string | null,
): string => (alias ? `[[${target}|${alias}]]` : `[[${target}]]`)

export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // win over the StarterKit `code` mark when parsing `<code data-wiki-link>`
  priority: 1000,

  addOptions() {
    return { onNavigate: undefined }
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-wiki-link') ?? '',
        renderHTML: (attributes) => ({
          'data-wiki-link': attributes.target as string,
        }),
      },
      alias: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-wiki-alias') || null,
        renderHTML: (attributes) =>
          attributes.alias
            ? { 'data-wiki-alias': attributes.alias as string }
            : {},
      },
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-id') || null,
        renderHTML: (attributes) =>
          attributes.pageId
            ? { 'data-page-id': attributes.pageId as string }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'code[data-wiki-link]', priority: 1000 }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // the `[[Title]]` text child is what the backend extracts the link from
    return [
      'code',
      mergeAttributes(HTMLAttributes, { class: 'wiki-link' }),
      wikiLinkMarker(node.attrs.target, node.attrs.alias),
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const attrs = node.attrs as unknown as WikiLinkAttrs
      const dom = document.createElement('span')
      dom.className = attrs.pageId
        ? 'wiki-link'
        : 'wiki-link wiki-link--phantom'
      dom.setAttribute('data-wiki-link', attrs.target)
      dom.contentEditable = 'false'
      dom.title = attrs.target
      dom.textContent = attrs.alias || attrs.target
      // mousedown (not click) so ProseMirror doesn't swallow the event first
      const onMouseDown = (event: MouseEvent) => {
        event.preventDefault()
        this.options.onNavigate?.(attrs)
      }
      dom.addEventListener('mousedown', onMouseDown)
      return {
        dom,
        destroy: () => dom.removeEventListener('mousedown', onMouseDown),
      }
    }
  },

  addCommands() {
    return {
      insertWikiLink:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                target: attrs.target,
                alias: attrs.alias ?? null,
                pageId: attrs.pageId ?? null,
              },
            })
            // trailing space so the caret leaves the atom and typing continues
            .insertContent(' ')
            .run(),
    }
  },
})
