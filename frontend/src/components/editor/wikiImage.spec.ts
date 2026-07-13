import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WikiImage } from './wikiImage'

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
