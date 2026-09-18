/**
 * The `warnings[]` a parsing service reports about a finished import. They
 * travel from the service through `PdfParserResult.warnings` into
 * `job.result.parserWarnings`.
 *
 * Not every warning means something is missing. The service reports two very
 * different things through the same channel:
 *
 *   - **notes** — a repair it made (a table column the OCR dropped and the
 *     parser reconstructed), a decision it took (decorative graphics left out),
 *     or an option that did not apply here. The document arrived complete.
 *   - **incomplete** — content that did not make it: images without a
 *     description because a cap was reached, truncated rows, an unreadable
 *     attachment.
 *
 * Showing both as "not fully imported" in amber taught customers to distrust a
 * perfectly good import — a 750-page catalogue whose only notes were a repaired
 * table and deduplicated logos read like a failure. So each code carries its
 * severity, and only `incomplete` colours the message.
 *
 * The codes are machine-readable (`<name>:<detail>`), so the known ones become
 * a readable sentence. An unknown code is shown verbatim AND counts as
 * `incomplete`: a warning this file has never seen must not be waved through as
 * harmless just because nobody has phrased it yet.
 */

/** Does this warning mean content is missing, or is it just a note? */
export type ParserWarningSeverity = 'note' | 'incomplete'

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
  /** Whether this one means something is actually missing. */
  severity: ParserWarningSeverity
}

/**
 * How the detail behind the colon is read.
 *
 * `plain` splits it into the named fields; `count` treats it as a
 * comma-separated list and reports only how many entries it has — the service
 * sends raw ids there (`img-p156-1,img-p178-2,…`), and a wall of ids is what
 * made a harmless note look like a defect report.
 */
type WarningSpec = {
  code: string
  severity: ParserWarningSeverity
  /**
   * Detail fields in order. Omitted or empty means the code carries no detail
   * worth phrasing (any detail it does carry is ignored rather than dropping
   * the sentence).
   */
  params?: string[]
  /** Split the detail from the right (a filename may not contain `:`). */
  fromRight?: boolean
  /** The detail is a list; the single param receives its entry count. */
  countList?: boolean
  /** Strip a leading `page `/`pages ` label the service prefixes. */
  stripLabel?: boolean
}

/**
 * Every code the parsing service can send, with how it reads for a customer.
 *
 * Kept in the service's own order of subject (tables, images, text, mail,
 * office, media) so a new code is easy to slot in next to its siblings.
 */
const KNOWN_WARNINGS: WarningSpec[] = [
  // --- notes: the document is complete -------------------------------------
  { code: 'table_columns_widened', severity: 'note', params: ['count'] },
  { code: 'table_columns_realigned', severity: 'note', params: ['count'] },
  {
    code: 'table_merged',
    severity: 'note',
    params: ['pages'],
    stripLabel: true,
  },
  { code: 'vision_skipped_duplicate', severity: 'note', params: ['count'] },
  {
    code: 'vision_suppressed',
    severity: 'note',
    params: ['count'],
    countList: true,
  },
  { code: 'vision_suppression_vetoed', severity: 'note' },
  { code: 'vision_skipped_tiny', severity: 'note' },
  { code: 'document_annotation_unavailable', severity: 'note' },
  {
    code: 'polish_rejected',
    severity: 'note',
    params: ['pages'],
    stripLabel: true,
  },
  {
    code: 'polish_failed',
    severity: 'note',
    params: ['pages'],
    stripLabel: true,
  },
  {
    code: 'polish_skipped_deadline',
    severity: 'note',
    params: ['pages'],
    stripLabel: true,
  },
  { code: 'language_sections_removed', severity: 'note', params: ['detail'] },
  { code: 'language_columns_reduced', severity: 'note', params: ['detail'] },
  { code: 'mail_body_from_html', severity: 'note' },
  { code: 'text_delimiter', severity: 'note', params: ['delimiter'] },
  { code: 'context_truncated', severity: 'note' },
  { code: 'context_ignored', severity: 'note' },
  {
    code: 'preferred_language_unsupported',
    severity: 'note',
    params: ['value'],
  },

  // --- incomplete: content did not make it ---------------------------------
  { code: 'vision_skipped_cap', severity: 'incomplete', params: ['count'] },
  { code: 'vision_skipped_deadline', severity: 'incomplete' },
  {
    code: 'vision_stopped_deadline',
    severity: 'incomplete',
    params: ['count'],
  },
  { code: 'vision_stopped_budget', severity: 'incomplete', params: ['count'] },
  {
    code: 'vision_stopped_error_quota',
    severity: 'incomplete',
    params: ['count'],
  },
  { code: 'vision_skipped_invalid', severity: 'incomplete', params: ['count'] },
  {
    code: 'vision_failed',
    severity: 'incomplete',
    params: ['count'],
    countList: true,
  },
  { code: 'vision_description_truncated', severity: 'incomplete' },
  {
    code: 'diagram_analysis_capped',
    severity: 'incomplete',
    params: ['count'],
  },
  { code: 'diagram_analysis_truncated', severity: 'incomplete' },
  { code: 'diagram_analysis_failed', severity: 'incomplete' },
  { code: 'diagram_json_invalid', severity: 'incomplete' },
  { code: 'diagram_json_dropped', severity: 'incomplete' },
  {
    code: 'table_summary_skipped',
    severity: 'incomplete',
    params: ['count'],
    countList: true,
  },
  { code: 'table_summary_failed', severity: 'incomplete' },
  { code: 'table_rows_truncated', severity: 'incomplete' },
  { code: 'table_rows_dropped', severity: 'incomplete' },
  { code: 'table_layer_truncated', severity: 'incomplete', params: ['count'] },
  {
    code: 'table_mode_degraded',
    severity: 'incomplete',
    params: ['page'],
    stripLabel: true,
  },
  { code: 'table_html_unparsed', severity: 'incomplete' },
  { code: 'table_unanchored', severity: 'incomplete' },
  { code: 'table_block_unresolved', severity: 'incomplete' },
  {
    code: 'extraction_incomplete',
    severity: 'incomplete',
    params: ['done', 'total'],
  },
  {
    code: 'low_confidence',
    severity: 'incomplete',
    params: ['pages'],
    stripLabel: true,
  },
  {
    code: 'transcription_incomplete',
    severity: 'incomplete',
    params: ['done', 'total'],
  },
  { code: 'transcription_segment_failed', severity: 'incomplete' },
  {
    code: 'media_duration_over_budget',
    severity: 'incomplete',
    params: ['duration', 'budget'],
  },
  { code: 'media_transcode_failed', severity: 'incomplete' },
  {
    code: 'image_frames_ignored',
    severity: 'incomplete',
    params: ['file', 'count'],
    fromRight: true,
  },
  { code: 'image_prep_failed', severity: 'incomplete', params: ['file'] },
  { code: 'text_truncated', severity: 'incomplete' },
  { code: 'text_rows_truncated', severity: 'incomplete', params: ['count'] },
  { code: 'text_columns_truncated', severity: 'incomplete', params: ['count'] },
  {
    code: 'text_encoding_assumed',
    severity: 'incomplete',
    params: ['encoding'],
  },
  {
    code: 'office_sheet_rows_truncated',
    severity: 'incomplete',
    params: ['sheets'],
  },
  {
    code: 'office_hidden_sheets_skipped',
    severity: 'incomplete',
    params: ['count'],
  },
  { code: 'office_images_skipped', severity: 'incomplete', params: ['count'] },
  {
    code: 'office_slide_unreadable',
    severity: 'incomplete',
    params: ['number'],
  },
  {
    code: 'office_formula_values_missing',
    severity: 'incomplete',
    params: ['sheets'],
  },
  {
    code: 'xlsx_formula_without_value',
    severity: 'incomplete',
    params: ['sheet'],
  },
  {
    code: 'mail_attachments_truncated',
    severity: 'incomplete',
    params: ['count'],
  },
  {
    code: 'mail_attachments_unsupported',
    severity: 'incomplete',
    params: ['file'],
  },
  { code: 'mail_attachment_failed', severity: 'incomplete', params: ['file'] },
  { code: 'mail_body_truncated', severity: 'incomplete' },
]

const SPECS = new Map(KNOWN_WARNINGS.map((spec) => [spec.code, spec]))

/** Every code this file can phrase — the locales are checked against it. */
export const KNOWN_WARNING_CODES: readonly string[] = KNOWN_WARNINGS.map(
  (spec) => spec.code,
)

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

/** `pages 3,4` → `3,4`. The label belongs in the sentence, not in the value. */
const stripPageLabel = (detail: string): string =>
  detail.replace(/^pages?\s+/i, '')

/**
 * Turn one raw warning into something renderable. An unknown code — and a
 * known code whose detail no longer parses — comes back with no `key`, to be
 * shown as it arrived; an unknown code is `incomplete` on purpose.
 */
export const describeParserWarning = (raw: string): ParserWarningView => {
  const trimmed = raw.trim()
  const at = trimmed.indexOf(':')
  const code = at > 0 ? trimmed.slice(0, at) : trimmed
  const detail = at > 0 ? trimmed.slice(at + 1) : ''

  const spec = SPECS.get(code)
  if (!spec) return { params: {}, raw: trimmed, severity: 'incomplete' }

  const names = spec.params ?? []
  if (names.length === 0) {
    return {
      key: `Notifications.warnings.${code}`,
      params: {},
      raw: trimmed,
      severity: spec.severity,
    }
  }

  if (spec.countList) {
    const entries = detail.split(',').filter((entry) => entry.trim() !== '')
    if (entries.length === 0)
      return { params: {}, raw: trimmed, severity: spec.severity }
    return {
      key: `Notifications.warnings.${code}`,
      params: { [names[0] as string]: String(entries.length) },
      raw: trimmed,
      severity: spec.severity,
    }
  }

  const source = spec.stripLabel ? stripPageLabel(detail) : detail
  const parts = splitDetail(source, names.length, !!spec.fromRight)
  if (!parts) return { params: {}, raw: trimmed, severity: spec.severity }

  const params: Record<string, string> = {}
  names.forEach((name, index) => {
    params[name] = parts[index] ?? ''
  })
  return {
    key: `Notifications.warnings.${code}`,
    params,
    raw: trimmed,
    severity: spec.severity,
  }
}

/** {@link describeParserWarning} for a whole list, empty entries dropped. */
export const describeParserWarnings = (
  warnings: string[] | undefined,
): ParserWarningView[] =>
  (warnings ?? [])
    .filter((w) => w.trim() !== '')
    .map((w) => describeParserWarning(w))

/** True when at least one warning means content is missing. */
export const hasIncompleteWarning = (views: ParserWarningView[]): boolean =>
  views.some((view) => view.severity === 'incomplete')
