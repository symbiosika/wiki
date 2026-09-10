/**
 * Block ids for the editor document, assigned BEFORE the editor is created.
 *
 * Every block-level node in the editor carries a `block-id` attribute
 * (rendered as `data-block-id`), maintained by TipTap's UniqueID extension. It
 * is what keeps block identities stable across saves (see utils/wikiBlocks),
 * what the table of contents and deep links scroll to, and what the backend
 * sync diffs against.
 *
 * UniqueID fills in missing ids itself when the editor is created — but it does
 * so with one `setNodeMarkup` step per node in a single transaction, and the
 * work TipTap then does on that transaction (combining the steps, computing the
 * changed ranges) grows with the square of the step count. A page loaded from
 * markdown blocks has an id on the first element of each block only, so on a
 * long imported page thousands of nodes are missing one, and that single
 * transaction blocks the main thread for ten seconds and more. Measured on a
 * 4k-line page with ~250 images: 17 s until the editor appeared, all of it in
 * that one transaction. And since the transaction is not a save, a page opened
 * read-only pays it again on every open.
 *
 * So the ids are assigned here, on the parsed document JSON, before the editor
 * ever sees it: a linear walk, no transaction, nothing for UniqueID to do on
 * create. The result is identical to what UniqueID would have produced — same
 * attribute, same id shape — so saving, the ToC and deep links are unaffected.
 * UniqueID stays in the extension list for everything that happens after load
 * (new paragraphs, pasted content, split blocks), where its per-change work is
 * proportional to the change.
 */
import type { JSONContent } from '@tiptap/core'

/** UniqueID's `attributeName`: the attribute is `block-id`, the DOM `data-block-id`. */
export const BLOCK_ID_ATTRIBUTE = 'block-id'

/**
 * The node types that carry a block id. Shared with the UniqueID configuration
 * in BlockEditor so the two can never disagree about which nodes need one.
 */
export const BLOCK_ID_TYPES = [
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
] as const

/**
 * A fresh block id: a v4 UUID, the same shape UniqueID generates, so ids from
 * either source are indistinguishable downstream.
 */
export const newBlockId = (): string => {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Not a secure context (randomUUID is unavailable there): build the UUID
  // from random bytes instead.
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Give every node of a block-id type that has no id one, in place, and return
 * how many were assigned. Ids already present are kept — those are the stable
 * ones the backend knows.
 */
export const assignMissingBlockIds = (
  content: JSONContent,
  types: readonly string[] = BLOCK_ID_TYPES,
): number => {
  let assigned = 0
  const visit = (node: JSONContent) => {
    if (node.type && types.includes(node.type)) {
      const attrs = node.attrs ?? {}
      if (
        attrs[BLOCK_ID_ATTRIBUTE] === null ||
        attrs[BLOCK_ID_ATTRIBUTE] === undefined
      ) {
        node.attrs = { ...attrs, [BLOCK_ID_ATTRIBUTE]: newBlockId() }
        assigned++
      }
    }
    node.content?.forEach(visit)
  }
  visit(content)
  return assigned
}
