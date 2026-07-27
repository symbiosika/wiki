/**
 * Markdown rendering for the public documentation site.
 *
 * Three jobs beyond plain markdown:
 *
 *   1. Sanitizing. The output goes into the DOM via `v-html`, and page content
 *      is authored by people, so scripts, event handlers and dangerous URL
 *      schemes are stripped first.
 *   2. Image rewriting. Pages embed images as `/files/db/knowledge/<uuid>.<ext>`,
 *      a path that needs `files:read`. Public readers have no scopes at all, so
 *      those are rewritten to the per-page public image endpoint, which
 *      authorizes by "page is published AND references this file".
 *   3. Wiki links. Pages reference each other Obsidian-style as `[[Title]]`
 *      (usually wrapped in backticks by the editor). Links to published pages
 *      become real links; everything else degrades to plain text — an
 *      unresolvable target means the page is internal, and rendering a dead
 *      link would advertise that it exists.
 *
 * The sanitizer mirrors `frontend/src/utils/markdown.ts`. It is duplicated
 * rather than imported because the two apps are separate build roots with no
 * shared package; if a third consumer ever appears, extracting one is the fix.
 */
import { marked } from 'marked'

// GFM without hard line breaks, matching the authenticated app so a page reads
// the same in both.
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

/** URL schemes allowed on links and images. */
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.)/i

const isSafeUrl = (value: string | null): boolean => {
  if (!value) return true
  const trimmed = value.trim()
  if (trimmed === '') return true
  // Strip whitespace and control chars so `java\tscript:` can't slip past.
  const cleaned = trimmed.replace(/[\u0000-\u0020]/g, '')
  return SAFE_URL.test(cleaned)
}

/** `/files/db/knowledge/<uuid>.<ext>` as embedded by the editor. */
const KNOWLEDGE_IMAGE = /\/files\/db\/knowledge\/([0-9a-f-]{36}\.[a-z0-9]{1,8})/i

/** `[[Target]]` or `[[Target|alias]]`. */
const WIKI_LINK = /^\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]$/

export interface RenderOptions {
  /**
   * Tenant id — the API's identifier, used for image URLs. Distinct from
   * `slug`, which is what appears in this app's routes.
   */
  tenantId: string
  /** Organisation slug, for building links to other pages. */
  slug: string
  /** Page the content belongs to — image authorization is per page. */
  pageId: string
  /** Resolve a wiki-link target title to a published page id, or null. */
  resolveLink?: (title: string) => string | null
}

/** Route for a page in this app (hash routing — see router.ts). */
export const pageHref = (slug: string, pageId: string) =>
  `#/${slug}/page/${pageId}`

/**
 * Replace a `[[Target]]` marker with an anchor when the target is published,
 * and with its plain display text otherwise.
 */
const renderWikiLink = (raw: string, options: RenderOptions): string | null => {
  const match = WIKI_LINK.exec(raw.trim())
  if (!match) return null

  const target = match[1]!.trim()
  const label = (match[2] ?? target).trim() || target
  const escaped = label.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  )

  const targetId = options.resolveLink?.(target) ?? null
  if (!targetId) return `<span class="wiki-link-missing">${escaped}</span>`
  return `<a href="${pageHref(options.slug, targetId)}">${escaped}</a>`
}

/**
 * Walk the parsed fragment and strip anything unsafe, then point image sources
 * at the public endpoint.
 */
const sanitizeFragment = (root: DocumentFragment, options: RenderOptions): void => {
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

      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') ?? ''
        const image = KNOWLEDGE_IMAGE.exec(src)
        if (image) {
          node.setAttribute(
            'src',
            `/api/v1/public/wiki/${options.tenantId}/pages/${options.pageId}/images/${image[1]}`,
          )
          node.setAttribute('loading', 'lazy')
        }
      }

      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? ''
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

const sanitizeHtml = (html: string, options: RenderOptions): string => {
  const template = document.createElement('template')
  template.innerHTML = html
  sanitizeFragment(template.content, options)
  return template.innerHTML
}

/**
 * Resolve wiki links before handing the text to marked.
 *
 * Runs on the raw markdown rather than the rendered HTML so the replacement
 * text is parsed as markdown, and skips fenced code blocks so a `[[…]]` inside
 * an example stays an example. Inline code spans are handled too, because the
 * editor serializes wiki links as `` `[[Title]]` ``.
 */
const resolveWikiLinks = (markdown: string, options: RenderOptions): string => {
  const segments = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)

  return segments
    .map((segment, index) => {
      // odd indices are the fenced blocks captured above — leave them alone
      if (index % 2 === 1) return segment
      return segment
        // backtick-wrapped form produced by the editor
        .replace(/`(\[\[[^[\]]+\]\])`/g, (whole, marker: string) => {
          return renderWikiLink(marker, options) ?? whole
        })
        // bare form, as written by hand or by an agent
        .replace(/\[\[[^[\]]+\]\]/g, (marker) => {
          return renderWikiLink(marker, options) ?? marker
        })
    })
    .join('')
}

/** Render a markdown document to sanitized, link-resolved HTML. */
export const renderMarkdown = (markdown: string, options: RenderOptions): string => {
  if (!markdown) return ''
  const withLinks = resolveWikiLinks(markdown, options)
  const html = marked.parse(withLinks, { async: false }) as string
  return sanitizeHtml(html, options)
}

/**
 * Plain text of a markdown snippet, for search result previews where markup
 * would only add noise.
 */
export const markdownToText = (markdown: string): string => {
  if (!markdown) return ''
  const template = document.createElement('template')
  template.innerHTML = marked.parse(markdown, { async: false }) as string
  return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim()
}
