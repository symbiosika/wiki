/**
 * Download block: a file attached to the page, shown as a card with name,
 * type and size — and, for a picture, a preview.
 *
 * Stored as
 *
 *   <div data-type="wiki-download" data-name="Preisliste.pdf"
 *        data-size="482133" data-mime="application/pdf">
 *     <a href="/api/v1/tenant/<t>/files/db/knowledge/<uuid>.pdf">Preisliste.pdf</a>
 *   </div>
 *
 * The file lives in the framework's "knowledge" bucket, like an editor image
 * (backend `lib/wiki/page-files.ts`). The `<a>` with the `/files/db/knowledge/…`
 * path is what makes that work: the framework's reference tracking finds the
 * path in the page text and keeps the file alive for as long as a page embeds
 * it, and every text-only reader (search, MCP tools, public site) sees an
 * ordinary link named after the file.
 *
 * The bytes are always fetched through the page-scoped download route
 * (`/tenant/<t>/wiki/<page>/files/<file>`), never by following the stored
 * path: that route checks the page's visibility, answers with
 * `Content-Disposition: attachment`, and works inside Teams, where only a
 * bearer token authenticates (see ./authenticatedImageSrc).
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { resolveImageSrc } from './authenticatedImageSrc'

export const DOWNLOAD_TYPE = 'wiki-download'

export interface WikiDownloadAttrs {
  /** the stored `…/files/db/knowledge/<uuid>.<ext>` path */
  src: string
  name: string
  /** bytes, or null when unknown */
  size: number | null
  mime: string | null
}

/** Largest upload the backend accepts — keep in sync with page-files.ts. */
export const MAX_DOWNLOAD_SIZE_BYTES = 25 * 1024 * 1024

/** `<uuid>.<ext>` of a stored path, which is what the download route takes. */
export const downloadFileName = (src: string): string | null => {
  const match =
    /\/files\/db\/knowledge\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.[a-z0-9]{1,8})?)$/i.exec(
      src.trim(),
    )
  return match ? match[1]! : null
}

/** Human-readable size, e.g. "1,2 MB" — locale-aware, binary units. */
export const formatFileSize = (
  bytes: number | null | undefined,
  locale = 'de',
): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return ''
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${units[unit]}`
}

/** "PDF", "XLSX", … — the extension of the file name, upper-cased. */
export const fileExtensionLabel = (name: string): string => {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toUpperCase().slice(0, 6)
}

/**
 * Whether the card shows the file itself as its preview. Raster images only:
 * an svg is stored as an inert octet-stream (it could carry script) and would
 * not render anyway.
 */
export const hasImagePreview = (attrs: Pick<WikiDownloadAttrs, 'mime' | 'name'>) =>
  /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(attrs.mime ?? '') ||
  (!attrs.mime && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(attrs.name))

const parseSize = (value: string | null): number | null => {
  if (!value) return null
  const size = Number(value)
  return Number.isFinite(size) && size >= 0 ? size : null
}

/** Read the block attributes from stored markup (editor and reader alike). */
export const readDownloadAttrs = (element: Element): WikiDownloadAttrs => {
  const link = element.querySelector('a')
  const src = link?.getAttribute('href') ?? element.getAttribute('data-src') ?? ''
  const name =
    element.getAttribute('data-name') ||
    (link?.textContent ?? '').trim() ||
    src.split('/').pop() ||
    ''
  return {
    src,
    name,
    size: parseSize(element.getAttribute('data-size')),
    mime: element.getAttribute('data-mime'),
  }
}

export interface DownloadCardLabels {
  download: string
  locale: string
}

/**
 * The card DOM, shared by the editor's node view and the read-only renderer
 * (utils/wikiReader) so both look the same and the editor stylesheet styles
 * both. The download button carries `data-download-src` / `data-download-name`;
 * the host handles the click (it knows the tenant and page).
 */
export const buildDownloadCard = (
  attrs: WikiDownloadAttrs,
  labels: DownloadCardLabels,
): HTMLElement => {
  const card = document.createElement('div')
  card.className = 'wiki-download'
  card.setAttribute('data-type', DOWNLOAD_TYPE)
  card.setAttribute('contenteditable', 'false')

  const preview = document.createElement('div')
  preview.className = 'wiki-download__preview'
  if (hasImagePreview(attrs) && attrs.src) {
    const img = document.createElement('img')
    img.alt = ''
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
    img.setAttribute('data-src', attrs.src)
    img.src = attrs.src
    void resolveImageSrc(attrs.src)
      .then((resolved) => {
        if (resolved !== attrs.src) img.src = resolved
      })
      .catch(() => {
        // the browser's broken-image state is honest enough
      })
    preview.append(img)
    card.classList.add('wiki-download--image')
  } else {
    const badge = document.createElement('span')
    badge.className = 'wiki-download__badge'
    badge.textContent = fileExtensionLabel(attrs.name) || 'FILE'
    preview.append(badge)
  }

  const meta = document.createElement('div')
  meta.className = 'wiki-download__meta'
  const name = document.createElement('div')
  name.className = 'wiki-download__name'
  name.textContent = attrs.name
  name.title = attrs.name
  const info = document.createElement('div')
  info.className = 'wiki-download__info'
  info.textContent = [
    fileExtensionLabel(attrs.name),
    formatFileSize(attrs.size, labels.locale),
  ]
    .filter(Boolean)
    .join(' · ')
  meta.append(name, info)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'wiki-download__button'
  button.setAttribute('data-download-src', attrs.src)
  button.setAttribute('data-download-name', attrs.name)
  button.textContent = `↓ ${labels.download}`

  card.append(preview, meta, button)
  return card
}

export interface WikiDownloadOptions {
  /** Fetch and save the file (the host knows tenant and page). */
  onDownload?: (attrs: WikiDownloadAttrs) => void
  labels: DownloadCardLabels
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiDownload: {
      /** Insert a download block at the selection. */
      insertWikiDownload: (attrs: WikiDownloadAttrs) => ReturnType
    }
  }
}

export const WikiDownload = Node.create<WikiDownloadOptions>({
  name: 'wikiDownload',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      onDownload: undefined,
      labels: { download: 'Download', locale: 'de' },
    }
  },

  addAttributes() {
    return {
      src: { default: '' },
      name: { default: '' },
      size: { default: null },
      mime: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${DOWNLOAD_TYPE}"]`,
        getAttrs: (element) => ({ ...readDownloadAttrs(element as HTMLElement) }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { src, name, size, mime } = node.attrs as WikiDownloadAttrs
    const {
      src: _src,
      name: _name,
      size: _size,
      mime: _mime,
      ...rest
    } = HTMLAttributes
    return [
      'div',
      mergeAttributes(rest, {
        'data-type': DOWNLOAD_TYPE,
        'data-name': name,
        ...(size !== null && size !== undefined
          ? { 'data-size': String(size) }
          : {}),
        ...(mime ? { 'data-mime': mime } : {}),
      }),
      ['a', { href: src }, name || src],
    ]
  },

  addCommands() {
    return {
      insertWikiDownload:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const attrs = node.attrs as WikiDownloadAttrs
      const dom = buildDownloadCard(attrs, this.options.labels)
      const blockId = HTMLAttributes['data-block-id']
      if (blockId) dom.setAttribute('data-block-id', String(blockId))

      dom
        .querySelector('.wiki-download__button')
        ?.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          this.options.onDownload?.(attrs)
        })

      return {
        dom,
        update: (updated) =>
          updated.type.name === node.type.name && updated.eq(node),
        stopEvent: (event) =>
          (event.target as HTMLElement | null)?.closest?.(
            '.wiki-download__button',
          ) != null,
        ignoreMutation: () => true,
      }
    }
  },
})
