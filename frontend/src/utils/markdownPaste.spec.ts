import { describe, it, expect } from 'vitest'
import { looksLikeMarkdown } from './markdownPaste'

describe('looksLikeMarkdown', () => {
  it('detects headings', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true)
    expect(looksLikeMarkdown('Intro\n\n### A section\n\nmore')).toBe(true)
  })

  it('detects fenced code blocks', () => {
    expect(looksLikeMarkdown('```ts\nconst x = 1\n```')).toBe(true)
    expect(looksLikeMarkdown('~~~\nplain\n~~~')).toBe(true)
  })

  it('detects blockquotes', () => {
    expect(looksLikeMarkdown('> a quote')).toBe(true)
  })

  it('detects links and images', () => {
    expect(looksLikeMarkdown('see [the docs](https://example.com)')).toBe(true)
    expect(looksLikeMarkdown('![logo](/logo.png)')).toBe(true)
  })

  it('detects GFM tables', () => {
    expect(looksLikeMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(true)
  })

  it('detects bullet and ordered lists (two or more items)', () => {
    expect(looksLikeMarkdown('- first\n- second')).toBe(true)
    expect(looksLikeMarkdown('* one\n* two\n* three')).toBe(true)
    expect(looksLikeMarkdown('1. first\n2. second')).toBe(true)
  })

  it('detects text with two inline emphasis signals', () => {
    expect(looksLikeMarkdown('this has **bold** and `code` in it')).toBe(true)
  })

  it('ignores ordinary prose', () => {
    expect(looksLikeMarkdown('Hello, this is a normal sentence.')).toBe(false)
    expect(
      looksLikeMarkdown('Multiple lines\nof plain text\nwithout markdown.'),
    ).toBe(false)
  })

  it('does not trip on a single dash line or a lone asterisk', () => {
    expect(looksLikeMarkdown('- just one bullet-like line')).toBe(false)
    expect(looksLikeMarkdown('The price is 3 * 4 dollars.')).toBe(false)
    expect(looksLikeMarkdown('Meet me at 5. Bring snacks.')).toBe(false)
  })

  it('does not trip on a single weak inline signal', () => {
    expect(looksLikeMarkdown('emphasis on **this** only')).toBe(false)
  })

  it('handles empty / whitespace input', () => {
    expect(looksLikeMarkdown('')).toBe(false)
    expect(looksLikeMarkdown('   \n  ')).toBe(false)
  })

  it('normalises CRLF line endings', () => {
    expect(looksLikeMarkdown('- a\r\n- b')).toBe(true)
  })
})
