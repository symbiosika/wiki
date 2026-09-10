import { describe, expect, test } from 'vitest'
import { Editor, generateJSON, type JSONContent } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import Text from '@tiptap/extension-text'
import UniqueID from '@tiptap/extension-unique-id'
import {
  BLOCK_ID_ATTRIBUTE,
  BLOCK_ID_TYPES,
  assignMissingBlockIds,
  newBlockId,
} from './blockIds'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The same UniqueID setup BlockEditor uses, on a minimal schema. */
const extensions = [
  Document,
  Paragraph,
  Heading,
  Text,
  UniqueID.configure({
    attributeName: BLOCK_ID_ATTRIBUTE,
    types: [...BLOCK_ID_TYPES],
  }),
]

/** A document of `n` paragraphs where only the first carries an id. */
const html = (n: number) =>
  '<h1 data-block-id="b1">Title</h1>' +
  Array.from({ length: n }, (_, i) => `<p>Paragraph ${i}</p>`).join('')

describe('newBlockId', () => {
  test('produces v4 UUIDs, distinct per call', () => {
    const a = newBlockId()
    const b = newBlockId()
    expect(a).toMatch(UUID)
    expect(b).toMatch(UUID)
    expect(a).not.toBe(b)
  })
})

describe('assignMissingBlockIds', () => {
  test('fills every block-id node lacking an id and keeps existing ones', () => {
    const json = generateJSON(html(3), extensions)
    const assigned = assignMissingBlockIds(json)
    expect(assigned).toBe(3)
    const heading = json.content[0]
    expect(heading.attrs[BLOCK_ID_ATTRIBUTE]).toBe('b1')
    for (const paragraph of json.content.slice(1)) {
      expect(paragraph.attrs[BLOCK_ID_ATTRIBUTE]).toMatch(UUID)
    }
    // a second pass has nothing left to do
    expect(assignMissingBlockIds(json)).toBe(0)
  })

  test('reaches nested nodes and leaves other types alone', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
          ],
        },
      ],
    }
    expect(assignMissingBlockIds(json)).toBe(2)
    const quote = json.content![0]!
    expect(quote.attrs?.[BLOCK_ID_ATTRIBUTE]).toMatch(UUID)
    expect(quote.content![0]!.attrs?.[BLOCK_ID_ATTRIBUTE]).toMatch(UUID)
    expect(quote.content![0]!.content![0]!.attrs).toBeUndefined()
  })
})

/** TipTap emits `create` from a setTimeout; UniqueID's id pass runs on it. */
const afterCreate = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('editor created from pre-assigned content', () => {
  test('UniqueID has nothing to do on create: no transaction, every node has an id', async () => {
    const json = generateJSON(html(50), extensions)
    assignMissingBlockIds(json)
    let updates = 0
    const editor = new Editor({
      extensions,
      content: json,
      onUpdate: () => updates++,
    })
    await afterCreate()
    expect(updates).toBe(0)
    const missing: string[] = []
    editor.state.doc.descendants((node) => {
      if (
        (BLOCK_ID_TYPES as readonly string[]).includes(node.type.name) &&
        !node.attrs[BLOCK_ID_ATTRIBUTE]
      ) {
        missing.push(node.type.name)
      }
    })
    expect(missing).toEqual([])
    // and the ids survive into the html the save path serialises
    expect(editor.getHTML().match(/data-block-id="/g)?.length).toBe(51)
    editor.destroy()
  })

  test('without pre-assignment UniqueID dispatches an id transaction on create (the cost this avoids)', async () => {
    let updates = 0
    const editor = new Editor({
      extensions,
      content: html(50),
      onUpdate: () => updates++,
    })
    await afterCreate()
    expect(updates).toBe(1)
    editor.destroy()
  })
})
