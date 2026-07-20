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
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseUrlLine('  https://example.com/a  ')).toEqual({
      url: 'https://example.com/a',
    })
  })

  it('parses a title after a pipe', () => {
    expect(parseUrlLine('https://example.com/b | Nice title')).toEqual({
      url: 'https://example.com/b',
      title: 'Nice title',
      subPath: [],
    })
  })

  it('parses a subpath after a comma', () => {
    expect(parseUrlLine('https://example.com/c, Docs/API')).toEqual({
      url: 'https://example.com/c',
      title: null,
      subPath: ['Docs', 'API'],
    })
  })

  it('parses a subpath after a semicolon', () => {
    expect(parseUrlLine('https://example.com/c; Docs/API')).toEqual({
      url: 'https://example.com/c',
      title: null,
      subPath: ['Docs', 'API'],
    })
  })

  it('keeps spaces inside category names', () => {
    expect(parseUrlLine('https://example.com/d, Team Wiki/API Reference')).toEqual(
      {
        url: 'https://example.com/d',
        title: null,
        subPath: ['Team Wiki', 'API Reference'],
      },
    )
  })

  it('parses title and subpath together (title first)', () => {
    expect(
      parseUrlLine('https://example.com/e | My Doc, Handbook/Onboarding'),
    ).toEqual({
      url: 'https://example.com/e',
      title: 'My Doc',
      subPath: ['Handbook', 'Onboarding'],
    })
  })

  it('parses title and subpath together (subpath first)', () => {
    expect(
      parseUrlLine('https://example.com/e; Handbook/Onboarding | My Doc'),
    ).toEqual({
      url: 'https://example.com/e',
      title: 'My Doc',
      subPath: ['Handbook', 'Onboarding'],
    })
  })

  it('drops empty and stray path segments', () => {
    expect(parseUrlLine('https://example.com/f, /A//B/')).toEqual({
      url: 'https://example.com/f',
      title: null,
      subPath: ['A', 'B'],
    })
  })

  it('ignores blank lines and lines without a URL', () => {
    expect(parseUrlLine('   ')).toBeNull()
    expect(parseUrlLine(', OnlyCategory')).toBeNull()
  })
})

describe('parseUrlLines', () => {
  it('parses a multi-line block and skips blanks', () => {
    const text = [
      'https://example.com/a',
      '',
      'https://example.com/b | Title, Cat/Sub',
    ].join('\n')
    expect(parseUrlLines(text)).toEqual([
      { url: 'https://example.com/a' },
      {
        url: 'https://example.com/b',
        title: 'Title',
        subPath: ['Cat', 'Sub'],
      },
    ])
  })
})

describe('urlLineToText / round-trip', () => {
  it('serializes each optional field', () => {
    expect(urlLineToText({ url: 'https://example.com/a' })).toBe(
      'https://example.com/a',
    )
    expect(
      urlLineToText({ url: 'https://example.com/a', title: 'T' }),
    ).toBe('https://example.com/a | T')
    expect(
      urlLineToText({ url: 'https://example.com/a', subPath: ['X', 'Y'] }),
    ).toBe('https://example.com/a , X / Y')
    expect(
      urlLineToText({
        url: 'https://example.com/a',
        title: 'T',
        subPath: ['X', 'Y'],
      }),
    ).toBe('https://example.com/a | T , X / Y')
  })

  it('round-trips through parse → serialize → parse', () => {
    const text = urlLinesToText([
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b', title: 'Title', subPath: ['Cat', 'Sub'] },
    ])
    expect(parseUrlLines(text)).toEqual([
      { url: 'https://example.com/a' },
      {
        url: 'https://example.com/b',
        title: 'Title',
        subPath: ['Cat', 'Sub'],
      },
    ])
  })
})
