import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import {
  WikiDownload,
  downloadFileName,
  fileExtensionLabel,
  formatFileSize,
  hasImagePreview,
} from './wikiDownload'
import { renderBlocksForReading } from '@/utils/wikiReader'
import { editorHtmlToBlocks } from '@/utils/wikiBlocks'

const FILE = '0b0c5a8e-1111-4a2b-9c3d-123456789abc.pdf'
const SRC = `/api/v1/tenant/t1/files/db/knowledge/${FILE}`
const STORED =
  `<div data-type="wiki-download" data-name="Preisliste 2026.pdf" data-size="482133" data-mime="application/pdf">` +
  `<a href="${SRC}">Preisliste 2026.pdf</a></div>`

const makeEditor = (content: string) =>
  new Editor({
    extensions: [Document, Paragraph, Text, WikiDownload],
    content,
  })

describe('WikiDownload', () => {
  test('round-trips the file reference and its metadata', () => {
    const editor = makeEditor(STORED)
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({
      src: SRC,
      name: 'Preisliste 2026.pdf',
      size: 482133,
      mime: 'application/pdf',
    })
    const [block] = editorHtmlToBlocks(editor.getHTML())
    // the path stays in a real link: the backend's reference tracking and
    // every text-only reader depend on it
    expect(block!.content).toContain(`<a href="${SRC}">Preisliste 2026.pdf</a>`)
    expect(block!.content).toContain('data-size="482133"')
    editor.destroy()
  })

  test('the editor renders a card with name, type and size', () => {
    const editor = makeEditor(STORED)
    const card = editor.view.dom.querySelector('.wiki-download')!
    expect(card.querySelector('.wiki-download__name')!.textContent).toBe(
      'Preisliste 2026.pdf',
    )
    expect(card.querySelector('.wiki-download__info')!.textContent).toBe(
      'PDF · 471 KB',
    )
    expect(card.querySelector('.wiki-download__badge')!.textContent).toBe('PDF')
    editor.destroy()
  })

  test('the reader replaces the stored block with the same card', () => {
    const root = document.createElement('div')
    root.append(
      renderBlocksForReading([{ id: 'b1', type: 'html', content: STORED }], {
        imageDescriptionLabel: 'x',
        downloadLabel: 'Herunterladen',
      }),
    )
    const card = root.firstElementChild!
    expect(card.classList.contains('wiki-download')).toBe(true)
    expect(card.getAttribute('data-block-id')).toBe('b1')
    const button = card.querySelector('[data-download-src]')!
    expect(button.getAttribute('data-download-src')).toBe(SRC)
    expect(button.getAttribute('data-download-name')).toBe('Preisliste 2026.pdf')
    expect(button.textContent).toContain('Herunterladen')
  })

  test('a picture gets a preview, other files a type badge', () => {
    const image = STORED.replace(/application\/pdf/, 'image/png').replace(
      /\.pdf/g,
      '.png',
    )
    const root = document.createElement('div')
    root.append(
      renderBlocksForReading([{ type: 'html', content: image }], {
        imageDescriptionLabel: 'x',
      }),
    )
    const preview = root.querySelector('.wiki-download__preview img')!
    expect(preview.getAttribute('src')).toBe(SRC.replace('.pdf', '.png'))
    // not wrapped into an image figure
    expect(root.querySelector('figure')).toBeNull()
  })
})

describe('download helpers', () => {
  test('downloadFileName takes the stored file from a path', () => {
    expect(downloadFileName(SRC)).toBe(FILE)
    expect(downloadFileName('https://example.com/x.pdf')).toBeNull()
    expect(downloadFileName('/files/db/chat/abc.pdf')).toBeNull()
  })

  test('formatFileSize', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1536)).toBe('1,5 KB')
    expect(formatFileSize(25 * 1024 * 1024, 'en')).toBe('25.0 MB')
    expect(formatFileSize(null)).toBe('')
  })

  test('fileExtensionLabel', () => {
    expect(fileExtensionLabel('a.tar.gz')).toBe('GZ')
    expect(fileExtensionLabel('README')).toBe('')
  })

  test('hasImagePreview only for raster images', () => {
    expect(hasImagePreview({ mime: 'image/jpeg', name: 'a.jpg' })).toBe(true)
    expect(hasImagePreview({ mime: 'application/octet-stream', name: 'a.svg' })).toBe(false)
    expect(hasImagePreview({ mime: 'application/pdf', name: 'a.pdf' })).toBe(false)
  })
})
