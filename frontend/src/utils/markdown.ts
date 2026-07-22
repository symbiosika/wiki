/**
 * Markdown rendering for the UI.
 *
 * A thin, safe wrapper around `marked`. The wiki already uses `marked` for the
 * editor conversion (see `utils/wikiBlocks.ts`); this module is for *display*:
 * turning markdown text (AI chat answers, note blocks, previews) into HTML that
 * is safe to drop into the DOM via `v-html`.
 *
 * Content rendered here can originate from the AI assistant or from other
 * users, so the output is sanitized: script execution, inline event handlers
 * and dangerous URL schemes are stripped before the HTML ever reaches the DOM.
 */
import { marked } from 'marked'

// GFM without hard line breaks — a single newline stays a soft wrap, matching
// how most markdown (and the editor) treats prose. Fenced code, tables, task
// lists etc. are all part of GFM.
marked.setOptions({ gfm: true, breaks: false })

/** Tags that may never survive sanitization, regardless of attributes. */
const FORBIDDEN_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'FORM',
  'INPUT',
  'BUTTON',
  'TEXTAREA',
  'SELECT',
  'LINK',
  'META',
  'BASE',
])

/** URL schemes we allow on links and images. */
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.)/i

const isSafeUrl = (value: string | null): boolean => {
  if (!value) return true
  const trimmed = value.trim()
  if (trimmed === '') return true
  // Strip whitespace and control chars (<= 0x20) so tricks like
  // `java\tscript:` or newlines inside the scheme can't slip past the check.
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[\u0000-\u0020]/g, '')
  return SAFE_URL.test(cleaned)
}

/**
 * Walk the parsed fragment and strip anything unsafe:
 * - forbidden tags are removed entirely
 * - `on*` event handler attributes are dropped
 * - `href`/`src` with unsafe schemes are dropped
 * - external links get `target="_blank"` + `rel="noopener noreferrer"`
 */
const sanitizeFragment = (root: DocumentFragment): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  const toRemove: Element[] = []

  let node = walker.nextNode() as Element | null
  while (node) {
    if (FORBIDDEN_TAGS.has(node.tagName)) {
      toRemove.push(node)
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name)
          continue
        }
        if (
          (name === 'href' || name === 'src' || name === 'xlink:href') &&
          !isSafeUrl(attr.value)
        ) {
          node.removeAttribute(attr.name)
        }
      }

      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? ''
        // open real external links in a new tab, safely
        if (/^https?:/i.test(href)) {
          node.setAttribute('target', '_blank')
          node.setAttribute('rel', 'noopener noreferrer')
        }
      }
    }
    node = walker.nextNode() as Element | null
  }

  for (const el of toRemove) el.remove()
}

const sanitizeHtml = (html: string): string => {
  const template = document.createElement('template')
  template.innerHTML = html
  sanitizeFragment(template.content)
  return template.innerHTML
}

/** Render a full markdown document to sanitized HTML (block-level). */
export const renderMarkdown = (markdown: string): string => {
  if (!markdown) return ''
  const html = marked.parse(markdown, { async: false }) as string
  return sanitizeHtml(html)
}

/** Render a single line of markdown to sanitized HTML (no wrapping `<p>`). */
export const renderMarkdownInline = (markdown: string): string => {
  if (!markdown) return ''
  const html = marked.parseInline(markdown, { async: false }) as string
  return sanitizeHtml(html)
}
