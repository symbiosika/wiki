import { describe, expect, test } from 'vitest'
import { blocksToMarkdown } from './wikiMarkdown'
import type { WikiBlock } from '@/types/wiki'

describe('blocksToMarkdown', () => {
  test('keeps markdown blocks verbatim and joins with blank lines', async () => {
    const blocks: WikiBlock[] = [
      { id: 'b1', type: 'markdown', content: '# Hello' },
      { id: 'b2', type: 'markdown', content: 'World' },
    ]
    const md = await blocksToMarkdown(blocks)
    expect(md).toBe('# Hello\n\nWorld')
  })

  test('converts html blocks to markdown', async () => {
    const blocks: WikiBlock[] = [
      { id: 'b1', type: 'html', content: '<h2>Title</h2>' },
      { id: 'b2', type: 'html', content: '<p><strong>bold</strong> text</p>' },
    ]
    const md = await blocksToMarkdown(blocks)
    expect(md).toContain('## Title')
    expect(md).toContain('**bold** text')
  })

  test('prepends the title as an H1 when given', async () => {
    const blocks: WikiBlock[] = [{ id: 'b1', type: 'markdown', content: 'Body' }]
    const md = await blocksToMarkdown(blocks, 'My Page')
    expect(md).toBe('# My Page\n\nBody')
  })

  test('drops empty blocks', async () => {
    const blocks: WikiBlock[] = [
      { id: 'b1', type: 'markdown', content: '  ' },
      { id: 'b2', type: 'html', content: '<p></p>' },
      { id: 'b3', type: 'markdown', content: 'Kept' },
    ]
    const md = await blocksToMarkdown(blocks)
    expect(md).toBe('Kept')
  })
})
