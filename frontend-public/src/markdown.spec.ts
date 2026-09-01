import { describe, it, expect } from 'vitest'
import { renderMarkdown, markdownToText, pageHref } from './markdown'

const TENANT = '11111111-1111-1111-1111-111111111111'
const PAGE = '22222222-2222-2222-2222-222222222222'
const SLUG = 'acme-gmbh'
const opts = { tenantId: TENANT, slug: SLUG, pageId: PAGE }

describe('renderMarkdown — sanitizing', () => {
  it('strips script tags', () => {
    const html = renderMarkdown('hello\n\n<script>alert(1)</script>', opts)
    expect(html).not.toContain('<script')
    expect(html).toContain('hello')
  })

  it('drops inline event handlers', () => {
    const html = renderMarkdown('<p onclick="steal()">text</p>', opts)
    expect(html).not.toContain('onclick')
    expect(html).toContain('text')
  })

  it('drops javascript: urls', () => {
    const html = renderMarkdown('[click](javascript:alert(1))', opts)
    expect(html).not.toContain('javascript:')
  })

  it('drops javascript: urls hidden behind control characters', () => {
    const html = renderMarkdown('<a href="java\tscript:alert(1)">x</a>', opts)
    expect(html).not.toMatch(/href="java/i)
  })

  it('keeps ordinary links and marks external ones safe', () => {
    const html = renderMarkdown('[docs](https://example.com)', opts)
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('target="_blank"')
  })

  it('removes iframes', () => {
    const html = renderMarkdown('<iframe src="https://evil.test"></iframe>', opts)
    expect(html).not.toContain('<iframe')
  })
})

describe('renderMarkdown — image rewriting', () => {
  it('points knowledge images at the public per-page endpoint', () => {
    const file = '33333333-3333-3333-3333-333333333333.png'
    const html = renderMarkdown(`![alt](/files/db/knowledge/${file})`, opts)
    expect(html).toContain(
      `/api/v1/public/wiki/${TENANT}/pages/${PAGE}/images/${file}`,
    )
    expect(html).not.toContain('/files/db/knowledge/')
  })

  it('points imported images (images bucket) at the same endpoint', () => {
    const file = '3885f189-5b63-4daf-8ea4-d981078039eb.jpeg'
    const html = renderMarkdown(`![img-0.jpeg](/files/db/images/${file})`, opts)
    expect(html).toContain(
      `/api/v1/public/wiki/${TENANT}/pages/${PAGE}/images/${file}`,
    )
    expect(html).not.toContain('/files/db/images/')
  })

  it('leaves images from other buckets alone', () => {
    const html = renderMarkdown(
      '![alt](/files/db/chat/44444444-4444-4444-4444-444444444444.png)',
      opts,
    )
    expect(html).toContain('/files/db/chat/')
  })

  it('leaves external images untouched', () => {
    const html = renderMarkdown('![alt](https://example.com/x.png)', opts)
    expect(html).toContain('https://example.com/x.png')
  })
})

describe('renderMarkdown — wiki links', () => {
  const resolveLink = (title: string) =>
    title === 'Published Page' ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : null

  it('links a published target', () => {
    const html = renderMarkdown('See [[Published Page]] for more.', {
      ...opts,
      resolveLink,
    })
    expect(html).toContain(pageHref(SLUG, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
    expect(html).toContain('Published Page')
  })

  it('resolves the backtick-wrapped form the editor produces', () => {
    const html = renderMarkdown('See `[[Published Page]]` for more.', {
      ...opts,
      resolveLink,
    })
    expect(html).toContain(pageHref(SLUG, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
    // no leftover code span around the resolved link
    expect(html).not.toContain('<code>[[')
  })

  it('honours an alias', () => {
    const html = renderMarkdown('[[Published Page|other words]]', { ...opts, resolveLink })
    expect(html).toContain('other words')
    expect(html).not.toContain('Published Page<')
  })

  it('renders an unpublished target as plain text, not a dead link', () => {
    const html = renderMarkdown('See [[Internal Secret]] here.', { ...opts, resolveLink })
    expect(html).toContain('Internal Secret')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('[[')
  })

  it('leaves wiki-link syntax inside fenced code alone', () => {
    const html = renderMarkdown('```\n[[Published Page]]\n```', { ...opts, resolveLink })
    expect(html).toContain('[[Published Page]]')
    expect(html).not.toContain('<a href')
  })

  it('escapes html in a link label', () => {
    const html = renderMarkdown('[[Published Page|<img src=x onerror=1>]]', {
      ...opts,
      resolveLink,
    })
    // the payload survives as visible text, never as an element
    expect(html).toContain('&lt;img')
    expect(html).not.toMatch(/<img[\s>]/)
  })
})

describe('markdownToText', () => {
  it('flattens markdown to readable text', () => {
    expect(markdownToText('# Title\n\nSome **bold** text.')).toBe('Title Some bold text.')
  })

  it('returns empty string for empty input', () => {
    expect(markdownToText('')).toBe('')
  })
})
