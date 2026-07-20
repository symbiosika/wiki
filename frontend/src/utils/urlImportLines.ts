/**
 * Parse / serialize the URL-import editor textarea.
 *
 * One entry per line. Besides the plain URL a line may carry two optional,
 * order-independent extras, each introduced by its own delimiter:
 *
 *   - a title,  after a "|"
 *   - a subpath, after a "," or ";" — slash-separated category page titles
 *     (top→bottom) the imported page is filed under, relative to the job's
 *     parent page. Created on demand during a run.
 *
 * Examples:
 *   https://example.com/a
 *   https://example.com/b | Nice title
 *   https://example.com/c , Docs/API Reference
 *   https://example.com/d | Nice title ; Team Wiki/Onboarding
 *
 * The URL is everything before the first delimiter, so a title or category
 * name may contain spaces freely. A "/" inside a category name is treated as
 * a level separator, and a "," / ";" is reserved for the subpath — keep those
 * out of titles (or rely on the page's own parsed title instead).
 */

export interface ParsedUrlLine {
  url: string
  title?: string | null
  subPath?: string[]
}

const DELIM = /[|,;]/

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

  const first = line.search(DELIM)
  if (first === -1) return { url: line }

  const url = line.slice(0, first).trim()
  if (!url) return null

  // Walk the remainder as [delimiter, value] tokens so title (|) and subpath
  // (, / ;) can appear in any order; the last of each kind wins.
  let title: string | null = null
  let subPath: string[] = []
  const tokens = line.slice(first).matchAll(/([|,;])([^|,;]*)/g)
  for (const [, delim, value] of tokens) {
    if (delim === '|') title = value.trim() || null
    else subPath = splitSubPath(value)
  }

  return { url, title, subPath }
}

/** Parse the whole textarea into entries, dropping blank / URL-less lines. */
export const parseUrlLines = (text: string): ParsedUrlLine[] =>
  text
    .split('\n')
    .map(parseUrlLine)
    .filter((entry): entry is ParsedUrlLine => entry !== null)

/** Serialize one entry back to its canonical `url [| title] [, a / b]` line. */
export const urlLineToText = (entry: ParsedUrlLine): string => {
  let line = entry.url
  if (entry.title) line += ` | ${entry.title}`
  if (entry.subPath && entry.subPath.length > 0) {
    line += ` , ${entry.subPath.join(' / ')}`
  }
  return line
}

/** Serialize a list of entries into textarea content. */
export const urlLinesToText = (entries: ParsedUrlLine[]): string =>
  entries.map(urlLineToText).join('\n')
