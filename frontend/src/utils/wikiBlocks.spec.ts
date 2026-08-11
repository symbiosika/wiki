import { describe, expect, test } from 'vitest'
import {
  blocksAreEqual,
  blocksToEditorHtml,
  editorHtmlToBlocks,
} from './wikiBlocks'
import type { WikiBlock } from '@/types/wiki'

describe('blocksToEditorHtml', () => {
  test('renders markdown blocks to html with the block id attached', () => {
    const blocks: WikiBlock[] = [
      { id: 'b1', type: 'markdown', content: '# Hello' },
    ]
    const html = blocksToEditorHtml(blocks)
    expect(html).toContain('<h1')
    expect(html).toContain('data-block-id="b1"')
    expect(html).toContain('Hello')
  })

  test('passes html blocks through and tags the first element', () => {
    const blocks: WikiBlock[] = [
      { id: 'b1', type: 'html', content: '<p>One</p>' },
      {
        id: 'b2',
        type: 'html',
        content: '<blockquote><p>Two</p></blockquote>',
      },
    ]
    const html = blocksToEditorHtml(blocks)
    expect(html).toContain('<p data-block-id="b1">One</p>')
    expect(html).toContain('<blockquote data-block-id="b2">')
  })

  test('a markdown block with several paragraphs keeps its id on the first', () => {
    const blocks: WikiBlock[] = [
      { id: 'b1', type: 'markdown', content: 'One\n\nTwo' },
    ]
    const html = blocksToEditorHtml(blocks)
    const ids = html.match(/data-block-id/g) ?? []
    expect(ids.length).toBe(1)
    expect(html).toContain('Two')
  })

  test('skips blocks without renderable content and handles empty input', () => {
    expect(blocksToEditorHtml([])).toBe('')
    expect(blocksToEditorHtml([{ id: 'b1', type: 'html', content: '' }])).toBe(
      '',
    )
  })
})

describe('editorHtmlToBlocks', () => {
  test('splits top level elements into html blocks with their ids', () => {
    const html = '<h1 data-block-id="a">Title</h1><p data-block-id="b">Body</p>'
    const blocks = editorHtmlToBlocks(html)
    expect(blocks).toEqual([
      { id: 'a', type: 'html', content: '<h1>Title</h1>' },
      { id: 'b', type: 'html', content: '<p>Body</p>' },
    ])
  })

  test('elements without an id become new blocks (id undefined)', () => {
    const blocks = editorHtmlToBlocks('<p>New</p>')
    expect(blocks.length).toBe(1)
    expect(blocks[0]?.id).toBeUndefined()
    expect(blocks[0]?.content).toBe('<p>New</p>')
  })

  test('duplicate ids (copy & paste) are only kept once', () => {
    const html = '<p data-block-id="dup">One</p><p data-block-id="dup">Two</p>'
    const blocks = editorHtmlToBlocks(html)
    expect(blocks[0]?.id).toBe('dup')
    expect(blocks[1]?.id).toBeUndefined()
  })

  test('preserves image size/alignment attributes through the round-trip', () => {
    const html =
      '<img data-block-id="img1" src="/api/v1/tenant/t/files/db/wiki/x.png" alt="x" data-size="lg" data-align="center">'
    const blocks = editorHtmlToBlocks(html)
    expect(blocks[0]?.id).toBe('img1')
    expect(blocks[0]?.content).toContain('data-size="lg"')
    expect(blocks[0]?.content).toContain('data-align="center"')
    // and back into the editor without losing them
    expect(blocksToEditorHtml(blocks)).toContain('data-size="lg"')
  })

  test('keeps inline marks inside the block content', () => {
    const html = '<p data-block-id="a">Hi <strong>bold</strong></p>'
    const blocks = editorHtmlToBlocks(html)
    expect(blocks[0]?.content).toBe('<p>Hi <strong>bold</strong></p>')
  })

  test('roundtrip: html blocks survive load + save unchanged', () => {
    const original: WikiBlock[] = [
      { id: 'a', type: 'html', content: '<h2>Section</h2>' },
      { id: 'b', type: 'html', content: '<p>Text with <em>italic</em></p>' },
    ]
    const roundtripped = editorHtmlToBlocks(blocksToEditorHtml(original))
    expect(roundtripped).toEqual(original)
  })
})

describe('page references in loaded blocks', () => {
  test('a markdown block written by an agent becomes a real reference', () => {
    const html = blocksToEditorHtml([
      { id: 'b1', type: 'markdown', content: 'Siehe [[03.03 Errichter]].' },
    ])
    expect(html).toContain('data-wiki-link="03.03 Errichter"')
  })

  test('saving it back stores the canonical form (no bare marker text)', () => {
    const blocks = editorHtmlToBlocks(
      blocksToEditorHtml([
        { id: 'b1', type: 'html', content: '<p>Siehe [[Onboarding]].</p>' },
      ]),
    )
    expect(blocks[0]!.content).toContain('data-wiki-link="Onboarding"')
  })
})

describe('blocksAreEqual', () => {
  const a: WikiBlock[] = [{ id: '1', type: 'html', content: '<p>x</p>' }]

  test('equal lists', () => {
    expect(
      blocksAreEqual(a, [{ id: '1', type: 'html', content: '<p>x</p>' }]),
    ).toBe(true)
  })

  test('different content', () => {
    expect(
      blocksAreEqual(a, [{ id: '1', type: 'html', content: '<p>y</p>' }]),
    ).toBe(false)
  })

  test('different length', () => {
    expect(blocksAreEqual(a, [])).toBe(false)
  })
})

describe('blocksToEditorHtml — markdown task lists', () => {
  test('a markdown task list becomes a real checklist for the editor', () => {
    // Without the rewrite the editor schema has no node for a bare checkbox,
    // drops it, and the checklist degrades to a plain bullet list on the next
    // save — losing which items were done.
    const html = blocksToEditorHtml([
      { id: 'b1', type: 'markdown', content: '- [ ] offen\n- [x] erledigt' },
    ])

    expect(html).toContain('data-type="taskList"')
    expect(html).toContain('data-type="taskItem"')
    expect(html).toContain('data-checked="false"')
    expect(html).toContain('data-checked="true"')
    // no bare checkbox is left for the editor to drop
    expect(html).not.toContain('<input')
    // TaskItem's content is `paragraph+`
    expect(html).toContain('<p>')
  })

  test('a plain bullet list is left alone', () => {
    const html = blocksToEditorHtml([
      { id: 'b1', type: 'markdown', content: '- eins\n- zwei' },
    ])

    expect(html).not.toContain('data-type="taskList"')
    expect(html).toContain('<li>eins</li>')
  })

  test('a list with only some checkboxes is not a task list', () => {
    const html = blocksToEditorHtml([
      { id: 'b1', type: 'markdown', content: '- [ ] offen\n- kein Kästchen' },
    ])

    expect(html).not.toContain('data-type="taskList"')
  })

  test('nested task items keep their own state', () => {
    const html = blocksToEditorHtml([
      { id: 'b1', type: 'markdown', content: '- [ ] oben\n    - [x] unten' },
    ])

    expect(html).toContain('data-checked="false"')
    expect(html).toContain('data-checked="true"')
    expect(html).not.toContain('<input')
  })
})
