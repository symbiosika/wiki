/**
 * Markdown-aware paste support for the block editor.
 *
 * When text is copied from a plain-text source (a `.md` file, a chat message,
 * a terminal, GitHub "raw" view, …) the clipboard usually only carries
 * `text/plain` holding the *raw* markdown. TipTap then inserts it verbatim, so
 * `## Heading`, `**bold**` and `- item` stay as literal characters instead of
 * becoming formatted content.
 *
 * `looksLikeMarkdown` is a conservative heuristic that decides whether a piece
 * of pasted plain text is worth converting. The actual markdown → HTML
 * conversion reuses the sanitized `renderMarkdown` from `utils/markdown.ts`.
 */

/**
 * Heuristic: does this plain text look like it was authored in Markdown?
 *
 * Kept deliberately conservative so ordinary prose is never mangled:
 * - a single *structural* construct (heading, fenced code, blockquote, link,
 *   image or a GFM table) is enough — these almost never occur by accident;
 * - lists need at least two consecutive items, because a single "- foo" line
 *   is common in plain notes;
 * - inline emphasis (`**bold**`, `` `code` ``, `~~strike~~`) is weak on its own,
 *   so two independent inline signals are required. Single `*italic*` / `_x_`
 *   are intentionally ignored — far too easy to trip on normal text.
 *
 * Conversion is always undoable (Ctrl/Cmd+Z), so a rare false positive is a
 * minor annoyance rather than data loss.
 */
export const looksLikeMarkdown = (text: string): boolean => {
  const value = (text ?? '').replace(/\r\n?/g, '\n')
  if (!value.trim()) return false

  // Strong, rarely-ambiguous constructs — a single hit is enough.
  const strong: RegExp[] = [
    /^#{1,6}[ \t]+\S/m, // # ATX heading
    /^[ \t]*```/m, // ``` fenced code block
    /^[ \t]*~~~/m, // ~~~ fenced code block
    /^[ \t]*>[ \t]+\S/m, // > blockquote
    /\[[^\]\n]+\]\([^)\s]+\)/, // [text](url) link
    /!\[[^\]\n]*\]\([^)\s]+\)/, // ![alt](src) image
    // GFM table: a "| … |" row directly followed by a "| - | - |" separator
    /^[ \t]*\|.*\|[ \t]*\n[ \t]*\|?[ \t]*:?-+:?[ \t]*\|/m,
  ]
  if (strong.some((re) => re.test(value))) return true

  // Lists: require two consecutive items so stray dashes/numbers don't trigger.
  const twoBullets = /^[ \t]*[-*+][ \t]+\S.*\n[ \t]*[-*+][ \t]+\S/m
  const twoOrdered = /^[ \t]*\d+\.[ \t]+\S.*\n[ \t]*\d+\.[ \t]+\S/m
  if (twoBullets.test(value) || twoOrdered.test(value)) return true

  // Weak inline signals — need two independent hits.
  let weak = 0
  if (/\*\*[^\s*][^*]*\*\*/.test(value)) weak++ // **bold**
  if (/__[^\s_][^_]*__/.test(value)) weak++ // __bold__
  if (/`[^`\n]+`/.test(value)) weak++ // `inline code`
  if (/~~[^~\n]+~~/.test(value)) weak++ // ~~strikethrough~~
  return weak >= 2
}
