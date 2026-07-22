/**
 * Parse / serialize the URL-import editor textarea.
 *
 * One entry per line. A line is a list of fields separated by a comma OR a
 * semicolon (use whichever you like — they are interchangeable), in this
 * order:
 *
 *   URL [ SEP  title [ SEP  subpath ] ]
 *
 *   - title:   optional page-title override (otherwise the parsed page title
 *              is used). Leave it empty to give a subpath without a title.
 *   - subpath: optional "/"-separated category page titles (top→bottom) the
 *              imported page is filed under, relative to the job's parent page.
 *              Created on demand during a run.
 *
 * Examples:
 *   https://example.com/a
 *   https://example.com/b ; Nice title
 *   https://example.com/c ; Nice title ; Docs/API Reference
 *   https://example.com/d ; ; Docs/API Reference          (subpath, no title)
 *
 * Fields may contain spaces freely. "/" separates the levels inside the
 * subpath. Because "," and ";" separate the fields, a title cannot itself
 * contain one of those characters. The legacy "url | title" form is still
 * accepted on read.
 */

export interface ParsedUrlLine {
  url: string
  title?: string | null
  subPath?: string[]
}

/** Split a raw path string into trimmed, non-empty level titles. */
export const splitSubPath = (raw: string): string[] =>
  raw
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

/** Parse a single editor line into a structured entry (null if it has no URL). */
export const parseUrlLine = (raw: string): ParsedUrlLine | null => {
  const line = raw.trim()
  if (!line) return null

  // Fields are separated by a comma OR a semicolon (interchangeable). Keep
  // empty fields so an empty title slot ("url ; ; path") still works.
  const fields = line.split(/[;,]/).map((field) => field.trim())

  // The first field holds the URL, optionally with a legacy "| title" suffix.
  let urlField = fields[0] ?? ''
  let title: string | null = null
  const pipe = urlField.indexOf('|')
  if (pipe !== -1) {
    title = urlField.slice(pipe + 1).trim() || null
    urlField = urlField.slice(0, pipe).trim()
  }
  const url = urlField
  if (!url) return null

  // With a legacy pipe title the remaining fields are all subpath; otherwise
  // field 2 is the title and fields 3+ are the subpath. Extra fields are
  // folded into the subpath so "; a ; b" works as an alternative to "; a/b".
  const pathFields = pipe !== -1 ? fields.slice(1) : fields.slice(2)
  if (pipe === -1) {
    const titleField = fields[1] ?? ''
    title = titleField.length > 0 ? titleField : null
  }
  const subPath = pathFields.flatMap(splitSubPath)

  return { url, title, subPath }
}

/** Parse the whole textarea into entries, dropping blank / URL-less lines. */
export const parseUrlLines = (text: string): ParsedUrlLine[] =>
  text
    .split('\n')
    .map(parseUrlLine)
    .filter((entry): entry is ParsedUrlLine => entry !== null)

/**
 * Serialize one entry back to its canonical line. Uses ";" as the field
 * separator; a subpath without a title keeps the empty title slot so the
 * line round-trips ("url ; ; a / b").
 */
export const urlLineToText = (entry: ParsedUrlLine): string => {
  const title = entry.title ?? ''
  const path = entry.subPath ?? []
  if (path.length > 0) {
    const mid = title ? ` ${title} ` : ' '
    return `${entry.url} ;${mid}; ${path.join(' / ')}`
  }
  if (title) {
    return `${entry.url} ; ${title}`
  }
  return entry.url
}

/** Serialize a list of entries into textarea content. */
export const urlLinesToText = (entries: ParsedUrlLine[]): string =>
  entries.map(urlLineToText).join('\n')
