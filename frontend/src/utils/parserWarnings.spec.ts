import { describe, it, expect } from 'vitest'
import {
  describeParserWarning,
  describeParserWarnings,
  hasIncompleteWarning,
} from './parserWarnings'
import de from '@/locales/de/Notifications.json'
import en from '@/locales/en/Notifications.json'

describe('severity', () => {
  it("is the service's, not this file's", () => {
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
})

describe('the message', () => {
  it('is passed through exactly as the service wrote it', () => {
    // Nothing here knows what `vision_suppressed` means, and nothing should.
    expect(
      describeParserWarning({
        code: 'vision_suppressed',
        severity: 'note',
        message: '66 decorative graphics such as rules or arrows were left out.',
      }),
    ).toEqual({
      text: '66 decorative graphics such as rules or arrows were left out.',
      severity: 'note',
    })
  })

  it('renders a code nobody has ever seen, in the severity it was given', () => {
    // the point of taking both from the service: no frontend release needed
    expect(
      describeParserWarning({
        code: 'brand_new_code',
        severity: 'note',
        message: 'Something harmless happened.',
      }),
    ).toEqual({ text: 'Something harmless happened.', severity: 'note' })
  })

  it('falls back to the code when the service sent no sentence', () => {
    // unlovely, but better than dropping a warning on the floor
    expect(
      describeParserWarning({ code: 'vision_suppressed', severity: 'note' }),
    ).toEqual({ text: 'vision_suppressed', severity: 'note' })
  })

  it('prefers the message over the raw text', () => {
    expect(
      describeParserWarning({
        code: 'text_truncated',
        severity: 'incomplete',
        message: 'The file was too large.',
        raw: 'text_truncated',
      }).text,
    ).toBe('The file was too large.')
  })

  it('ignores params — the service already put them in the sentence', () => {
    expect(
      describeParserWarning({
        code: 'vision_suppressed',
        severity: 'note',
        params: { count: '66' },
        message: '66 decorative graphics were left out.',
      }).text,
    ).toBe('66 decorative graphics were left out.')
  })
})

describe('the legacy string format', () => {
  it('is shown as it arrived and counts as incomplete', () => {
    // a string cannot carry a classification, and an unclassified warning
    // stays visible rather than being guessed at
    for (const raw of [
      'transcription_incomplete:80/120',
      'table_columns_widened:8',
      'required field "hersteller" not found',
    ]) {
      expect(describeParserWarning(raw), raw).toEqual({
        text: raw,
        severity: 'incomplete',
      })
    }
  })

  it('trims surrounding whitespace', () => {
    expect(describeParserWarning('  text_truncated  ').text).toBe(
      'text_truncated',
    )
  })
})

describe('describeParserWarnings', () => {
  it('reads a mixed list — the service upgraded mid-flight', () => {
    // a job finished before the service shipped the object form sits next to
    // one finished after it
    const views = describeParserWarnings([
      'transcription_incomplete:80/120',
      {
        code: 'table_columns_widened',
        severity: 'note',
        message: '8 table rows were repaired.',
      },
    ])
    expect(views).toEqual([
      { text: 'transcription_incomplete:80/120', severity: 'incomplete' },
      { text: '8 table rows were repaired.', severity: 'note' },
    ])
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
          { code: 'table_columns_widened', severity: 'note', message: 'a' },
          { code: 'vision_skipped_duplicate', severity: 'note', message: 'b' },
          { code: 'vision_suppressed', severity: 'note', message: 'c' },
        ]),
      ),
    ).toBe(false)
  })

  it('is true as soon as one entry lost content', () => {
    expect(
      hasIncompleteWarning(
        describeParserWarnings([
          { code: 'table_columns_widened', severity: 'note', message: 'a' },
          { code: 'vision_skipped_cap', severity: 'incomplete', message: 'b' },
        ]),
      ),
    ).toBe(true)
  })

  it('is false without warnings', () => {
    expect(hasIncompleteWarning([])).toBe(false)
  })
})

describe('locales', () => {
  it('carries the two headings and no warning phrasings', () => {
    // The sentences come from the service. What is left here is the wiki's own
    // wording around them — a list of codes would be a second copy of one
    // service's vocabulary.
    for (const messages of [de, en]) {
      const warnings = messages.warnings as Record<string, string>
      expect(warnings.title).toBeTruthy()
      expect(warnings.titleNotes).toBeTruthy()
      expect(Object.keys(warnings).sort()).toEqual(['title', 'titleNotes'])
    }
  })
})
