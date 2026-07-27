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
 * Turndown. So the node serializes to `<code data-wiki-link="Title">[[Title]]
 * </code>`, the form the backend knows (`lib/knowledge/wikilinks.ts`): it
 * materializes back to a plain `[[Title]]` marker and is picked up by the link
 * extraction exactly like a hand-typed wikilink. In the editor itself a node
 * view renders it as a clean, clickable chip (never as code).
 *
 * The reverse direction is `embedWikiLinkMarkers` below: bare `[[Title]]` text
 * — written by an agent through the MCP tools/API, or in a markdown block —
 * becomes a real reference when the page is loaded into the editor.
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

/**
 * `[[Target]]` or `[[Target|alias]]` — target must not contain `[`, `]` or `|`.
 * Backslash-escaped brackets (`\[\[Target\]\]`, as an older escaped text cache
 * produced them) count as a marker too, so such content heals on load.
 */
const PAGE_LINK_PATTERN =
  /\\?\[\\?\[([^[\]|\\]+)(?:\\?\|([^[\]\\]*))?\\?\]\\?\]/g

/**
 * Turn bare `[[Target]]` markers in a loaded document into wikilink elements.
 *
 * References written outside the editor — by an agent through the MCP tools or
 * the API, or in a markdown block — arrive as plain text. Lifting them into the
 * `<code data-wiki-link>` form the node parses makes them real, clickable
 * references, and keeps them that way when the page is saved again.
 *
 * Text inside `<code>` / `<pre>` (including references already in their
 * canonical form) is left alone, so this is idempotent.
 */
export const embedWikiLinkMarkers = (root: ParentNode): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text
    if (!text.nodeValue || !/\\?\[\\?\[/.test(text.nodeValue)) continue
    if (text.parentElement?.closest('code, pre')) continue
    textNodes.push(text)
  }

  for (const node of textNodes) {
    const source = node.nodeValue ?? ''
    const fragment = document.createDocumentFragment()
    let index = 0
    for (const match of source.matchAll(PAGE_LINK_PATTERN)) {
      const target = match[1]!.trim()
      if (!target) continue
      const alias = match[2]?.trim() || null
      fragment.append(source.slice(index, match.index))
      const code = document.createElement('code')
      code.setAttribute('data-wiki-link', target)
      if (alias) code.setAttribute('data-wiki-alias', alias)
      code.className = 'wiki-link'
      code.textContent = wikiLinkMarker(target, alias)
      fragment.append(code)
      index = match.index + match[0].length
    }
    if (index === 0) continue // no marker actually replaced
    fragment.append(source.slice(index))
    node.replaceWith(fragment)
  }
}

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
