/**
 * Button block: a link shown as a button — label, target and one of a few
 * styles, optionally aligned.
 *
 * Stored as
 *
 *   <div data-type="wiki-button" data-variant="primary" data-align="center">
 *     <a href="https://…">Jetzt anmelden</a>
 *   </div>
 *
 * The real `<a>` inside is deliberate: everything that only reads text — the
 * materialized page text (turndown makes it `[Jetzt anmelden](https://…)`),
 * search, the MCP read tools, the public site — sees an ordinary link and
 * loses nothing but the styling. The styling itself is attached by attribute
 * in the editor stylesheet (BlockEditor.vue), so the read-only renderer
 * (utils/wikiReader) needs no extra step: the stored markup IS the button.
 *
 * In the editor the block is an atom: a click opens the host's edit dialog
 * (`onEdit`) instead of following the link.
 */
import { Node, mergeAttributes } from '@tiptap/core'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

export const BUTTON_ALIGNS = ['left', 'center', 'right'] as const
export type ButtonAlign = (typeof BUTTON_ALIGNS)[number]

export interface WikiButtonAttrs {
  href: string
  text: string
  variant: ButtonVariant
  align: ButtonAlign
}

export const BUTTON_TYPE = 'wiki-button'

const isVariant = (value: string | null): value is ButtonVariant =>
  !!value && (BUTTON_VARIANTS as readonly string[]).includes(value)

const isAlign = (value: string | null): value is ButtonAlign =>
  !!value && (BUTTON_ALIGNS as readonly string[]).includes(value)

/**
 * The link target as it may be stored, or `null` when it is not acceptable.
 *
 * Web addresses, `mailto:`/`tel:` and app-relative paths. A bare
 * "example.com" is what people type, so it becomes https — the same rule as
 * a collection's url column. Anything else (`javascript:`, `data:`) is
 * rejected here, and the reader's sanitizer would strip it anyway.
 */
export const normalizeButtonHref = (
  value: string | null | undefined,
): string | null => {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (/^(mailto:|tel:)\S+$/i.test(raw)) return raw
  if (raw.startsWith('//')) return null
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('#')) return raw
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

const isExternal = (href: string) => /^https?:/i.test(href)

export interface WikiButtonOptions {
  /** Called when a button is clicked in an editable editor. */
  onEdit?: (ctx: { pos: number; attrs: WikiButtonAttrs }) => void
  /** Tooltip on a button in an editable editor. */
  editHint: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiButton: {
      /** Insert a button block at the selection. */
      insertWikiButton: (attrs: WikiButtonAttrs) => ReturnType
    }
  }
}

export const WikiButton = Node.create<WikiButtonOptions>({
  name: 'wikiButton',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { onEdit: undefined, editHint: 'Click to edit' }
  },

  addAttributes() {
    return {
      href: { default: '' },
      text: { default: '' },
      variant: { default: 'primary' },
      align: { default: 'left' },
    }
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${BUTTON_TYPE}"]`,
        getAttrs: (element) => {
          const el = element as HTMLElement
          const link = el.querySelector('a')
          const variant = el.getAttribute('data-variant')
          const align = el.getAttribute('data-align')
          return {
            href: link?.getAttribute('href') ?? '',
            text: (link?.textContent ?? el.textContent ?? '').trim(),
            variant: isVariant(variant) ? variant : 'primary',
            align: isAlign(align) ? align : 'left',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { href, text, variant, align } = node.attrs as WikiButtonAttrs
    // block ids and anything else UniqueID & co. add stay on the wrapper
    const {
      href: _href,
      text: _text,
      variant: _variant,
      align: _align,
      ...rest
    } = HTMLAttributes
    return [
      'div',
      mergeAttributes(rest, {
        'data-type': BUTTON_TYPE,
        'data-variant': variant,
        ...(align && align !== 'left' ? { 'data-align': align } : {}),
      }),
      ['a', { href }, text || href],
    ]
  },

  addCommands() {
    return {
      insertWikiButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },

  addNodeView() {
    return ({ node, editor, getPos, HTMLAttributes }) => {
      const dom = document.createElement('div')
      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (['href', 'text', 'variant', 'align'].includes(key)) continue
        if (value !== null && value !== undefined) {
          dom.setAttribute(key, String(value))
        }
      }
      const attrs = node.attrs as WikiButtonAttrs
      dom.setAttribute('data-type', BUTTON_TYPE)
      dom.setAttribute('data-variant', attrs.variant)
      if (attrs.align !== 'left') dom.setAttribute('data-align', attrs.align)
      dom.setAttribute('contenteditable', 'false')

      const link = document.createElement('a')
      link.setAttribute('href', attrs.href)
      link.textContent = attrs.text || attrs.href
      if (isExternal(attrs.href)) {
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer')
      }
      dom.append(link)

      link.addEventListener('click', (event) => {
        // writing: the button is edited, not followed
        if (!editor.isEditable) return
        event.preventDefault()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos === 'number') {
          this.options.onEdit?.({ pos, attrs })
        }
      })
      link.addEventListener('mouseenter', () => {
        link.title = editor.isEditable ? this.options.editHint : ''
      })

      return {
        dom,
        update: (updated) =>
          updated.type.name === node.type.name && updated.eq(node),
        // clicks on the link are ours; ProseMirror still selects the node
        stopEvent: () => false,
        ignoreMutation: () => true,
      }
    }
  },
})
