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
 * With a preview image (e.g. the thumbnail of a video) the block becomes a
 * link card — image, name, the address with a copy button, and the button:
 *
 *   <div data-type="wiki-button" data-variant="primary">
 *     <p><img src="/api/v1/tenant/<t>/files/db/knowledge/<uuid>.png" alt="Schulungsvideo"></p>
 *     <p><a href="https://…">Schulungsvideo</a></p>
 *   </div>
 *
 * The image is an ordinary editor upload embedded as a real `<img>`, so the
 * framework's reference tracking keeps it alive, the MCP tools list it as a
 * page image and the public site rewrites it like any other picture. The card
 * itself is built by `buildButtonCard`, shared with the read-only renderer.
 *
 * In the editor the block is an atom: a click opens the host's edit dialog
 * (`onEdit`) instead of following the link.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { resolveImageSrc } from './authenticatedImageSrc'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

export const BUTTON_ALIGNS = ['left', 'center', 'right'] as const
export type ButtonAlign = (typeof BUTTON_ALIGNS)[number]

export interface WikiButtonAttrs {
  href: string
  text: string
  variant: ButtonVariant
  align: ButtonAlign
  /** preview image (an uploaded page image path); makes the block a card */
  image?: string | null
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

/** Labels of the link card (they need i18n, which the node has no access to). */
export interface ButtonCardLabels {
  /** the card's button */
  open: string
  copy: string
  copied: string
}

export const DEFAULT_CARD_LABELS: ButtonCardLabels = {
  open: 'Open',
  copy: 'Copy URL',
  copied: 'Copied',
}

/** The address as a reader should see it: without the scheme, or as typed. */
export const displayUrl = (href: string): string =>
  href.replace(/^https?:\/\//i, '').replace(/\/$/, '')

/** Copy text to the clipboard; resolves false when the browser refuses. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const makeLink = (href: string, className: string): HTMLAnchorElement => {
  const link = document.createElement('a')
  link.className = className
  link.setAttribute('href', href)
  if (isExternal(href)) {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
  return link
}

/**
 * The link card of a button with a preview image, shared by the editor's node
 * view and the read-only renderer (utils/wikiReader) so the editor stylesheet
 * styles both. The copy button works on its own; following the links is left
 * to the browser (the editor intercepts them to open its dialog instead).
 */
export const buildButtonCard = (
  attrs: WikiButtonAttrs,
  labels: ButtonCardLabels = DEFAULT_CARD_LABELS,
): HTMLElement => {
  const card = document.createElement('div')
  card.className = 'wiki-link-card'
  card.setAttribute('data-type', BUTTON_TYPE)
  card.setAttribute('data-variant', attrs.variant)
  if (attrs.align !== 'left') card.setAttribute('data-align', attrs.align)

  const media = makeLink(attrs.href, 'wiki-link-card__media')
  const image = document.createElement('img')
  image.className = 'wiki-link-card__image'
  image.alt = attrs.text
  image.setAttribute('loading', 'lazy')
  image.setAttribute('decoding', 'async')
  const src = attrs.image ?? ''
  image.setAttribute('data-src', src)
  image.src = src
  void resolveImageSrc(src)
    .then((resolved) => {
      if (resolved !== src) image.src = resolved
    })
    .catch(() => {
      // the browser's broken-image state is honest enough
    })
  media.append(image)

  const body = document.createElement('div')
  body.className = 'wiki-link-card__body'

  const title = makeLink(attrs.href, 'wiki-link-card__title')
  title.textContent = attrs.text || displayUrl(attrs.href)

  const urlRow = document.createElement('div')
  urlRow.className = 'wiki-link-card__url'
  const url = document.createElement('span')
  url.className = 'wiki-link-card__address'
  url.textContent = displayUrl(attrs.href)
  url.title = attrs.href
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'wiki-link-card__copy'
  copy.setAttribute('data-copy-url', attrs.href)
  copy.textContent = `⧉ ${labels.copy}`
  copy.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    // an app path is copied as the full address someone else can open
    const absolute = attrs.href.startsWith('/')
      ? new URL(attrs.href, window.location.origin).toString()
      : attrs.href
    if (await copyText(absolute)) {
      copy.textContent = `✓ ${labels.copied}`
      setTimeout(() => (copy.textContent = `⧉ ${labels.copy}`), 1500)
    }
  })
  urlRow.append(url, copy)

  const button = makeLink(attrs.href, 'wiki-link-card__button')
  button.textContent = `${labels.open}${isExternal(attrs.href) ? ' ↗' : ''}`

  body.append(title, urlRow, button)
  card.append(media, body)
  return card
}

export interface WikiButtonOptions {
  /** Called when a button is clicked in an editable editor. */
  onEdit?: (ctx: { pos: number; attrs: WikiButtonAttrs }) => void
  /** Tooltip on a button in an editable editor. */
  editHint: string
  /** Labels of the link card (a button with a preview image). */
  cardLabels: ButtonCardLabels
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
    return {
      onEdit: undefined,
      editHint: 'Click to edit',
      cardLabels: DEFAULT_CARD_LABELS,
    }
  },

  addAttributes() {
    return {
      href: { default: '' },
      text: { default: '' },
      variant: { default: 'primary' },
      align: { default: 'left' },
      image: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${BUTTON_TYPE}"]`,
        getAttrs: (element) => {
          const el = element as HTMLElement
          const link = el.querySelector('a')
          const image = el.querySelector('img')?.getAttribute('src') || null
          const variant = el.getAttribute('data-variant')
          const align = el.getAttribute('data-align')
          return {
            href: link?.getAttribute('href') ?? '',
            text: (link?.textContent ?? el.textContent ?? '').trim(),
            variant: isVariant(variant) ? variant : 'primary',
            align: isAlign(align) ? align : 'left',
            image,
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { href, text, variant, align, image } =
      node.attrs as WikiButtonAttrs
    // block ids and anything else UniqueID & co. add stay on the wrapper
    const {
      href: _href,
      text: _text,
      variant: _variant,
      align: _align,
      image: _image,
      ...rest
    } = HTMLAttributes
    const wrapper = mergeAttributes(rest, {
      'data-type': BUTTON_TYPE,
      'data-variant': variant,
      ...(align && align !== 'left' ? { 'data-align': align } : {}),
    })
    const link = ['a', { href }, text || href] as const
    // one paragraph each, so the text projection (turndown) puts the image
    // and the link on lines of their own instead of gluing them together
    return image
      ? [
          'div',
          wrapper,
          ['p', ['img', { src: image, alt: text }]],
          ['p', link],
        ]
      : ['div', wrapper, link]
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
      const attrs = node.attrs as WikiButtonAttrs
      let dom: HTMLElement
      if (attrs.image) {
        dom = buildButtonCard(attrs, this.options.cardLabels)
      } else {
        dom = document.createElement('div')
        dom.setAttribute('data-type', BUTTON_TYPE)
        dom.setAttribute('data-variant', attrs.variant)
        if (attrs.align !== 'left') dom.setAttribute('data-align', attrs.align)
        const link = makeLink(attrs.href, '')
        link.removeAttribute('class')
        link.textContent = attrs.text || attrs.href
        dom.append(link)
      }
      const blockId = HTMLAttributes['data-block-id']
      if (blockId) dom.setAttribute('data-block-id', String(blockId))
      dom.setAttribute('contenteditable', 'false')

      for (const link of Array.from(dom.querySelectorAll('a'))) {
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
      }

      return {
        dom,
        update: (updated) =>
          updated.type.name === node.type.name && updated.eq(node),
        // the copy button is ours; every other click selects the node
        stopEvent: (event) =>
          (event.target as HTMLElement | null)?.closest?.(
            '.wiki-link-card__copy',
          ) != null,
        ignoreMutation: () => true,
      }
    }
  },
})
