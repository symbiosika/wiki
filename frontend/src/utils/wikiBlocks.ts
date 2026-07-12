/**
 * Conversion between backend content blocks and the TipTap editor document.
 *
 * The backend stores a page as an ordered list of blocks (markdown or html).
 * The editor works on one continuous document. To keep block identities
 * stable across saves (so agents and the version history see minimal diffs),
 * every top-level editor node carries a `data-block-id` attribute that maps
 * back to the backend block id.
 */
import { marked } from 'marked'
import type { WikiBlock } from '@/types/wiki'

marked.setOptions({ gfm: true, breaks: false })

const BLOCK_ID_ATTR = 'data-block-id'

/** Parse an HTML fragment string into its top-level elements. */
const parseFragment = (html: string): HTMLElement[] => {
  const template = document.createElement('template')
  template.innerHTML = html
  return Array.from(template.content.children) as HTMLElement[]
}

/**
 * Convert backend blocks to a single HTML string for the editor.
 *
 * Markdown blocks are rendered to HTML. The block id is attached to the
 * FIRST top-level element of each block; if a markdown block renders to
 * several elements the remaining ones get new ids on the next save (the
 * backend sync handles that as insertions).
 */
export const blocksToEditorHtml = (blocks: WikiBlock[]): string => {
  const parts: string[] = []
  for (const block of blocks) {
    const raw =
      block.type === 'markdown'
        ? (marked.parse(block.content) as string)
        : block.content
    const elements = parseFragment(raw)
    if (elements.length === 0) continue
    if (block.id && !elements[0]!.hasAttribute(BLOCK_ID_ATTR)) {
      elements[0]!.setAttribute(BLOCK_ID_ATTR, block.id)
    }
    parts.push(...elements.map((el) => el.outerHTML))
  }
  return parts.join('\n')
}

/**
 * Convert the editor document (as HTML) back to backend blocks.
 *
 * Each top-level element becomes one `html` block. Ids are taken from the
 * `data-block-id` attribute that the UniqueID extension maintains.
 */
export const editorHtmlToBlocks = (html: string): WikiBlock[] => {
  const elements = parseFragment(html)
  const seen = new Set<string>()
  return elements.map((el) => {
    let id = el.getAttribute(BLOCK_ID_ATTR) ?? undefined
    // guard against duplicated ids (e.g. after copy & paste)
    if (id && seen.has(id)) id = undefined
    if (id) seen.add(id)
    el.removeAttribute(BLOCK_ID_ATTR)
    return {
      id,
      type: 'html' as const,
      content: el.outerHTML,
    }
  })
}

/** Compare two block lists (id + content), used to skip no-op saves. */
export const blocksAreEqual = (a: WikiBlock[], b: WikiBlock[]): boolean => {
  if (a.length !== b.length) return false
  return a.every(
    (block, i) =>
      block.id === b[i]!.id &&
      block.type === b[i]!.type &&
      block.content === b[i]!.content,
  )
}
