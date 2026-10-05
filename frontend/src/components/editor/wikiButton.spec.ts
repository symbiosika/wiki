import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WikiButton, normalizeButtonHref } from './wikiButton'
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
