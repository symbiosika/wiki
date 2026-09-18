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
 * What stays here is phrasing: the sentence a code reads as, **in the viewer's
 * language**. That cannot come from the service — `parserWarnings` is stored
 * once per job, not per reader, so the service would have to know at parse time
 * which language someone will read the result in, and switching the UI language
 * would mean re-parsing the document. Its English `message` is the fallback,
 * not the main text.
 *
 * The phrasings themselves live in `locales/<lang>/Notifications.json` and
 * nowhere else — not even the list of placeholders a sentence takes is repeated
 * here; it is read off the sentence. Adding a code means adding a translation.
 *
 * A code with no phrasing still renders — as the service's own `message`, in
 * the colour its `severity` asked for. A gap therefore costs a nicer wording,
 * never a wrong colour.
 */

import en from '@/locales/en/Notifications.json'

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
 * What the **legacy string format** needs to give up its values.
 *
 * Nothing here describes a sentence: which placeholders a code's phrasing uses
 * is read off the phrasing itself (see {@link placeholdersOf}), so adding a
 * code means adding a translation and nothing else. What cannot be read off a
 * sentence is how `<code>:<detail>` packed the values before the service sent
 * them as `params` — a detail that is a list, a page label, or two fields that
 * a translator is free to reorder. Only those codes appear below.
 *
 * Everything in here dies with the last stored job that carries a string.
 */
type LegacyDetail = {
  /**
   * Field names in the order the detail packs them. Only needed for a
   * two-field detail: the sentence's placeholder order is the translator's to
   * change, so it cannot be trusted to match the wire.
   */
  fields?: [string, string]
  /** Split from the right — a filename may not contain `:`, a count never does. */
  fromRight?: boolean
  /**
   * The detail is a comma-separated list, and the sentence's single
   * placeholder takes its entry count. The service sent raw ids there
   * (`img-p156-1,img-p178-2,…`), and a wall of ids is what made a harmless
   * note look like a defect report.
   */
  countList?: boolean
  /** Strip a leading `page `/`pages ` label — it belongs in the sentence. */
  stripLabel?: boolean
}

const LEGACY_DETAILS: Record<string, LegacyDetail> = {
  // two fields, packed as "80/120" or "a:b"
  transcription_incomplete: { fields: ['done', 'total'] },
  extraction_incomplete: { fields: ['done', 'total'] },
  media_duration_over_budget: { fields: ['duration', 'budget'] },
  image_frames_ignored: { fields: ['file', 'count'], fromRight: true },
  // a list of ids, shown as a count
  vision_suppressed: { countList: true },
  vision_failed: { countList: true },
  table_summary_skipped: { countList: true },
  // "pages 28-29" / "page 7"
  table_merged: { stripLabel: true },
  table_mode_degraded: { stripLabel: true },
  low_confidence: { stripLabel: true },
  polish_rejected: { stripLabel: true },
  polish_failed: { stripLabel: true },
  polish_skipped_deadline: { stripLabel: true },
}

/**
 * The placeholders a code's sentence uses, e.g. `table_columns_widened` →
 * `['count']` from „{count} Tabellenzeilen: …".
 *
 * Read from the phrasing rather than listed a second time in here: a list
 * beside the translations is one more thing to keep in step, and the sentence
 * already says what it needs. `en` is the reference — a test keeps every
 * locale's placeholders identical to it.
 *
 * A code with no phrasing at all yields `undefined`: there is nothing to fill,
 * and the caller falls back to what the service sent.
 */
const PLACEHOLDERS = new Map<string, string[]>(
  Object.entries(en.warnings as Record<string, string>).map(([code, text]) => [
    code,
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string),
  ]),
)

const placeholdersOf = (code: string): string[] | undefined =>
  PLACEHOLDERS.get(code)

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
  code: string,
  detail: string,
): Record<string, string> | null => {
  const names = placeholdersOf(code)
  if (!names || names.length === 0) return {}

  const legacy = LEGACY_DETAILS[code] ?? {}

  if (legacy.countList) {
    const entries = detail.split(',').filter((entry) => entry.trim() !== '')
    if (entries.length === 0) return null
    return { [names[0] as string]: String(entries.length) }
  }

  // Two fields come from the table: a translator may reorder the sentence's
  // placeholders, the wire format does not move.
  const fields = legacy.fields ?? names
  const source = legacy.stripLabel ? stripPageLabel(detail) : detail
  const parts = splitDetail(source, fields.length, !!legacy.fromRight)
  if (!parts) return null

  const params: Record<string, string> = {}
  fields.forEach((name, index) => {
    params[name] = parts[index] ?? ''
  })
  return params
}

/** Are all the placeholders of this code's sentence filled? */
const covers = (code: string, params: Record<string, string>): boolean =>
  (placeholdersOf(code) ?? []).every((name) => (params[name] ?? '') !== '')

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

    const params = placeholdersOf(code) ? paramsFromDetail(code, detail) : null
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

  if (code === '' || !placeholdersOf(code)) return { params: {}, raw, severity }

  const supplied = warning.params ?? {}
  if (covers(code, supplied)) {
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
    code,
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
