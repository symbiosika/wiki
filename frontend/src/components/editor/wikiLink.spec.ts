import { describe, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Code from '@tiptap/extension-code'
import { WikiLink, wikiLinkMarker } from './wikiLink'

/** Minimal editor with the Code mark present, to exercise WikiLink. */
const makeEditor = (content: string) =>
  new Editor({
    extensions: [Document, Paragraph, Text, Code, WikiLink],
    content,
  })

describe('wikiLinkMarker', () => {
  test('builds plain and aliased markers', () => {
    expect(wikiLinkMarker('Vacation Policy')).toBe('[[Vacation Policy]]')
    expect(wikiLinkMarker('Home Office', 'wfh')).toBe('[[Home Office|wfh]]')
  })
})

describe('WikiLink node', () => {
  test('insertWikiLink serializes to a <code> carrying the [[Title]] marker', () => {
    const editor = makeEditor('<p></p>')
    editor.commands.insertWikiLink({ target: 'Vacation Policy', pageId: 'p1' })
    const html = editor.getHTML()
    // the literal marker (inside <code>) is what the backend extracts the link from
    expect(html).toContain('[[Vacation Policy]]')
    expect(html).toContain('data-wiki-link="Vacation Policy"')
    expect(html).toContain('data-page-id="p1"')
    expect(html).toMatch(/<code[^>]*>\[\[Vacation Policy\]\]<\/code>/)
    editor.destroy()
  })

  test('round-trips from stored HTML back into a wikiLink node', () => {
    const editor = makeEditor(
      '<p>See <code data-wiki-link="Onboarding" data-page-id="p2">[[Onboarding]]</code> now</p>',
    )
    const html = editor.getHTML()
    expect(html).toContain('data-wiki-link="Onboarding"')
    expect(html).toContain('data-page-id="p2"')
    expect(html).toContain('[[Onboarding]]')
    editor.destroy()
  })

  test('preserves an alias marker', () => {
    const editor = makeEditor('<p></p>')
    editor.commands.insertWikiLink({
      target: 'Home Office',
      alias: 'working from home',
      pageId: null,
    })
    const html = editor.getHTML()
    expect(html).toContain('[[Home Office|working from home]]')
    expect(html).toContain('data-wiki-alias="working from home"')
    // phantom link (no page yet) omits the id attribute
    expect(html).not.toContain('data-page-id')
    editor.destroy()
  })

  test('does not hijack a plain <code> (Code mark still works)', () => {
    const editor = makeEditor(
      '<p><code>plain</code> and <code data-wiki-link="X">[[X]]</code></p>',
    )
    const html = editor.getHTML()
    // ordinary inline code is untouched...
    expect(html).toContain('<code>plain</code>')
    // ...while the wikilink code became the node
    expect(html).toContain('data-wiki-link="X"')
    editor.destroy()
  })

  test('the materialized marker matches the framework extraction regex', () => {
    const editor = makeEditor('<p></p>')
    editor.commands.insertWikiLink({ target: 'Team Handbook', pageId: 'p3' })
    // mirrors WIKILINK_PATTERN in the framework's knowledge-text-links.ts
    const re = /\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g
    const targets = [...editor.getHTML().matchAll(re)].map((m) => m[1])
    expect(targets).toContain('Team Handbook')
    editor.destroy()
  })
})
