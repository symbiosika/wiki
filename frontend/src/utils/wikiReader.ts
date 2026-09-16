/**
 * Rendering a wiki page for reading, without the editor.
 *
 * Opening a page used to mean building a ProseMirror document for it: parse the
 * blocks into editor JSON, instantiate TipTap, let it render its node views.
 * That cost is proportional to the number of *nodes*, not to the amount of
 * text, and a page imported from a specification document is mostly tables —
 * one paragraph node per cell. A page with 35k cells reaches six-figure node
 * counts and takes the main thread down with it while it is built, which is
 * what a reader on a phone or in a Teams tab experiences as a frozen browser.
 *
 * A reader cannot edit, so none of that machinery is needed: the same blocks
 * can be turned into plain DOM in one pass. This module is that pass. It reuses
 * `blocksToEditorHtml` so the markup — block ids, wikilink markers, task lists,
 * image descriptions — is normalized exactly as it is for the editor, then
 * applies the few things the editor does through node views (image figures,
 * reference chips) directly to the elements.
 *
 * The output is deliberately the same shape the editor renders, down to the
 * class names, so the editor stylesheet (BlockEditor.vue, global) styles both
 * and reading mode cannot drift from editing mode visually.
 */
import type { WikiBlock, WikiTocEntry } from '@/types/wiki'
import { blocksToEditorHtml } from '@/utils/wikiBlocks'
import { sanitizeFragment } from '@/utils/markdown'
import {
  IMAGE_DESCRIPTION_ATTRIBUTE,
  buildImageCaption,
  normalizeImageDescription,
} from '@/components/editor/wikiImage'

const BLOCK_ID_ATTR = 'data-block-id'

export interface WikiReaderOptions {
  /** Label for the folded image-description caption (needs i18n). */
  imageDescriptionLabel: string
}

/**
 * Turn the `<code data-wiki-link>` markers into the chip the editor's node view
 * renders: a span carrying the target, so a delegated click handler can
 * navigate, and the alias as its visible text.
 */
const renderWikiLinks = (root: DocumentFragment): void => {
  for (const marker of Array.from(
    root.querySelectorAll('code[data-wiki-link]'),
  )) {
    const target = marker.getAttribute('data-wiki-link') ?? ''
    const alias = marker.getAttribute('data-wiki-alias')
    const pageId = marker.getAttribute('data-page-id')

    const chip = document.createElement('span')
    chip.className = pageId ? 'wiki-link' : 'wiki-link wiki-link--phantom'
    chip.setAttribute('data-wiki-link', target)
    if (pageId) chip.setAttribute('data-page-id', pageId)
    chip.title = target
    chip.textContent = alias || target
    marker.replaceWith(chip)
  }
}

/**
 * Rebuild the task-item markup the editor's TaskItem node renders:
 * `<li><label><input type=checkbox></label><div>…</div></li>`. The checkbox is
 * disabled — a reader may see what is done, not change it.
 *
 * `blocksToEditorHtml` already normalized the lists and dropped the raw
 * checkbox `marked` produced (it would not survive sanitization anyway), so
 * this builds the element rather than reusing one.
 */
const renderTaskLists = (root: DocumentFragment): void => {
  for (const list of Array.from(
    root.querySelectorAll('ul[data-type="taskList"]'),
  )) {
    for (const item of Array.from(list.children)) {
      if (item.getAttribute('data-type') !== 'taskItem') continue

      const label = document.createElement('label')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.disabled = true
      checkbox.checked = item.getAttribute('data-checked') === 'true'
      label.append(checkbox, document.createElement('span'))

      const content = document.createElement('div')
      while (item.firstChild) content.appendChild(item.firstChild)

      item.append(label, content)
    }
  }
}

/**
 * Wrap every image in the `<figure class="wiki-image">` the image node view
 * builds, with the same lazy-loading hints and the same folded description.
 */
const renderImages = (root: DocumentFragment, label: string): void => {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const figure = document.createElement('figure')
    figure.className = 'wiki-image'
    // A long page can carry hundreds of images; fetching and decoding all of
    // them on render is the second-worst thing a reader's browser can do.
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')

    image.replaceWith(figure)
    figure.append(image)

    const description = normalizeImageDescription(
      image.getAttribute(IMAGE_DESCRIPTION_ATTRIBUTE),
    )
    if (description) figure.append(buildImageCaption(description, label))
  }
}

/**
 * Give every table the scroll container ProseMirror's table view provides
 * (`.tableWrapper`), so a wide table scrolls instead of stretching the page.
 * The block id moves to the wrapper: it identifies the page's top-level block,
 * and deep links look for it among the direct children of the content root.
 */
const wrapTables = (root: DocumentFragment): void => {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    if (table.parentElement?.classList.contains('tableWrapper')) continue
    const wrapper = document.createElement('div')
    wrapper.className = 'tableWrapper'
    const blockId = table.getAttribute(BLOCK_ID_ATTR)
    if (blockId) {
      wrapper.setAttribute(BLOCK_ID_ATTR, blockId)
      table.removeAttribute(BLOCK_ID_ATTR)
    }
    table.replaceWith(wrapper)
    wrapper.append(table)
  }
}

/**
 * Make sure every heading can be scrolled to.
 *
 * In the editor the UniqueID extension gives every block node an id; a block's
 * html only carries one, on its first element, so a markdown block that renders
 * to several headings would leave all but the first without a target. The
 * generated ids are render-local — reading mode never saves — and prefixed so
 * they cannot be mistaken for a stored block id.
 */
const ensureHeadingIds = (root: DocumentFragment): void => {
  let generated = 0
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3'))) {
    if (!heading.getAttribute(BLOCK_ID_ATTR)) {
      heading.setAttribute(BLOCK_ID_ATTR, `heading-${generated++}`)
    }
  }
}

/**
 * Build the read-only DOM for a page's blocks.
 *
 * The fragment's children are the page's top-level blocks, each carrying its
 * `data-block-id` — the contract deep links and the table of contents rely on.
 */
export const renderBlocksForReading = (
  blocks: WikiBlock[],
  options: WikiReaderOptions,
): DocumentFragment => {
  const template = document.createElement('template')
  template.innerHTML = blocksToEditorHtml(blocks)

  // Page content can come from an import, the API or another user, and it is
  // about to be mounted as real DOM — so it is sanitized before anything else
  // touches it (this also drops the raw checkbox inputs of a task list, which
  // renderTaskLists rebuilds).
  sanitizeFragment(template.content)

  renderWikiLinks(template.content)
  renderTaskLists(template.content)
  renderImages(template.content, options.imageDescriptionLabel)
  wrapTables(template.content)
  ensureHeadingIds(template.content)

  return template.content
}

/**
 * Collect the rendered headings for the table of contents, in document order.
 * Mirrors the editor's `collectHeadings`: H1-H3 with visible text, addressed by
 * the block id they carry.
 */
export const collectReaderHeadings = (root: ParentNode): WikiTocEntry[] => {
  const headings: WikiTocEntry[] = []
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3'))) {
    const text = heading.textContent?.trim() ?? ''
    const id = heading.getAttribute(BLOCK_ID_ATTR)
    if (!text || !id) continue
    headings.push({ id, level: Number(heading.tagName.slice(1)), text })
  }
  return headings
}
