/**
 * The `warnings[]` a parsing service reports for a result it deliberately
 * returned incomplete (a truncated transcript, skipped scan pages, an
 * unreadable mail attachment). They travel from the service through
 * `PdfParserResult.warnings` into `job.result.parserWarnings`.
 *
 * The codes are machine-readable (`<name>:<detail>`), so the known ones become
 * a readable sentence. An unknown code is shown verbatim rather than dropped —
 * an import with warnings succeeded, but it is not complete, and that
 * difference has to stay visible.
 */

/** One warning, ready to render. */
export interface ParserWarningView {
  /**
   * i18n key under `Notifications.warnings`, or `undefined` when the code is
   * unknown — then {@link raw} is what to show.
   */
  key?: string
  /** Interpolation values for {@link key}. */
  params: Record<string, string>
  /** The warning exactly as the service sent it. */
  raw: string
}

/**
 * The codes we can phrase, mapped to the detail fields they carry.
 * `detail` names the `<detail>` segments in order; a code whose detail does
 * not match falls back to the raw text, so a changed format never renders a
 * sentence with holes in it.
 */
const KNOWN_WARNINGS: {
  code: string
  params: string[]
  /** Split the detail from the right (a filename may not contain `:`, a count never does). */
  fromRight?: boolean
}[] = [
  // "transcription_incomplete:80/120" — 80 of 120 minutes transcribed
  { code: 'transcription_incomplete', params: ['done', 'total'] },
  // "image_frames_ignored:fax.tiff:2" — 2 further frames of a multi-page scan
  { code: 'image_frames_ignored', params: ['file', 'count'], fromRight: true },
  // "mail_attachments_unsupported:Archiv.zip"
  { code: 'mail_attachments_unsupported', params: ['file'] },
  // "text_encoding_assumed:cp1252"
  { code: 'text_encoding_assumed', params: ['encoding'] },
  // "xlsx_formula_without_value:Blatt2"
  { code: 'xlsx_formula_without_value', params: ['sheet'] },
  // "media_duration_over_budget:5400s:1800s"
  { code: 'media_duration_over_budget', params: ['duration', 'budget'] },
]

/** Split `detail` into exactly `count` parts, or `null` when it doesn't fit. */
const splitDetail = (
  detail: string,
  count: number,
  fromRight: boolean,
): string[] | null => {
  if (count === 1) return detail === '' ? null : [detail]
  // "80/120" and "a:b" are both in use as two-part details.
  const separator = detail.includes('/') && !detail.includes(':') ? '/' : ':'
  const at = fromRight
    ? detail.lastIndexOf(separator)
    : detail.indexOf(separator)
  if (count !== 2 || at <= 0 || at === detail.length - 1) return null
  return [detail.slice(0, at), detail.slice(at + 1)]
}

/**
 * Turn one raw warning into something renderable. Unknown codes — and known
 * codes whose detail no longer parses — come back with no `key`, to be shown
 * as they arrived.
 */
export const describeParserWarning = (raw: string): ParserWarningView => {
  const trimmed = raw.trim()
  const at = trimmed.indexOf(':')
  const code = at > 0 ? trimmed.slice(0, at) : trimmed
  const detail = at > 0 ? trimmed.slice(at + 1) : ''

  const known = KNOWN_WARNINGS.find((w) => w.code === code)
  if (!known) return { params: {}, raw: trimmed }

  const parts = splitDetail(detail, known.params.length, !!known.fromRight)
  if (!parts) return { params: {}, raw: trimmed }

  const params: Record<string, string> = {}
  known.params.forEach((name, index) => {
    params[name] = parts[index] ?? ''
  })
  return { key: `Notifications.warnings.${code}`, params, raw: trimmed }
}

/** {@link describeParserWarning} for a whole list, empty entries dropped. */
export const describeParserWarnings = (
  warnings: string[] | undefined,
): ParserWarningView[] =>
  (warnings ?? [])
    .filter((w) => w.trim() !== '')
    .map((w) => describeParserWarning(w))
