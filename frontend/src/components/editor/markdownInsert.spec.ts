import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { WikiImage } from './wikiImage'
import { WikiLink } from './wikiLink'
import { renderMarkdown } from '@/utils/markdown'
import { prepareHtmlForEditor } from '@/utils/wikiBlocks'

/**
 * A markdown paste / "insert markdown" goes through `insertContent`, which
 * rejects the WHOLE insert when a single list item breaks the schema
 * (`paragraph block*`). These are the markdown shapes that used to make a
 * paste insert nothing at all.
 */
const extensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  WikiImage,
  WikiLink,
]

const insert = (markdown: string): string => {
  const editor = new Editor({ extensions, content: '<p></p>' })
  editor
    .chain()
    .insertContent(prepareHtmlForEditor(renderMarkdown(markdown)))
    .run()
  const html = editor.getHTML()
  editor.destroy()
  return html
}

describe('markdown insert with awkward list items', () => {
  test.each([
    ['empty item', '- \n- second', 'second'],
    [
      'item starting with an image',
      '- ![x](https://a.test/b.png)\n- after',
      'after',
    ],
    ['item starting with a heading', '- # Title\n- after', 'Title'],
    ['item starting with code', '- ```\n  code\n  ```\n- after', 'code'],
    ['item starting with a nested list', '-\n  - nested\n- after', 'nested'],
  ])('%s is inserted', (_name, markdown, expected) => {
    const html = insert(markdown)
    expect(html).toContain('<li><p></p>')
    expect(html).toContain(expected)
  })

  test('ordinary items are left as they are', () => {
    expect(insert('- a\n- b')).toContain(
      '<ul><li><p>a</p></li><li><p>b</p></li></ul>',
    )
  })
})
