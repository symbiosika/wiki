/**
 * Wiki image node: the standard TipTap image plus three persisted attributes,
 * `size` (xs … xxl), `align` (left | center | right) and `description`,
 * rendered as `data-size` / `data-align` / `data-description` on the <img> so
 * they survive the block HTML round-trip (see utils/wikiBlocks). The visual
 * mapping of size and align lives in the editor stylesheet (BlockEditor.vue).
 *
 * The description is the picture in words: what it shows, for someone — or
 * something — that cannot see it. It is folded away in the UI (a collapsed
 * caption below the image, in reading and editing mode alike) because it is
 * not meant to compete with the image for a human's attention. Its real
 * audience is everything that only reads text: the full-text index, the
 * embedding of a chunk, and an AI client working with the wiki through the MCP
 * server. On the way out of the editor the backend materializes it as an
 * `<image-description src="…">…</image-description>` marker below the image
 * (framework `src/lib/knowledge/image-descriptions.ts`), and
 * `embedImageDescriptions` below folds that marker back onto the image when a
 * markdown block — or a page an agent wrote — is loaded into the editor.
 *
 * The node also carries a node view, for two reasons: images are authenticated
 * API paths, and an `<img src>` cannot send a bearer token — inside a Microsoft
 * Teams tab the bytes have to be fetched with the token and handed to the
 * element as a blob URL (see ./authenticatedImageSrc) — and the caption needs a
 * wrapper element to live in. Only the DOM is touched; `node.attrs` keeps the
 * real values, so what gets saved is unchanged.
 */
import Image, { type ImageOptions } from '@tiptap/extension-image'
import {
  needsAuthenticatedFetch,
  resolveImageSrc,
} from './authenticatedImageSrc'

export const IMAGE_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const
export type ImageAlign = (typeof IMAGE_ALIGNS)[number]

/** The attribute the description is stored in, on the `<img>` itself. */
export const IMAGE_DESCRIPTION_ATTRIBUTE = 'data-description'

const isSize = (value: string | null): value is ImageSize =>
  !!value && (IMAGE_SIZES as readonly string[]).includes(value)

const isAlign = (value: string | null): value is ImageAlign =>
  !!value && (IMAGE_ALIGNS as readonly string[]).includes(value)

/**
 * One line, trimmed, or `null`.
 *
 * A description has to survive as an html attribute, as one line of markdown
 * and inside a search chunk that may be cut at any blank line — so it is
 * normalized once, here, on the way in. The backend does the same thing with
 * the same rule.
 */
export const normalizeImageDescription = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > 0 ? collapsed : null
}

/** `/files/db/<bucket>/<uuid>.<ext>` — the tail two paths of one image share. */
const IMAGE_REF =
  /\/files\/db\/(?:knowledge|images)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}/i

/**
 * The key by which a marker finds its image: an image is embedded with the full
 * API path (`/api/v1/tenant/<t>/files/db/…`) while a marker may carry either
 * form, so both are reduced to the `/files/db/…` tail.
 */
const imageKey = (src: string): string =>
  (IMAGE_REF.exec(src)?.[0] ?? src).trim().toLowerCase()

/**
 * Fold every `<image-description>` marker in a fragment onto the image it
 * describes, then drop the marker.
 *
 * Called on the way INTO the editor (see utils/wikiBlocks), where the markers
 * arrive as raw html: from a markdown block, from a page written through the
 * API/MCP tools, or from an imported document whose parser described its
 * pictures. Without this the marker would be an unknown element that the
 * editor's schema drops on the next save — the description would silently
 * disappear the first time a human touched the page.
 *
 * A marker whose image is not in the fragment is removed as well: it is markup,
 * not text, and leaving it behind would show it to the reader as a stray line.
 */
export const embedImageDescriptions = (
  root: DocumentFragment | HTMLElement,
): void => {
  const markers = Array.from(root.querySelectorAll('image-description'))
  if (markers.length === 0) return

  const images = Array.from(root.querySelectorAll('img'))

  for (const marker of markers) {
    const description = normalizeImageDescription(marker.textContent)
    const key = imageKey(marker.getAttribute('src') ?? '')
    const target =
      images.find((img) => imageKey(img.getAttribute('src') ?? '') === key) ??
      // no match by path: the marker sits directly below its image
      (marker.previousElementSibling?.tagName === 'IMG'
        ? (marker.previousElementSibling as HTMLImageElement)
        : null)

    if (
      target &&
      description &&
      !target.hasAttribute(IMAGE_DESCRIPTION_ATTRIBUTE)
    ) {
      target.setAttribute(IMAGE_DESCRIPTION_ATTRIBUTE, description)
    }
    // a paragraph that held nothing but the marker goes with it
    const parent = marker.parentElement
    marker.remove()
    if (
      parent &&
      parent !== (root as HTMLElement) &&
      parent.tagName === 'P' &&
      parent.textContent?.trim() === '' &&
      parent.children.length === 0
    ) {
      parent.remove()
    }
  }
}

/** The collapsed caption shown under an image that has a description. */
const buildCaption = (description: string, label: string): HTMLElement => {
  const details = document.createElement('details')
  details.className = 'wiki-image-description'
  // not part of the document: ProseMirror must not try to edit or map it
  details.setAttribute('contenteditable', 'false')

  const summary = document.createElement('summary')
  summary.textContent = label
  const body = document.createElement('p')
  body.textContent = description

  details.append(summary, body)
  return details
}

/**
 * The image node's own option: the caption label, which has to come from the
 * component (the extension is constructed outside an i18n context).
 */
export type WikiImageOptions = ImageOptions & { descriptionLabel: string }

export const WikiImage = Image.extend<WikiImageOptions>({
  /**
   * Renders the `<img>` TipTap would, wrapped in a `<figure>` that can also
   * carry the collapsed description, and swaps in an authenticated blob URL
   * where one is needed. Written as a plain DOM node view (like wikiLink's)
   * rather than a Vue component: it is a handful of elements with one async
   * attribute, and a component would add another wrapper that the editor
   * stylesheet would have to know about.
   */
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const figure = document.createElement('figure')
      figure.className = 'wiki-image'

      const dom = document.createElement('img')
      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (value !== null && value !== undefined) {
          dom.setAttribute(key, String(value))
        }
      }
      figure.append(dom)

      const src = String(node.attrs.src ?? '')
      if (needsAuthenticatedFetch(src)) {
        // Keep the real path readable for anything inspecting the DOM (the PDF
        // export walks it) while the visible source is the blob URL.
        dom.setAttribute('data-src', src)
        void resolveImageSrc(src)
          .then((resolved) => dom.setAttribute('src', resolved))
          .catch(() => {
            // Leave the original src in place: the browser then shows its own
            // broken-image state instead of an empty box.
          })
      }

      const description = normalizeImageDescription(
        node.attrs.description as string | null,
      )
      if (description) {
        figure.append(buildCaption(description, this.options.descriptionLabel))
      }

      return {
        dom: figure,
        // The elements have no children to manage, so any update that changes
        // the node has to go through a fresh node view.
        update: (updated) =>
          updated.type.name === node.type.name && updated.eq(node),
      }
    }
  },

  addOptions() {
    return {
      ...(this.parent?.() as ImageOptions),
      descriptionLabel: 'Image description',
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      size: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-size')
          return isSize(value) ? value : null
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.size ? { 'data-size': attributes.size as string } : {},
      },
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-align')
          return isAlign(value) ? value : null
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.align ? { 'data-align': attributes.align as string } : {},
      },
      description: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeImageDescription(
            element.getAttribute(IMAGE_DESCRIPTION_ATTRIBUTE),
          ),
        renderHTML: (attributes: Record<string, unknown>) => {
          const description = normalizeImageDescription(
            attributes.description as string | null,
          )
          return description
            ? { [IMAGE_DESCRIPTION_ATTRIBUTE]: description }
            : {}
        },
      },
    }
  },
})
