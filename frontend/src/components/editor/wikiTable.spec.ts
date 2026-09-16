/**
 * What a table costs when it is saved.
 *
 * These are size regressions, not feature tests: the cells still parse and
 * render the same table, but a cell that spans nothing no longer writes
 * `colspan="1" rowspan="1"`, and the block ids UniqueID maintains inside cells
 * no longer travel into the saved block. Both only show up on a page with
 * thousands of cells — where they were the bulk of what was stored.
 */
import { describe, expect, test } from 'vitest'
import { Editor, generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import UniqueID from '@tiptap/extension-unique-id'
import { WikiTableCell, WikiTableHeader } from './wikiTable'
import {
  BLOCK_ID_ATTRIBUTE,
  BLOCK_ID_TYPES,
  assignMissingBlockIds,
} from './blockIds'
import { blocksToEditorHtml, editorHtmlToBlocks } from '@/utils/wikiBlocks'
import type { WikiBlock } from '@/types/wiki'

const table = (rows: string[][]): WikiBlock[] => [
  {
    id: 'b1',
    type: 'markdown',
    content: [
      `| ${rows[0]!.join(' | ')} |`,
      `| ${rows[0]!.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ].join('\n'),
  },
]

const SIMPLE = table([
  ['Name', 'Age'],
  ['Alice', '30'],
])

/**
 * The editor as BlockEditor builds it: the same extensions, and the same
 * pre-assignment of block ids before the editor exists (see blockIds) — which
 * is what puts an id on every paragraph inside every cell.
 */
const makeEditor = (content: string, wikiCells: boolean) => {
  const extensions = [
    StarterKit,
    wikiCells
      ? TableKit.configure({ tableCell: false, tableHeader: false })
      : TableKit,
    ...(wikiCells ? [WikiTableCell, WikiTableHeader] : []),
    UniqueID.configure({
      attributeName: BLOCK_ID_ATTRIBUTE,
      types: [...BLOCK_ID_TYPES],
    }),
  ]
  const document = generateJSON(content, extensions)
  assignMissingBlockIds(document)
  return new Editor({ extensions, content: document })
}

describe('wiki table cells', () => {
  test("TipTap's own cells write a span onto every cell (the old behaviour)", () => {
    const editor = makeEditor(blocksToEditorHtml(SIMPLE), false)
    expect(editor.getHTML()).toContain('colspan="1"')
    editor.destroy()
  })

  test('a cell that spans nothing writes no span at all', () => {
    const editor = makeEditor(blocksToEditorHtml(SIMPLE), true)
    const html = editor.getHTML()
    expect(html).not.toContain('colspan')
    expect(html).not.toContain('rowspan')
    // still the same table
    expect(html).toContain('<table')
    expect(html).toContain('Alice')
    expect(html).toContain('30')
    editor.destroy()
  })

  test('a real span is parsed and written back', () => {
    const editor = makeEditor(
      '<table><tbody><tr><td colspan="2" rowspan="3">wide</td><td>x</td></tr></tbody></table>',
      true,
    )
    const html = editor.getHTML()
    expect(html).toContain('colspan="2"')
    expect(html).toContain('rowspan="3"')
    editor.destroy()
  })
})

describe('block ids inside table cells', () => {
  test('are not saved: only the block itself is addressed by one', () => {
    const editor = makeEditor(blocksToEditorHtml(SIMPLE), true)
    // the editor's own document does carry them (UniqueID maintains them on
    // every paragraph, wherever it sits) — that is what must not be persisted
    expect(editor.getHTML()).toContain(BLOCK_ID_ATTRIBUTE)

    const blocks = editorHtmlToBlocks(editor.getHTML())
    for (const block of blocks) {
      expect(block.content).not.toContain(BLOCK_ID_ATTRIBUTE)
    }
    editor.destroy()
  })

  test('the block keeps its own id, taken off the top-level element', () => {
    const editor = makeEditor(blocksToEditorHtml(SIMPLE), true)
    const blocks = editorHtmlToBlocks(editor.getHTML())
    expect(blocks[0]!.id).toBe('b1')
    editor.destroy()
  })
})

describe('saved size', () => {
  const rows = Array.from({ length: 20 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => `cell ${r}-${c}`),
  )
  const content = blocksToEditorHtml(table(rows))

  const savedSize = (wikiCells: boolean) => {
    const editor = makeEditor(content, wikiCells)
    const document = editor.getHTML()
    const saved = editorHtmlToBlocks(document)
      .map((block) => block.content)
      .join('').length
    editor.destroy()
    return { document: document.length, saved }
  }

  test('dropping the spans takes ~45% off a 160-cell table', () => {
    const before = savedSize(false).saved
    const after = savedSize(true).saved
    expect(after).toBeLessThan(before * 0.6)
  })

  test('dropping the cell block ids takes another ~40% off', () => {
    const { document, saved } = savedSize(true)
    expect(saved).toBeLessThan(document * 0.7)
  })
})
