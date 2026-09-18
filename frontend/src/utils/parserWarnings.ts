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
 * Both the wording and the classification come from the service (spec §5
 * `warnings[]`). Nothing here knows what `vision_suppressed` means, and nothing
 * here should: the codes are a given service's own vocabulary, so any list of
 * them in the frontend is a second copy of that service's knowledge — one that
 * needs a release of its own whenever the service learns a new code, and that
 * says nothing about the warnings of any other service.
 *
 * So the message is passed through as the service wrote it, and `severity` —
 * the one thing the display needs — decides the colour.
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
  /** What to show: the service's sentence, or its code when it sent none. */
  text: string
  /** Whether this one means something is actually missing. */
  severity: ParserWarningSeverity
}

/**
 * Turn one stored warning into something renderable.
 *
 * A legacy string carries no classification and counts as `incomplete`: a
 * warning nobody classified must not be waved through as harmless just because
 * it happens to be about something harmless. It is shown as it arrived.
 */
export const describeParserWarning = (
  warning: StoredParserWarning,
): ParserWarningView => {
  if (typeof warning === 'string') {
    return { text: warning.trim(), severity: 'incomplete' }
  }

  // Only the two documented values mean anything; anything else errs towards
  // visible rather than silent.
  const severity: ParserWarningSeverity =
    warning.severity === 'note' ? 'note' : 'incomplete'

  // `message` is what a reader is meant to see. Without one there is still the
  // code — unlovely, but better than dropping a warning on the floor.
  const text =
    (warning.message ?? '').trim() ||
    (warning.raw ?? '').trim() ||
    (warning.code ?? '').trim()

  return { text, severity }
}

/** {@link describeParserWarning} for a whole list, empty entries dropped. */
export const describeParserWarnings = (
  warnings: StoredParserWarning[] | undefined,
): ParserWarningView[] =>
  (warnings ?? [])
    .filter((w) => w !== null && w !== undefined)
    .map((w) => describeParserWarning(w))
    .filter((view) => view.text !== '')

/** True when at least one warning means content is missing. */
export const hasIncompleteWarning = (views: ParserWarningView[]): boolean =>
  views.some((view) => view.severity === 'incomplete')
