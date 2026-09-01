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
import { embedWikiLinkMarkers } from '@/components/editor/wikiLink'
import { embedImageDescriptions } from '@/components/editor/wikiImage'

marked.setOptions({ gfm: true, breaks: false })

const BLOCK_ID_ATTR = 'data-block-id'

/** Parse an HTML fragment string into its top-level elements. */
const parseFragment = (html: string): HTMLElement[] => {
  const template = document.createElement('template')
  template.innerHTML = html
  return Array.from(template.content.children) as HTMLElement[]
}

/**
 * Rewrite the markup `marked` produces for a GFM task list
 * (`<li><input type="checkbox"> text</li>`) into the shape the editor's
 * TaskList/TaskItem nodes parse (`<ul data-type="taskList">` with
 * `<li data-type="taskItem" data-checked>`).
 *
 * Without this the editor's schema has no node for a bare checkbox, so it drops
 * it and a checklist silently degrades to a plain bullet list on the next save
 * — losing which items were done. A markdown task list reaches the editor
 * whenever a page was imported or edited through the API/MCP tools.
 */
const embedTaskLists = (root: DocumentFragment | HTMLElement): void => {
  for (const list of Array.from(root.querySelectorAll('ul'))) {
    const items = Array.from(list.children).filter((el) => el.nodeName === 'LI')
    const checkboxes = items.map(
      (item) =>
        Array.from(item.children).find(
          (child) =>
            child.nodeName === 'INPUT' && child.getAttribute('type') === 'checkbox',
        ) ?? null,
    )
    // only a list whose every item carries a checkbox is a task list
    if (items.length === 0 || checkboxes.some((box) => box === null)) continue

    list.setAttribute('data-type', 'taskList')
    items.forEach((item, index) => {
      const box = checkboxes[index]!
      item.setAttribute('data-type', 'taskItem')
      item.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false')
      box.remove()
      // TaskItem's content is `paragraph+`, so the text needs a block wrapper
      if (!item.firstElementChild || item.firstElementChild.nodeName !== 'P') {
        const paragraph = document.createElement('p')
        while (item.firstChild) paragraph.appendChild(item.firstChild)
        item.appendChild(paragraph)
      }
    })
  }
}

/**
 * Parse a fragment on its way INTO the editor: bare `[[Target]]` markers (from
 * a markdown block, or written by an agent through the API/MCP tools) become
 * real page references first, markdown task lists become real checklists, and
 * `<image-description>` markers move onto the image they describe.
 *
 * All three exist because the editor's schema only knows its own nodes: markup
 * it does not recognise is dropped on the next save, so a description (or a
 * checklist state) that is not lifted into a real attribute here is lost the
 * first time a human edits the page.
 */
const parseFragmentForEditor = (html: string): HTMLElement[] => {
  const template = document.createElement('template')
  template.innerHTML = html
  embedWikiLinkMarkers(template.content)
  embedTaskLists(template.content)
  embedImageDescriptions(template.content)
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
    const elements = parseFragmentForEditor(raw)
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
