import { describe, it, expect } from 'vitest'
import {
  describeParserWarning,
  describeParserWarnings,
  hasIncompleteWarning,
} from './parserWarnings'
import de from '@/locales/de/Notifications.json'
import en from '@/locales/en/Notifications.json'

describe('severity', () => {
  it('is the service\'s, not this file\'s', () => {
    // The same code could mean either; only the parser knows which.
    expect(
      describeParserWarning({ code: 'table_columns_widened', severity: 'note' })
        .severity,
    ).toBe('note')
    expect(
      describeParserWarning({
        code: 'table_columns_widened',
        severity: 'incomplete',
      }).severity,
    ).toBe('incomplete')
  })

  it('reads anything but "note" as incomplete', () => {
    // a classification we do not understand must not be waved through
    for (const severity of ['incomplete', 'info', 'NOTE', '', undefined]) {
      expect(
        describeParserWarning({ code: 'some_code', severity }).severity,
        String(severity),
      ).toBe('incomplete')
    }
  })

  it('reads a code it has no phrasing for, in the severity it was given', () => {
    // the point of moving severity to the service: a code this file has never
    // seen still reads correctly, without a frontend release
    const view = describeParserWarning({
      code: 'brand_new_code',
      severity: 'note',
      message: 'Something harmless happened.',
    })
    expect(view.key).toBeUndefined()
    expect(view.raw).toBe('Something harmless happened.')
    expect(view.severity).toBe('note')
  })
})

describe('phrasing', () => {
  it('fills a sentence from the params the service supplied', () => {
    expect(
      describeParserWarning({
        code: 'vision_suppressed',
        severity: 'note',
        params: { count: '66' },
      }),
    ).toEqual({
      key: 'Notifications.warnings.vision_suppressed',
      params: { count: '66' },
      raw: 'vision_suppressed',
      severity: 'note',
    })
  })

  it('falls back to the service message when a placeholder is unfilled', () => {
    // half a sentence is worse than the service's own
    const view = describeParserWarning({
      code: 'vision_suppressed',
      severity: 'note',
      message: '66 decorative graphics were left out.',
    })
    expect(view.key).toBeUndefined()
    expect(view.raw).toBe('66 decorative graphics were left out.')
    expect(view.severity).toBe('note')
  })

  it('shows the bare code when the service sent no message either', () => {
    const view = describeParserWarning({
      code: 'vision_suppressed',
      severity: 'note',
    })
    expect(view.key).toBeUndefined()
    expect(view.raw).toBe('vision_suppressed')
  })

  it('phrases a code whose sentence takes no values', () => {
    expect(
      describeParserWarning({ code: 'text_truncated', severity: 'incomplete' }),
    ).toEqual({
      key: 'Notifications.warnings.text_truncated',
      params: {},
      raw: 'text_truncated',
      severity: 'incomplete',
    })
  })

  it('ignores params a sentence does not use', () => {
    const view = describeParserWarning({
      code: 'vision_suppression_vetoed',
      severity: 'note',
      params: { id: 'img-p19-1' },
    })
    expect(view.key).toBe('Notifications.warnings.vision_suppression_vetoed')
    expect(view.params).toEqual({ id: 'img-p19-1' })
  })
})

describe('the legacy string format', () => {
  it('counts as incomplete, whatever it is about', () => {
    // a string cannot carry a severity, and an unclassified warning stays
    // visible rather than being guessed at
    for (const raw of [
      'transcription_incomplete:80/120',
      'table_columns_widened:8',
      'required field "hersteller" not found',
    ]) {
      expect(describeParserWarning(raw).severity, raw).toBe('incomplete')
    }
  })

  it('still phrases the codes it knows', () => {
    expect(describeParserWarning('transcription_incomplete:80/120')).toEqual({
      key: 'Notifications.warnings.transcription_incomplete',
      params: { done: '80', total: '120' },
      raw: 'transcription_incomplete:80/120',
      severity: 'incomplete',
    })
    expect(
      describeParserWarning('image_frames_ignored:fax.tiff:2').params,
    ).toEqual({ file: 'fax.tiff', count: '2' })
  })

  it('counts a packed id list instead of printing the ids', () => {
    // "vision_suppressed:img-p156-1,img-p178-2,…" — the id wall is the problem
    expect(
      describeParserWarning('vision_suppressed:img-p156-1,img-p178-2,img-p179-1')
        .params,
    ).toEqual({ count: '3' })
  })

  it('strips the page label the old format prefixes', () => {
    expect(describeParserWarning('table_merged:pages 28-29').params).toEqual({
      pages: '28-29',
    })
    expect(describeParserWarning('table_mode_degraded:page 7').params).toEqual({
      page: '7',
    })
  })

  it('shows an unknown code verbatim instead of dropping it', () => {
    const view = describeParserWarning('required field "hersteller" not found')
    expect(view.key).toBeUndefined()
    expect(view.raw).toBe('required field "hersteller" not found')
  })

  it('drops the sentence when the detail no longer fits it', () => {
    // a phrasing with holes in it is worse than the raw text
    expect(describeParserWarning('image_frames_ignored:fax.tiff').key).toBe(
      undefined,
    )
    expect(describeParserWarning('text_encoding_assumed:').key).toBeUndefined()
    expect(describeParserWarning('vision_suppressed:').key).toBeUndefined()
  })

  it('keeps the severity when the detail no longer parses', () => {
    expect(describeParserWarning('transcription_incomplete').severity).toBe(
      'incomplete',
    )
  })
})

describe('describeParserWarnings', () => {
  it('reads a mixed list — the service upgraded mid-flight', () => {
    // a job finished before the service shipped the object form sits next to
    // one finished after it
    const views = describeParserWarnings([
      'transcription_incomplete:80/120',
      { code: 'table_columns_widened', severity: 'note', params: { count: '8' } },
    ])
    expect(views.map((v) => v.severity)).toEqual(['incomplete', 'note'])
  })

  it('drops empty entries', () => {
    expect(describeParserWarnings(['', '   '])).toEqual([])
    expect(describeParserWarnings(undefined)).toEqual([])
    expect(describeParserWarnings([])).toEqual([])
  })

  it('drops an entry with nothing to show', () => {
    expect(describeParserWarnings([{ severity: 'note' }])).toEqual([])
  })
})

describe('hasIncompleteWarning', () => {
  it('is false for a list of notes only', () => {
    // the customer case: a complete 750-page import that looked like a failure
    expect(
      hasIncompleteWarning(
        describeParserWarnings([
          { code: 'table_columns_widened', severity: 'note', params: { count: '8' } },
          { code: 'vision_skipped_duplicate', severity: 'note', params: { count: '66' } },
          { code: 'vision_suppressed', severity: 'note', params: { count: '5' } },
        ]),
      ),
    ).toBe(false)
  })

  it('is true as soon as one entry lost content', () => {
    expect(
      hasIncompleteWarning(
        describeParserWarnings([
          { code: 'table_columns_widened', severity: 'note', params: { count: '8' } },
          { code: 'vision_skipped_cap', severity: 'incomplete', params: { count: '254' } },
        ]),
      ),
    ).toBe(true)
  })

  it('is false without warnings', () => {
    expect(hasIncompleteWarning([])).toBe(false)
  })
})

describe('locales', () => {
  it.each([
    ['de', de],
    ['en', en],
  ])('carries both headings in %s', (_lang, messages) => {
    const warnings = messages.warnings as Record<string, string>
    expect(warnings.title).toBeTruthy()
    expect(warnings.titleNotes).toBeTruthy()
  })

  it('phrases the same codes in both languages', () => {
    // German and English must not drift apart; neither is checked against the
    // service, because a code we cannot phrase is a fallback, not a bug
    const keys = (messages: unknown) =>
      Object.keys((messages as { warnings: Record<string, string> }).warnings)
        .sort()
        .join(',')
    expect(keys(de)).toBe(keys(en))
  })
})
