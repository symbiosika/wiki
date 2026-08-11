/**
 * Shared fixture for the two halves of one contract: an agent edit (MCP
 * `edit_page_content`) may leave a block stored as MARKDOWN where the web
 * editor had written html, and that must survive a human opening and saving
 * the page.
 *
 * Proving it needs both runtimes — the real editor (TipTap, browser-ish) and
 * the real materializer (the framework, server) — which cannot be loaded in one
 * process without pulling one app's dependencies into the other. So the proof
 * is split at the seam and this file IS the seam:
 *
 *   - `frontend/src/components/editor/agentEditRoundTrip.spec.ts` asserts that
 *     opening `edited` in the editor and saving it produces exactly
 *     `savedByEditor`
 *   - `backend/src/lib/knowledge/agentEditRoundTrip.test.ts` asserts what
 *     `savedByEditor` then reads as through the framework's materializer
 *
 * Deliberately free of imports so both suites can load it with only their own
 * dependencies installed. If TipTap ever changes its output, the frontend half
 * fails first and names the new html — update it here and the backend half is
 * re-checked against it automatically.
 */

export type AgentEditCase = {
  name: string
  /** the markdown block content an agent edit leaves behind */
  edited: string
  /** the html blocks the editor sends back on the next save */
  savedByEditor: string[]
  /**
   * what the page reads as AFTER that save. Equal to `edited` unless the round
   * trip normalizes something — then this says what it normalizes to, and why.
   */
  readsAsAfterSave: string
}

export const agentEditCases: AgentEditCase[] = [
  {
    name: 'bold inside a paragraph',
    edited: 'Der **Listenpreis** beträgt 12 EUR pro Monat.',
    savedByEditor: ['<p>Der <strong>Listenpreis</strong> beträgt 12 EUR pro Monat.</p>'],
    readsAsAfterSave: 'Der **Listenpreis** beträgt 12 EUR pro Monat.',
  },
  {
    name: 'a heading',
    edited: '## Neue Überschrift',
    savedByEditor: ['<h2>Neue Überschrift</h2>'],
    readsAsAfterSave: '## Neue Überschrift',
  },
  {
    name: 'several paragraphs in one block',
    edited: 'Erster Absatz.\n\nZweiter Absatz.',
    // one markdown block holding two paragraphs becomes two html blocks
    savedByEditor: ['<p>Erster Absatz.</p>', '<p>Zweiter Absatz.</p>'],
    readsAsAfterSave: 'Erster Absatz.\n\nZweiter Absatz.',
  },
  {
    name: 'inline code',
    edited: 'Setze `DEBUG=true` in der Umgebung.',
    savedByEditor: ['<p>Setze <code>DEBUG=true</code> in der Umgebung.</p>'],
    readsAsAfterSave: 'Setze `DEBUG=true` in der Umgebung.',
  },
  {
    name: 'a link',
    edited: 'Siehe [die Doku](https://example.com) dazu.',
    savedByEditor: [
      '<p>Siehe <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">die Doku</a> dazu.</p>',
    ],
    readsAsAfterSave: 'Siehe [die Doku](https://example.com) dazu.',
  },
  {
    name: 'a list with page references',
    edited: 'Siehe auch:\n\n- [[04 Historie]]\n- [[01 Pflegemarkt]]',
    savedByEditor: [
      '<p>Siehe auch:</p>',
      '<ul><li><p><code data-wiki-link="04 Historie" class="wiki-link">[[04 Historie]]</code></p></li>' +
        '<li><p><code data-wiki-link="01 Pflegemarkt" class="wiki-link">[[01 Pflegemarkt]]</code></p></li></ul>',
    ],
    // NORMALIZED: the marker becomes Turndown's `*   `, and because TipTap
    // wraps list item content in <p> the items end up separated by a
    // whitespace line. Cosmetic and stable (it converges after this one
    // cycle), but an agent editing that line later must copy the CURRENT text.
    readsAsAfterSave: 'Siehe auch:\n\n*   [[04 Historie]]\n    \n*   [[01 Pflegemarkt]]',
  },
  {
    name: 'a table',
    edited: '| A | B |\n| --- | --- |\n| 1 | 2 |',
    savedByEditor: [
      '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;">' +
        '<col style="min-width: 25px;"></colgroup><tbody>' +
        '<tr><th colspan="1" rowspan="1"><p>A</p></th><th colspan="1" rowspan="1"><p>B</p></th></tr>' +
        '<tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>2</p></td></tr>' +
        '</tbody></table>',
    ],
    // The editor's own table markup (a <colgroup> for resizing, <p> inside the
    // cells) used to reach the page text as raw html; the materializer now
    // renders any table as GFM, so a table stays a table through the round trip.
    readsAsAfterSave: '| A | B |\n| --- | --- |\n| 1 | 2 |',
  },
  {
    name: 'a checklist',
    edited: '- [ ] offen\n- [x] erledigt',
    savedByEditor: [
      '<ul data-type="taskList">' +
        '<li data-checked="false" data-type="taskItem">' +
        '<label><input type="checkbox"><span></span></label><div><p>offen</p></div></li>' +
        '<li data-checked="true" data-type="taskItem">' +
        '<label><input type="checkbox" checked="checked"><span></span></label>' +
        '<div><p>erledigt</p></div></li>' +
        '</ul>',
    ],
    // NORMALIZED like any other list (Turndown's `*   ` marker), but the checked
    // state survives in both directions: the editor parses the markdown task
    // list into real checklist items, and the materializer writes the boxes back.
    readsAsAfterSave: '*   [ ] offen\n*   [x] erledigt',
  },
]

/** The cases the round trip leaves byte-identical. */
export const losslessCases = agentEditCases.filter((c) => c.edited === c.readsAsAfterSave)
