import { describe, it, expect } from 'vitest'
import {
  describeParserWarning,
  describeParserWarnings,
  hasIncompleteWarning,
  KNOWN_WARNING_CODES,
} from './parserWarnings'
import de from '@/locales/de/Notifications.json'
import en from '@/locales/en/Notifications.json'

describe('describeParserWarning', () => {
  it('phrases an incomplete transcription', () => {
    expect(describeParserWarning('transcription_incomplete:80/120')).toEqual({
      key: 'Notifications.warnings.transcription_incomplete',
      params: { done: '80', total: '120' },
      raw: 'transcription_incomplete:80/120',
      severity: 'incomplete',
    })
  })

  it('phrases skipped frames of a multi-page scan', () => {
    expect(describeParserWarning('image_frames_ignored:fax.tiff:2')).toEqual({
      key: 'Notifications.warnings.image_frames_ignored',
      params: { file: 'fax.tiff', count: '2' },
      raw: 'image_frames_ignored:fax.tiff:2',
      severity: 'incomplete',
    })
  })

  it('phrases an unreadable mail attachment', () => {
    expect(
      describeParserWarning('mail_attachments_unsupported:Archiv.zip'),
    ).toEqual({
      key: 'Notifications.warnings.mail_attachments_unsupported',
      params: { file: 'Archiv.zip' },
      raw: 'mail_attachments_unsupported:Archiv.zip',
      severity: 'incomplete',
    })
  })

  it('phrases a guessed text encoding', () => {
    expect(describeParserWarning('text_encoding_assumed:cp1252')).toEqual({
      key: 'Notifications.warnings.text_encoding_assumed',
      params: { encoding: 'cp1252' },
      raw: 'text_encoding_assumed:cp1252',
      severity: 'incomplete',
    })
  })

  it('phrases a recording over the service budget', () => {
    expect(
      describeParserWarning('media_duration_over_budget:5400s:1800s'),
    ).toEqual({
      key: 'Notifications.warnings.media_duration_over_budget',
      params: { duration: '5400s', budget: '1800s' },
      raw: 'media_duration_over_budget:5400s:1800s',
      severity: 'incomplete',
    })
  })

  it('shows an unknown code verbatim and treats it as incomplete', () => {
    // a code nobody phrased yet must not be waved through as harmless
    const view = describeParserWarning('brand_new_code:42')
    expect(view.key).toBeUndefined()
    expect(view.raw).toBe('brand_new_code:42')
    expect(view.severity).toBe('incomplete')
  })

  it('shows a known code with an unexpected detail verbatim', () => {
    // a changed detail format must not render a sentence with holes in it
    expect(
      describeParserWarning('transcription_incomplete').key,
    ).toBeUndefined()
    expect(
      describeParserWarning('image_frames_ignored:fax.tiff').key,
    ).toBeUndefined()
    expect(describeParserWarning('text_encoding_assumed:').key).toBeUndefined()
  })

  it('keeps the severity of a known code whose detail no longer parses', () => {
    // the phrasing is lost, the judgement is not
    expect(describeParserWarning('transcription_incomplete').severity).toBe(
      'incomplete',
    )
    expect(describeParserWarning('table_columns_widened').severity).toBe('note')
  })
})

describe('severity', () => {
  it('reads a repaired table and deduplicated images as notes', () => {
    // the customer case: a complete 750-page import that looked like a failure
    for (const raw of [
      'table_columns_widened:8',
      'table_columns_realigned:3',
      'table_merged:pages 28-29',
      'vision_skipped_duplicate:66',
      'vision_suppressed:img-p156-1,img-p178-2,img-p179-1',
      'vision_suppression_vetoed:img-p19-1',
      'document_annotation_unavailable',
      'polish_rejected:pages 3,8-12',
      // the provider's confidence does not say WHERE something is wrong
      'low_confidence:pages 3,4',
    ]) {
      expect(describeParserWarning(raw).severity, raw).toBe('note')
    }
  })

  it('reads missing content as incomplete', () => {
    for (const raw of [
      'vision_skipped_cap:254',
      'table_summary_skipped:tbl_a,tbl_b',
      'extraction_incomplete:3/46',
      'text_truncated',
      'office_slide_unreadable:4',
    ]) {
      expect(describeParserWarning(raw).severity, raw).toBe('incomplete')
    }
  })
})

describe('detail handling', () => {
  it('counts a list instead of printing the ids', () => {
    // "vision_suppressed:img-p156-1,img-p178-2,…" — the id wall is the problem
    expect(
      describeParserWarning(
        'vision_suppressed:img-p156-1,img-p178-2,img-p179-1',
      ).params,
    ).toEqual({ count: '3' })
    expect(
      describeParserWarning('table_summary_skipped:tbl_a,tbl_b').params,
    ).toEqual({ count: '2' })
  })

  it('strips the page label the service prefixes', () => {
    expect(describeParserWarning('table_merged:pages 28-29').params).toEqual({
      pages: '28-29',
    })
    expect(describeParserWarning('table_mode_degraded:page 7').params).toEqual({
      page: '7',
    })
    expect(describeParserWarning('low_confidence:pages 3,4,5').params).toEqual({
      pages: '3,4,5',
    })
  })

  it('phrases a code without a detail', () => {
    expect(describeParserWarning('text_truncated')).toEqual({
      key: 'Notifications.warnings.text_truncated',
      params: {},
      raw: 'text_truncated',
      severity: 'incomplete',
    })
  })

  it('phrases a code that carries an id it does not need', () => {
    // one warning per image; the id says nothing to a customer
    const view = describeParserWarning('vision_suppression_vetoed:img-p19-1')
    expect(view.key).toBe('Notifications.warnings.vision_suppression_vetoed')
    expect(view.params).toEqual({})
  })

  it('does not phrase an empty list', () => {
    expect(describeParserWarning('vision_suppressed:').key).toBeUndefined()
  })
})

describe('describeParserWarnings', () => {
  it('keeps the order and drops empty entries', () => {
    const views = describeParserWarnings([
      'text_encoding_assumed:cp1252',
      '   ',
      'brand_new_code:42',
    ])
    expect(views).toHaveLength(2)
    expect(views[0]?.key).toBe('Notifications.warnings.text_encoding_assumed')
    expect(views[1]?.raw).toBe('brand_new_code:42')
  })

  it('handles a result without warnings', () => {
    expect(describeParserWarnings(undefined)).toEqual([])
    expect(describeParserWarnings([])).toEqual([])
  })
})

describe('hasIncompleteWarning', () => {
  it('is false for a list of notes only', () => {
    expect(
      hasIncompleteWarning(
        describeParserWarnings([
          'table_columns_widened:8',
          'vision_skipped_duplicate:66',
          'vision_suppressed:img-p156-1,img-p178-2',
        ]),
      ),
    ).toBe(false)
  })

  it('is true as soon as one entry lost content', () => {
    expect(
      hasIncompleteWarning(
        describeParserWarnings([
          'table_columns_widened:8',
          'vision_skipped_cap:254',
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
  ])('phrases every known code in %s', (_lang, messages) => {
    const warnings = messages.warnings as Record<string, string>
    const missing = KNOWN_WARNING_CODES.filter((code) => !warnings[code])
    expect(missing).toEqual([])
  })

  it.each([
    ['de', de],
    ['en', en],
  ])('has no phrasing without a code in %s', (_lang, messages) => {
    const warnings = messages.warnings as Record<string, string>
    const headings = ['title', 'titleNotes']
    const orphans = Object.keys(warnings).filter(
      (key) => !headings.includes(key) && !KNOWN_WARNING_CODES.includes(key),
    )
    expect(orphans).toEqual([])
  })

  it('carries both headings', () => {
    for (const messages of [de, en]) {
      const warnings = messages.warnings as Record<string, string>
      expect(warnings.title).toBeTruthy()
      expect(warnings.titleNotes).toBeTruthy()
    }
  })
})
