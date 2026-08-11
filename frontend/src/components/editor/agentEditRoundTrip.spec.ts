import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import UniqueID from '@tiptap/extension-unique-id'
import { WikiLink } from './wikiLink'
import { WikiImage } from './wikiImage'
import { blocksToEditorHtml, editorHtmlToBlocks } from '@/utils/wikiBlocks'
import { agentEditCases } from './agentEditFixture'
import type { WikiBlock } from '@/types/wiki'

/**
 * Editor half of the agent-edit contract (see `agentEditFixture.ts` for the
 * whole picture and the backend half).
 *
 * An agent edit may leave a block stored as a MARKDOWN block where the editor
 * had written html — that is how the backend applies a replacement the stored
 * html cannot carry. What makes that safe is that markdown blocks are transient
 * in the human workflow: the editor renders them and normalizes everything back
 * to html on the next save. Here that claim runs against the real editor, with
 * the extension set from BlockEditor.vue, and pins the html the save produces.
 */
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  WikiImage,
  WikiLink,
  UniqueID.configure({
    attributeName: 'block-id',
    types: [
      'paragraph',
      'heading',
      'blockquote',
      'codeBlock',
      'bulletList',
      'orderedList',
      'taskList',
      'horizontalRule',
      'image',
      'table',
    ],
  }),
]

/** One editor open-and-save cycle over the given blocks. */
const openAndSave = (blocks: WikiBlock[]): WikiBlock[] => {
  const editor = new Editor({ extensions, content: blocksToEditorHtml(blocks) })
  const html = editor.getHTML()
  editor.destroy()
  return editorHtmlToBlocks(html)
}

const asMarkdownBlock = (content: string): WikiBlock[] => [
  { id: 'b1', type: 'markdown', content },
]

describe('agent edit survives the web editor', () => {
  test.each(agentEditCases)('$name saves as the html the fixture pins', (testCase) => {
    const saved = openAndSave(asMarkdownBlock(testCase.edited))

    // If this fails, TipTap's output changed: put the new html into the fixture
    // so the backend half is re-checked against it.
    expect(saved.map((block) => block.content)).toEqual(testCase.savedByEditor)
    // everything comes back as html — no markdown block survives a save
    expect(saved.every((block) => block.type === 'html')).toBe(true)
  })

  test.each(agentEditCases)('$name is a fixpoint after one cycle', (testCase) => {
    const once = openAndSave(asMarkdownBlock(testCase.edited))
    const twice = openAndSave(once)

    // repeated opening and saving must not keep rewriting the page
    expect(twice.map((b) => b.content)).toEqual(once.map((b) => b.content))
  })

  test('the first block keeps its id, split-off blocks are inserts', () => {
    const saved = openAndSave(asMarkdownBlock('Erster Absatz.\n\nZweiter Absatz.'))

    expect(saved[0]!.id).toBe('b1')
    expect(saved[1]!.id).toBeUndefined()
  })

  test('page references become real reference nodes, not literal markers', () => {
    const saved = openAndSave(asMarkdownBlock('Siehe [[04 Historie]] dazu.'))

    expect(saved[0]!.content).toContain('data-wiki-link="04 Historie"')
  })

  test('a save drops markup the editor schema does not know — from every block', () => {
    // Worth knowing when judging what an agent edit can cost: markup the
    // schema has no node or mark for does not survive a save ANYWHERE, not
    // just in the block an edit reached into. StarterKit carries no highlight,
    // so <mark> is gone from the untouched block too. Nothing to do with agent
    // edits — but it means "the agent edit flattened my formatting" is rarely
    // the whole story: opening and saving the page would have done the same.
    const saved = openAndSave([
      { id: 'b1', type: 'markdown', content: 'Der **Preis** ist neu.' },
      { id: 'b2', type: 'html', content: '<p>Unberührt <mark>bunt</mark></p>' },
    ])

    expect(saved[0]!.content).toBe('<p>Der <strong>Preis</strong> ist neu.</p>')
    expect(saved[1]!.content).toBe('<p>Unberührt bunt</p>')
  })
})
