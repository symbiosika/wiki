/**
 * The `warnings[]` a parsing service reports about a finished import. They
 * travel from the service through `PdfParserResult.warnings` into
 * `job.result.parserWarnings`.
 *
 * Not every warning means something is missing. A service reports two very
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
 * table and deduplicated logos read like a failure.
 *
 * **Which of the two it is comes from the service** (spec §5 `warnings[]`), not
 * from a list in here. A repaired table column and a truncated table are both
 * "a warning about a table", and nothing in the text says which one lost data;
 * only the parser knows. Deciding it here would also mean every service that
 * gains a code needs a frontend release before its harmless note stops reading
 * as a defect — and would classify the codes of *one* service while every
 * other service's warnings fall through as unknown.
 *
 * What stays here is phrasing: the sentence a code reads as, in the viewer's
 * language. A code this file has no sentence for still renders — as the
 * service's own `message`, in the colour its `severity` asked for. A gap in the
 * table below therefore costs a nicer wording, never a wrong colour.
 */

/** Does this warning mean content is missing, or is it just a note? */
export type ParserWarningSeverity = 'note' | 'incomplete'

/**
 * One warning as it arrives in `job.result.parserWarnings`.
 *
 * A **string** is the old wire format — a service that has not adopted the
 * object form, and every job finished before it did. It cannot express a note,
 * so it counts as `incomplete`.
 */
export type StoredParserWarning =
  | string
  | {
      code?: string
      severity?: string
      params?: Record<string, string>
      message?: string
      raw?: string
    }

/** One warning, ready to render. */
export interface ParserWarningView {
  /**
   * i18n key under `Notifications.warnings`, or `undefined` when nothing here
   * phrases the code — then {@link raw} is what to show.
   */
  key?: string
  /** Interpolation values for {@link key}. */
  params: Record<string, string>
  /** What to show without a {@link key}: the service's sentence, or the code. */
  raw: string
  /** Whether this one means something is actually missing. */
  severity: ParserWarningSeverity
}

/**
 * How a code's sentence reads, and what fills its placeholders.
 *
 * `params` names the placeholders the phrasing in `Notifications.warnings`
 * uses. The service supplies them (spec §5 `params`); the detail modes below
 * only apply to the **legacy string format**, where the values are packed into
 * `<code>:<detail>` and have to be recovered.
 *
 * Note what is NOT here any more: severity. That comes from the service.
 */
type WarningSpec = {
  code: string
  /**
   * Placeholder names of this code's phrasing, in the order a legacy detail
   * packs them. Omitted or empty means the sentence takes no values (any
   * detail the code carries is ignored rather than dropping the sentence).
   */
  params?: string[]
  /** Legacy detail: split from the right (a filename may not contain `:`). */
  fromRight?: boolean
  /**
   * Legacy detail: a comma-separated list whose single param is its entry
   * count. The service sends raw ids there (`img-p156-1,img-p178-2,…`), and a
   * wall of ids is what made a harmless note look like a defect report.
   */
  countList?: boolean
  /** Legacy detail: strip a leading `page `/`pages ` label. */
  stripLabel?: boolean
}

/**
 * The codes this file has a sentence for.
 *
 * Kept in the service's own order of subject (tables, images, text, mail,
 * office, media) so a new code is easy to slot in next to its siblings. A code
 * missing from here is not a bug — it renders as the service's own `message`.
 */
const KNOWN_WARNINGS: WarningSpec[] = [
  { code: 'table_columns_widened', params: ['count'] },
  { code: 'table_columns_realigned', params: ['count'] },
  {
    code: 'table_merged',
    params: ['pages'],
    stripLabel: true,
  },
  { code: 'vision_skipped_duplicate', params: ['count'] },
  {
    code: 'vision_suppressed',
    params: ['count'],
    countList: true,
  },
  { code: 'vision_suppression_vetoed' },
  { code: 'vision_skipped_tiny' },
  { code: 'document_annotation_unavailable' },
  {
    code: 'polish_rejected',
    params: ['pages'],
    stripLabel: true,
  },
  {
    code: 'polish_failed',
    params: ['pages'],
    stripLabel: true,
  },
  {
    code: 'polish_skipped_deadline',
    params: ['pages'],
    stripLabel: true,
  },
  { code: 'language_sections_removed', params: ['detail'] },
  { code: 'language_columns_reduced', params: ['detail'] },
  { code: 'mail_body_from_html' },
  { code: 'low_confidence', params: ['pages'], stripLabel: true },
  { code: 'text_delimiter', params: ['delimiter'] },
  { code: 'context_truncated' },
  { code: 'context_ignored' },
  {
    code: 'preferred_language_unsupported',
    params: ['value'],
  },
  { code: 'vision_skipped_cap', params: ['count'] },
  { code: 'vision_skipped_deadline' },
  {
    code: 'vision_stopped_deadline',
    params: ['count'],
  },
  { code: 'vision_stopped_budget', params: ['count'] },
  {
    code: 'vision_stopped_error_quota',
    params: ['count'],
  },
  { code: 'vision_skipped_invalid', params: ['count'] },
  {
    code: 'vision_failed',
    params: ['count'],
    countList: true,
  },
  { code: 'vision_description_truncated' },
  {
    code: 'diagram_analysis_capped',
    params: ['count'],
  },
  { code: 'diagram_analysis_truncated' },
  { code: 'diagram_analysis_failed' },
  { code: 'diagram_json_invalid' },
  { code: 'diagram_json_dropped' },
  {
    code: 'table_summary_skipped',
    params: ['count'],
    countList: true,
  },
  { code: 'table_summary_failed' },
  { code: 'table_rows_truncated' },
  { code: 'table_rows_dropped' },
  { code: 'table_layer_truncated', params: ['count'] },
  {
    code: 'table_mode_degraded',
    params: ['page'],
    stripLabel: true,
  },
  { code: 'table_html_unparsed' },
  { code: 'table_unanchored' },
  { code: 'table_block_unresolved' },
  {
    code: 'extraction_incomplete',
    params: ['done', 'total'],
  },
  {
    code: 'transcription_incomplete',
    params: ['done', 'total'],
  },
  { code: 'transcription_segment_failed' },
  {
    code: 'media_duration_over_budget',
    params: ['duration', 'budget'],
  },
  { code: 'media_transcode_failed' },
  {
    code: 'image_frames_ignored',
    params: ['file', 'count'],
    fromRight: true,
  },
  { code: 'image_prep_failed', params: ['file'] },
  { code: 'text_truncated' },
  { code: 'text_rows_truncated', params: ['count'] },
  { code: 'text_columns_truncated', params: ['count'] },
  {
    code: 'text_encoding_assumed',
    params: ['encoding'],
  },
  {
    code: 'office_sheet_rows_truncated',
    params: ['sheets'],
  },
  {
    code: 'office_hidden_sheets_skipped',
    params: ['count'],
  },
  { code: 'office_images_skipped', params: ['count'] },
  {
    code: 'office_slide_unreadable',
    params: ['number'],
  },
  {
    code: 'office_formula_values_missing',
    params: ['sheets'],
  },
  {
    code: 'xlsx_formula_without_value',
    params: ['sheet'],
  },
  {
    code: 'mail_attachments_truncated',
    params: ['count'],
  },
  {
    code: 'mail_attachments_unsupported',
    params: ['file'],
  },
  { code: 'mail_attachment_failed', params: ['file'] },
  { code: 'mail_body_truncated' },
]

const SPECS = new Map(KNOWN_WARNINGS.map((spec) => [spec.code, spec]))

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
 * Recover a legacy `<code>:<detail>` warning's values, or `null` when the
 * detail does not fit the phrasing — then the sentence is dropped rather than
 * rendered with holes in it.
 */
const paramsFromDetail = (
  spec: WarningSpec,
  detail: string,
): Record<string, string> | null => {
  const names = spec.params ?? []
  if (names.length === 0) return {}

  if (spec.countList) {
    const entries = detail.split(',').filter((entry) => entry.trim() !== '')
    if (entries.length === 0) return null
    return { [names[0] as string]: String(entries.length) }
  }

  const source = spec.stripLabel ? stripPageLabel(detail) : detail
  const parts = splitDetail(source, names.length, !!spec.fromRight)
  if (!parts) return null

  const params: Record<string, string> = {}
  names.forEach((name, index) => {
    params[name] = parts[index] ?? ''
  })
  return params
}

/** Are all the placeholders of this code's sentence filled? */
const covers = (spec: WarningSpec, params: Record<string, string>): boolean =>
  (spec.params ?? []).every((name) => (params[name] ?? '') !== '')

/**
 * Turn one stored warning into something renderable.
 *
 * The severity is the service's, never this file's — except for a legacy
 * string, which cannot carry one and therefore counts as `incomplete`: a
 * warning nobody classified must not be waved through as harmless.
 *
 * The phrasing is this file's. A code with no sentence here, and a code whose
 * sentence cannot be filled, fall back to the service's `message` (or the raw
 * text) — visible, in the right colour, just less nicely worded.
 */
export const describeParserWarning = (
  warning: StoredParserWarning,
): ParserWarningView => {
  // --- legacy string: "<code>:<detail>", severity unknown -------------------
  if (typeof warning === 'string') {
    const trimmed = warning.trim()
    const at = trimmed.indexOf(':')
    const code = at > 0 ? trimmed.slice(0, at) : trimmed
    const detail = at > 0 ? trimmed.slice(at + 1) : ''

    const spec = SPECS.get(code)
    const params = spec ? paramsFromDetail(spec, detail) : null
    return params
      ? {
          key: `Notifications.warnings.${code}`,
          params,
          raw: trimmed,
          severity: 'incomplete',
        }
      : { params: {}, raw: trimmed, severity: 'incomplete' }
  }

  // --- the object form (spec §5 `warnings[]`) -------------------------------
  const code = (warning.code ?? '').trim()
  const message = (warning.message ?? '').trim()
  const raw = (warning.raw ?? '').trim() || message || code
  // Only the two documented values mean anything; anything else errs towards
  // visible rather than silent.
  const severity: ParserWarningSeverity =
    warning.severity === 'note' ? 'note' : 'incomplete'

  const spec = code === '' ? undefined : SPECS.get(code)
  if (!spec) return { params: {}, raw, severity }

  const supplied = warning.params ?? {}
  if (covers(spec, supplied)) {
    return {
      key: `Notifications.warnings.${code}`,
      params: supplied,
      raw,
      severity,
    }
  }

  // A service that names the code but not its values: the detail may still be
  // packed into `raw` the old way.
  const at = raw.indexOf(':')
  const fallback = paramsFromDetail(
    spec,
    raw.slice(0, at) === code && at > 0 ? raw.slice(at + 1) : '',
  )
  return fallback
    ? { key: `Notifications.warnings.${code}`, params: fallback, raw, severity }
    : { params: {}, raw, severity }
}

/** {@link describeParserWarning} for a whole list, empty entries dropped. */
export const describeParserWarnings = (
  warnings: StoredParserWarning[] | undefined,
): ParserWarningView[] =>
  (warnings ?? [])
    .filter((w) => (typeof w === 'string' ? w.trim() !== '' : w !== null))
    .map((w) => describeParserWarning(w))
    .filter((view) => view.key !== undefined || view.raw !== '')

/** True when at least one warning means content is missing. */
export const hasIncompleteWarning = (views: ParserWarningView[]): boolean =>
  views.some((view) => view.severity === 'incomplete')
