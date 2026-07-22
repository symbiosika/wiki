import { describe, it, expect } from 'vitest'
import { renderMarkdown, renderMarkdownInline } from './markdown'

describe('renderMarkdown', () => {
  it('renders common markdown to HTML', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code`.')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders lists and fenced code blocks', () => {
    const html = renderMarkdown('- a\n- b\n\n```\nconst x = 1\n```')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<pre>')
  })

  it('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
  })

  it('strips <script> tags', () => {
    const html = renderMarkdown('hi\n\n<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('hi')
  })

  it('drops inline event handlers', () => {
    const html = renderMarkdown('<a href="#" onclick="alert(1)">x</a>')
    expect(html).not.toContain('onclick')
  })

  it('blocks javascript: urls', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('blocks obfuscated javascript: urls with control chars', () => {
    const html = renderMarkdown('<a href="java\tscript:alert(1)">x</a>')
    expect(html.toLowerCase()).not.toContain('script:')
  })

  it('opens external links safely in a new tab', () => {
    const html = renderMarkdown('[site](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('keeps safe relative and mailto links', () => {
    const html = renderMarkdown('[a](/wiki/page) [b](mailto:x@y.z)')
    expect(html).toContain('href="/wiki/page"')
    expect(html).toContain('href="mailto:x@y.z"')
  })

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('renderMarkdownInline', () => {
  it('renders inline markdown without a wrapping paragraph', () => {
    const html = renderMarkdownInline('**bold** text')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).not.toContain('<p>')
  })
})
