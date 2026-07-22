import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { blocksToEditorHtml, editorHtmlToBlocks } from '@/utils/wikiBlocks'
import type { WikiBlock } from '@/types/wiki'

/**
 * Regression test for the "markdown tables lose their pipes on save" bug.
 *
 * A markdown table (e.g. from the generic PDF parser) is rendered to a
 * `<table>` by `marked` in `blocksToEditorHtml`. If the TipTap editor schema
 * has no table node, the editor silently drops the table on load — and the
 * next save persists the loss. These tests pin down that the editor now keeps
 * tables, and document the old behaviour as the negative control.
 */
const tableBlock: WikiBlock[] = [
  {
    id: 'b1',
    type: 'markdown',
    content: ['| Name | Age |', '| --- | --- |', '| Alice | 30 |'].join('\n'),
  },
]

describe('editor table support', () => {
  test('marked renders a markdown table to real <table> HTML', () => {
    const html = blocksToEditorHtml(tableBlock)
    expect(html).toContain('<table')
    expect(html).toContain('Alice')
  })

  test('an editor WITHOUT a table node drops the table (the old bug)', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: blocksToEditorHtml(tableBlock),
    })
    expect(editor.getHTML()).not.toContain('<table')
    editor.destroy()
  })

  test('an editor WITH TableKit keeps the table and its cells', () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: blocksToEditorHtml(tableBlock),
    })
    const html = editor.getHTML()
    expect(html).toContain('<table')
    expect(html).toContain('Name')
    expect(html).toContain('Alice')
    expect(html).toContain('30')
    editor.destroy()
  })

  test('the table survives a load + save round-trip as blocks', () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: blocksToEditorHtml(tableBlock),
    })
    const blocks = editorHtmlToBlocks(editor.getHTML())
    const combined = blocks.map((block) => block.content).join('')
    expect(combined).toContain('<table')
    expect(combined).toContain('Alice')
    editor.destroy()
  })
})
