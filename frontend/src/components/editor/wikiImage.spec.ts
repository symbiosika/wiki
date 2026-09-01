import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import {
  WikiImage,
  embedImageDescriptions,
  normalizeImageDescription,
} from './wikiImage'

/** Minimal editor with just the nodes needed to exercise WikiImage. */
const makeEditor = (content: string) =>
  new Editor({
    extensions: [Document, Paragraph, Text, WikiImage],
    content,
  })

describe('WikiImage', () => {
  test('parses data-size / data-align from HTML and renders them back', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/wiki/x.png" alt="x" data-size="lg" data-align="center">',
    )
    const html = editor.getHTML()
    expect(html).toContain('data-size="lg"')
    expect(html).toContain('data-align="center"')
    editor.destroy()
  })

  test('omits the attributes when unset (backwards-compatible output)', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/wiki/x.png" alt="x">',
    )
    const html = editor.getHTML()
    expect(html).not.toContain('data-size')
    expect(html).not.toContain('data-align')
    editor.destroy()
  })

  test('keeps a description through the html round trip', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/knowledge/x.png" alt="x" ' +
        'data-description="Schaltplan der Steuerplatine">',
    )
    expect(editor.getHTML()).toContain(
      'data-description="Schaltplan der Steuerplatine"',
    )
    editor.destroy()
  })

  test('normalizes a description to one line on the way in', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/knowledge/x.png" ' +
        'data-description="Zeile eins\n   Zeile zwei">',
    )
    expect(editor.getHTML()).toContain(
      'data-description="Zeile eins Zeile zwei"',
    )
    editor.destroy()
  })

  test('drops an empty description instead of writing an empty attribute', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/knowledge/x.png" data-description="   ">',
    )
    expect(editor.getHTML()).not.toContain('data-description')
    editor.destroy()
  })

  test('updateAttributes sets and clears the description', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/knowledge/x.png" alt="x">',
    )
    editor.commands.setNodeSelection(0)
    editor.commands.updateAttributes('image', { description: 'Nahaufnahme' })
    expect(editor.getHTML()).toContain('data-description="Nahaufnahme"')
    editor.commands.updateAttributes('image', { description: null })
    expect(editor.getHTML()).not.toContain('data-description')
    editor.destroy()
  })

  test('updateAttributes changes the rendered size/alignment', () => {
    const editor = makeEditor(
      '<img src="/api/v1/tenant/t/files/db/wiki/x.png" alt="x">',
    )
    // select the image node (it is the first node in the doc)
    editor.commands.setNodeSelection(0)
    editor.commands.updateAttributes('image', { size: 'xs', align: 'right' })
    const html = editor.getHTML()
    expect(html).toContain('data-size="xs"')
    expect(html).toContain('data-align="right"')
    editor.destroy()
  })
})

describe('normalizeImageDescription', () => {
  test('collapses whitespace and maps anything empty to null', () => {
    expect(normalizeImageDescription('  a\n\n  b ')).toBe('a b')
    expect(normalizeImageDescription('   ')).toBeNull()
    expect(normalizeImageDescription(null)).toBeNull()
    expect(normalizeImageDescription(undefined)).toBeNull()
  })
})

describe('embedImageDescriptions', () => {
  const REF = '/files/db/knowledge/11111111-1111-1111-1111-111111111111.png'
  const FULL = `/api/v1/tenant/t-1${REF}`

  const parse = (html: string): HTMLElement => {
    const host = document.createElement('div')
    host.innerHTML = html
    embedImageDescriptions(host)
    return host
  }

  test('moves the marker onto the image it names', () => {
    const host = parse(
      `<img src="${FULL}"><image-description src="${FULL}">Steuerplatine</image-description>`,
    )
    expect(host.querySelector('img')?.getAttribute('data-description')).toBe(
      'Steuerplatine',
    )
    expect(host.querySelector('image-description')).toBeNull()
  })

  test('matches the marker across the two path forms', () => {
    // the editor embeds the full API path, the marker may carry only the tail
    const host = parse(
      `<img src="${FULL}"><image-description src="${REF}">Nahaufnahme</image-description>`,
    )
    expect(host.querySelector('img')?.getAttribute('data-description')).toBe(
      'Nahaufnahme',
    )
  })

  test('falls back to the image directly above the marker', () => {
    const host = parse(
      `<img src="/other.png"><image-description>Ohne src</image-description>`,
    )
    expect(host.querySelector('img')?.getAttribute('data-description')).toBe(
      'Ohne src',
    )
  })

  test('drops the paragraph marked demoted markdown leaves behind', () => {
    // `marked` wraps a lone raw-html line in a <p>
    const host = parse(
      `<p><img src="${FULL}"></p><p><image-description src="${FULL}">Steuerplatine</image-description></p>`,
    )
    expect(host.querySelectorAll('p').length).toBe(1)
    expect(host.querySelector('img')?.getAttribute('data-description')).toBe(
      'Steuerplatine',
    )
  })

  test('keeps the description the image already carries', () => {
    const host = parse(
      `<img src="${FULL}" data-description="Vom Editor"><image-description src="${FULL}">Aus dem Text</image-description>`,
    )
    expect(host.querySelector('img')?.getAttribute('data-description')).toBe(
      'Vom Editor',
    )
  })

  test('removes a marker whose image is nowhere in the fragment', () => {
    const host = parse(
      `<p>Text</p><image-description src="${REF}">Verwaist</image-description>`,
    )
    expect(host.querySelector('image-description')).toBeNull()
    expect(host.textContent).toBe('Text')
  })

  test('does nothing to a fragment without markers', () => {
    const html = `<p>Text</p><img src="${FULL}">`
    expect(parse(html).innerHTML).toBe(html)
  })
})
