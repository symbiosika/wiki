import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import {
  WikiButton,
  buildButtonCard,
  displayUrl,
  normalizeButtonHref,
} from './wikiButton'
import { renderBlocksForReading } from '@/utils/wikiReader'

const makeEditor = (content: string) =>
  new Editor({
    extensions: [Document, Paragraph, Text, WikiButton],
    content,
  })

const STORED =
  '<div data-type="wiki-button" data-variant="outline" data-align="center">' +
  '<a href="https://example.com/anmeldung">Jetzt anmelden</a></div>'

describe('WikiButton', () => {
  test('round-trips label, link, style and alignment', () => {
    const editor = makeEditor(STORED)
    const node = editor.state.doc.firstChild!
    expect(node.type.name).toBe('wikiButton')
    expect(node.attrs).toMatchObject({
      href: 'https://example.com/anmeldung',
      text: 'Jetzt anmelden',
      variant: 'outline',
      align: 'center',
    })
    const html = editor.getHTML()
    expect(html).toContain('data-type="wiki-button"')
    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('data-align="center"')
    expect(html).toContain(
      '<a href="https://example.com/anmeldung">Jetzt anmelden</a>',
    )
    editor.destroy()
  })

  test('falls back to sane defaults for unknown style values', () => {
    const editor = makeEditor(
      '<div data-type="wiki-button" data-variant="neon"><a href="/x">Go</a></div>',
    )
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({
      variant: 'primary',
      align: 'left',
    })
    expect(editor.getHTML()).not.toContain('data-align')
    editor.destroy()
  })

  test('inserts a button through its command', () => {
    const editor = makeEditor('<p></p>')
    editor.commands.insertWikiButton({
      href: 'https://example.com',
      text: 'Los',
      variant: 'secondary',
      align: 'right',
    })
    expect(editor.getHTML()).toContain('data-variant="secondary"')
    editor.destroy()
  })

  test('the reader shows the stored markup as the button, link intact', () => {
    const root = document.createElement('div')
    root.append(
      renderBlocksForReading([{ id: 'b1', type: 'html', content: STORED }], {
        imageDescriptionLabel: 'x',
      }),
    )
    const link = root.querySelector('div[data-type="wiki-button"] > a')!
    expect(link.getAttribute('href')).toBe('https://example.com/anmeldung')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})

describe('normalizeButtonHref', () => {
  test('accepts web addresses, mail, phone and app paths', () => {
    expect(normalizeButtonHref('https://example.com/a')).toBe(
      'https://example.com/a',
    )
    expect(normalizeButtonHref('example.com')).toBe('https://example.com/')
    expect(normalizeButtonHref('mailto:info@example.com')).toBe(
      'mailto:info@example.com',
    )
    expect(normalizeButtonHref('/tenant/x/wiki/y')).toBe('/tenant/x/wiki/y')
  })

  test('rejects scripts, data urls and nonsense', () => {
    expect(normalizeButtonHref('javascript:alert(1)')).toBeNull()
    expect(normalizeButtonHref('data:text/html,hi')).toBeNull()
    expect(normalizeButtonHref('//evil.test')).toBeNull()
    expect(normalizeButtonHref('hallo')).toBeNull()
    expect(normalizeButtonHref('')).toBeNull()
  })
})

describe('WikiButton with a preview image (link card)', () => {
  const IMAGE =
    '/api/v1/tenant/t1/files/db/knowledge/0b0c5a8e-1111-4a2b-9c3d-123456789abc.png'
  const CARD =
    '<div data-type="wiki-button" data-variant="secondary">' +
    `<p><img src="${IMAGE}" alt="Schulungsvideo"></p>` +
    '<p><a href="https://videos.example.com/watch/42">Schulungsvideo</a></p></div>'

  test('round-trips the image as a real <img> next to the link', () => {
    const editor = makeEditor(CARD)
    const node = editor.state.doc.firstChild!
    expect(node.attrs).toMatchObject({
      href: 'https://videos.example.com/watch/42',
      text: 'Schulungsvideo',
      variant: 'secondary',
      image: IMAGE,
    })
    const html = editor.getHTML()
    // the image stays a real reference: reference tracking, MCP and the
    // public site all depend on it
    expect(html).toContain(`<img src="${IMAGE}" alt="Schulungsvideo">`)
    expect(html).toContain(
      '<a href="https://videos.example.com/watch/42">Schulungsvideo</a>',
    )
    editor.destroy()
  })

  test('a button without an image keeps its plain markup', () => {
    const editor = makeEditor(STORED)
    expect(editor.state.doc.firstChild!.attrs.image).toBeNull()
    expect(editor.getHTML()).not.toContain('<img')
    editor.destroy()
  })

  test('the editor shows the card: image, name, address, copy and button', () => {
    const editor = makeEditor(CARD)
    const card = editor.view.dom.querySelector('.wiki-link-card')!
    expect(card.querySelector('img')!.getAttribute('src')).toBe(IMAGE)
    expect(card.querySelector('.wiki-link-card__title')!.textContent).toBe(
      'Schulungsvideo',
    )
    expect(card.querySelector('.wiki-link-card__address')!.textContent).toBe(
      'videos.example.com/watch/42',
    )
    expect(
      card.querySelector('[data-copy-url]')!.getAttribute('data-copy-url'),
    ).toBe('https://videos.example.com/watch/42')
    expect(card.getAttribute('data-variant')).toBe('secondary')
    editor.destroy()
  })

  test('the copy button puts the address on the clipboard', async () => {
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void writes.push(text) },
      configurable: true,
    })
    const card = buildButtonCard({
      href: 'https://videos.example.com/watch/42',
      text: 'Video',
      variant: 'primary',
      align: 'left',
      image: IMAGE,
    })
    ;(card.querySelector('[data-copy-url]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writes).toEqual(['https://videos.example.com/watch/42'])
  })

  test('the reader renders the same card, block id on it, image not a figure', () => {
    const root = document.createElement('div')
    root.append(
      renderBlocksForReading([{ id: 'b1', type: 'html', content: CARD }], {
        imageDescriptionLabel: 'x',
        buttonCardLabels: { open: 'Öffnen', copy: 'URL kopieren', copied: 'Kopiert' },
      }),
    )
    const card = root.firstElementChild!
    expect(card.classList.contains('wiki-link-card')).toBe(true)
    expect(card.getAttribute('data-block-id')).toBe('b1')
    expect(root.querySelector('figure')).toBeNull()
    expect(card.querySelector('.wiki-link-card__button')!.textContent).toBe(
      'Öffnen ↗',
    )
  })
})

describe('displayUrl', () => {
  test('drops the scheme and a trailing slash', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com')
    expect(displayUrl('mailto:a@b.de')).toBe('mailto:a@b.de')
  })
})
