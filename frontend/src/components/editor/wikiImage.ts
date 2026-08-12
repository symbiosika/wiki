/**
 * Wiki image node: the standard TipTap image plus two persisted attributes,
 * `size` (xs … xxl) and `align` (left | center | right), rendered as
 * `data-size` / `data-align` on the <img> so they survive the block
 * HTML round-trip (see utils/wikiBlocks). The visual mapping lives in the
 * editor stylesheet (BlockEditor.vue).
 *
 * The node also carries a node view, for one reason: images are authenticated
 * API paths, and an `<img src>` cannot send a bearer token. Inside a Microsoft
 * Teams tab the bytes therefore have to be fetched with the token and handed to
 * the element as a blob URL — see ./authenticatedImageSrc. Only the DOM is
 * touched; `node.attrs.src` keeps the real path, so what gets saved is unchanged.
 */
import Image from '@tiptap/extension-image'
import {
  needsAuthenticatedFetch,
  resolveImageSrc,
} from './authenticatedImageSrc'

export const IMAGE_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const
export type ImageAlign = (typeof IMAGE_ALIGNS)[number]

const isSize = (value: string | null): value is ImageSize =>
  !!value && (IMAGE_SIZES as readonly string[]).includes(value)

const isAlign = (value: string | null): value is ImageAlign =>
  !!value && (IMAGE_ALIGNS as readonly string[]).includes(value)

export const WikiImage = Image.extend({
  /**
   * Renders the same `<img>` TipTap would, then swaps in an authenticated blob
   * URL where one is needed. Written as a plain DOM node view (like wikiLink's)
   * rather than a Vue component: it is one element with one async attribute, and
   * a component would add a wrapper that the editor stylesheet would have to
   * know about.
   */
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('img')

      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (value !== null && value !== undefined) {
          dom.setAttribute(key, String(value))
        }
      }

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

      return {
        dom,
        // The element has no children to manage, so any update that changes the
        // node has to go through a fresh node view.
        update: (updated) =>
          updated.type.name === node.type.name && updated.eq(node),
      }
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
    }
  },
})
