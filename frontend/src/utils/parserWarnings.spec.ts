import { describe, it, expect } from 'vitest'
import { describeParserWarning, describeParserWarnings } from './parserWarnings'

describe('describeParserWarning', () => {
  it('phrases an incomplete transcription', () => {
    expect(describeParserWarning('transcription_incomplete:80/120')).toEqual({
      key: 'Notifications.warnings.transcription_incomplete',
      params: { done: '80', total: '120' },
      raw: 'transcription_incomplete:80/120',
    })
  })

  it('phrases skipped frames of a multi-page scan', () => {
    expect(describeParserWarning('image_frames_ignored:fax.tiff:2')).toEqual({
      key: 'Notifications.warnings.image_frames_ignored',
      params: { file: 'fax.tiff', count: '2' },
      raw: 'image_frames_ignored:fax.tiff:2',
    })
  })

  it('phrases an unreadable mail attachment', () => {
    expect(
      describeParserWarning('mail_attachments_unsupported:Archiv.zip'),
    ).toEqual({
      key: 'Notifications.warnings.mail_attachments_unsupported',
      params: { file: 'Archiv.zip' },
      raw: 'mail_attachments_unsupported:Archiv.zip',
    })
  })

  it('phrases a guessed text encoding', () => {
    expect(describeParserWarning('text_encoding_assumed:cp1252')).toEqual({
      key: 'Notifications.warnings.text_encoding_assumed',
      params: { encoding: 'cp1252' },
      raw: 'text_encoding_assumed:cp1252',
    })
  })

  it('phrases empty formula cells of a sheet', () => {
    expect(describeParserWarning('xlsx_formula_without_value:Blatt2')).toEqual({
      key: 'Notifications.warnings.xlsx_formula_without_value',
      params: { sheet: 'Blatt2' },
      raw: 'xlsx_formula_without_value:Blatt2',
    })
  })

  it('phrases a recording over the service budget', () => {
    expect(
      describeParserWarning('media_duration_over_budget:5400s:1800s'),
    ).toEqual({
      key: 'Notifications.warnings.media_duration_over_budget',
      params: { duration: '5400s', budget: '1800s' },
      raw: 'media_duration_over_budget:5400s:1800s',
    })
  })

  it('shows an unknown code verbatim instead of dropping it', () => {
    const view = describeParserWarning('required field "hersteller" not found')
    expect(view.key).toBeUndefined()
    expect(view.raw).toBe('required field "hersteller" not found')
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
