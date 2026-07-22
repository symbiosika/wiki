import { describe, it, expect } from 'vitest'
import {
  parseUrlLine,
  parseUrlLines,
  urlLineToText,
  urlLinesToText,
} from './urlImportLines'

describe('parseUrlLine', () => {
  it('parses a plain URL', () => {
    expect(parseUrlLine('https://example.com/a')).toEqual({
      url: 'https://example.com/a',
      title: null,
      subPath: [],
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseUrlLine('  https://example.com/a  ')).toEqual({
      url: 'https://example.com/a',
      title: null,
      subPath: [],
    })
  })

  it('parses a title in the second field (semicolon)', () => {
    expect(parseUrlLine('https://example.com/b ; Nice title')).toEqual({
      url: 'https://example.com/b',
      title: 'Nice title',
      subPath: [],
    })
  })

  it('parses a title in the second field (comma)', () => {
    expect(parseUrlLine('https://example.com/b, Nice title')).toEqual({
      url: 'https://example.com/b',
      title: 'Nice title',
      subPath: [],
    })
  })

  it('parses URL + title + subpath with one consistent separator', () => {
    expect(
      parseUrlLine(
        'https://cereda-systems.de/download/x/?wpdmdl=7771 ; Systemkatalog ZELO FL24 Rufanlagen (v3) ; Cereda/Marketing',
      ),
    ).toEqual({
      url: 'https://cereda-systems.de/download/x/?wpdmdl=7771',
      title: 'Systemkatalog ZELO FL24 Rufanlagen (v3)',
      subPath: ['Cereda', 'Marketing'],
    })
  })

  it('keeps spaces inside category names', () => {
    expect(
      parseUrlLine('https://example.com/d ; My Doc ; Team Wiki/API Reference'),
    ).toEqual({
      url: 'https://example.com/d',
      title: 'My Doc',
      subPath: ['Team Wiki', 'API Reference'],
    })
  })

  it('allows a subpath without a title (empty middle field)', () => {
    expect(parseUrlLine('https://example.com/e ; ; Docs/API')).toEqual({
      url: 'https://example.com/e',
      title: null,
      subPath: ['Docs', 'API'],
    })
  })

  it('folds extra fields into the subpath (";" as a level separator too)', () => {
    expect(parseUrlLine('https://example.com/f ; Title ; Docs ; API')).toEqual({
      url: 'https://example.com/f',
      title: 'Title',
      subPath: ['Docs', 'API'],
    })
  })

  it('drops empty and stray path segments', () => {
    expect(parseUrlLine('https://example.com/g ; ; /A//B/')).toEqual({
      url: 'https://example.com/g',
      title: null,
      subPath: ['A', 'B'],
    })
  })

  it('still accepts the legacy "url | title" form', () => {
    expect(parseUrlLine('https://example.com/h | Legacy title')).toEqual({
      url: 'https://example.com/h',
      title: 'Legacy title',
      subPath: [],
    })
  })

  it('accepts legacy pipe title plus a subpath field', () => {
    expect(
      parseUrlLine('https://example.com/h | Legacy title ; Docs/API'),
    ).toEqual({
      url: 'https://example.com/h',
      title: 'Legacy title',
      subPath: ['Docs', 'API'],
    })
  })

  it('ignores blank lines and lines without a URL', () => {
    expect(parseUrlLine('   ')).toBeNull()
    expect(parseUrlLine('; OnlyCategory')).toBeNull()
  })
})

describe('parseUrlLines', () => {
  it('parses a multi-line block and skips blanks', () => {
    const text = [
      'https://example.com/a',
      '',
      'https://example.com/b ; Title ; Cat/Sub',
    ].join('\n')
    expect(parseUrlLines(text)).toEqual([
      { url: 'https://example.com/a', title: null, subPath: [] },
      {
        url: 'https://example.com/b',
        title: 'Title',
        subPath: ['Cat', 'Sub'],
      },
    ])
  })
})

describe('urlLineToText / round-trip', () => {
  it('serializes each optional field with a consistent separator', () => {
    expect(
      urlLineToText({ url: 'https://example.com/a', title: null, subPath: [] }),
    ).toBe('https://example.com/a')
    expect(
      urlLineToText({ url: 'https://example.com/a', title: 'T', subPath: [] }),
    ).toBe('https://example.com/a ; T')
    expect(
      urlLineToText({
        url: 'https://example.com/a',
        title: null,
        subPath: ['X', 'Y'],
      }),
    ).toBe('https://example.com/a ; ; X / Y')
    expect(
      urlLineToText({
        url: 'https://example.com/a',
        title: 'T',
        subPath: ['X', 'Y'],
      }),
    ).toBe('https://example.com/a ; T ; X / Y')
  })

  it('round-trips through parse → serialize → parse', () => {
    const entries = [
      { url: 'https://example.com/a', title: null, subPath: [] },
      {
        url: 'https://example.com/b',
        title: 'Title',
        subPath: ['Cat', 'Sub'],
      },
      {
        url: 'https://example.com/c',
        title: null,
        subPath: ['Only', 'Path'],
      },
    ]
    expect(parseUrlLines(urlLinesToText(entries))).toEqual(entries)
  })
})
