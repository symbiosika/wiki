/**
 * Wiki image node: the standard TipTap image plus two persisted attributes,
 * `size` (xs … xxl) and `align` (left | center | right), rendered as
 * `data-size` / `data-align` on the <img> so they survive the block
 * HTML round-trip (see utils/wikiBlocks). The visual mapping lives in the
 * editor stylesheet (BlockEditor.vue).
 */
import Image from '@tiptap/extension-image'

export const IMAGE_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const
export type ImageAlign = (typeof IMAGE_ALIGNS)[number]

const isSize = (value: string | null): value is ImageSize =>
  !!value && (IMAGE_SIZES as readonly string[]).includes(value)

const isAlign = (value: string | null): value is ImageAlign =>
  !!value && (IMAGE_ALIGNS as readonly string[]).includes(value)

export const WikiImage = Image.extend({
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
