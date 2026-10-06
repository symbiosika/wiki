/**
 * The wiki's table cells: TipTap's own, minus the attributes nobody wrote.
 *
 * `tableCell` and `tableHeader` declare `colspan` and `rowspan` with a default
 * of 1 and no `renderHTML`, so TipTap serialises them on every cell —
 * `<td colspan="1" rowspan="1">` for a cell that spans nothing. On a page of
 * spreadsheets that is the single largest thing in the saved html: 35.000 cells
 * carry 35.000 copies of an attribute pair that only means "no span".
 *
 * The size matters beyond the row in the database. A page's blocks travel with
 * every save, every history version, every API read and every AI client that
 * asks for the page, and the block html is also what the backend runs through
 * Turndown to materialize the page text that search and the embeddings read.
 * Nothing in that chain has any use for `colspan="1"`.
 *
 * So both attributes are overridden to render only when they actually span
 * something. Parsing is untouched (the parent's `parseHTML` keeps reading the
 * spans of pasted or imported tables), and a cell with a real span still
 * serialises it — `prosemirror-tables` applies the same rule when it writes a
 * table itself, so this only aligns TipTap's serialisation with it.
 */
import { TableCell, TableHeader } from '@tiptap/extension-table'

/**
 * A span attribute that renders only when it spans more than one cell.
 *
 * The full replacement for the parent's declaration, which is `default: 1` and
 * nothing else: the default stays 1, parsing still comes from the node's own
 * `parseHTML`, and `null`/`undefined` count as 1 — a cell without the
 * attribute spans one.
 */
const spanAttribute = (name: 'colspan' | 'rowspan') => ({
  default: 1,
  renderHTML: (attributes: Record<string, unknown>) => {
    const value = Number(attributes[name] ?? 1)
    return Number.isFinite(value) && value > 1 ? { [name]: value } : {}
  },
})

const spanAttributes = () => ({
  colspan: spanAttribute('colspan'),
  rowspan: spanAttribute('rowspan'),
})

export const WikiTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spanAttributes() }
  },
})

export const WikiTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spanAttributes() }
  },
})
