import { describe, it, expect } from 'vitest'
import {
  toCsv,
  toMarkdownBlocks,
  escapeCsvCell,
  csvFileName,
  CSV_BOM,
} from './collectionExport'
import type { CollectionField, CollectionRecord } from './collections'

const field = (
  over: Partial<CollectionField> & { type: CollectionField['type']; key: string },
) =>
  ({
    id: over.key,
    collectionId: 'c',
    label: over.label ?? over.key,
    options: {},
    required: false,
    position: 0,
    hidden: false,
    ...over,
  }) as CollectionField

const record = (data: Record<string, unknown>) =>
  ({ id: 'r', collectionId: 'c', data, position: 0, createdAt: '', updatedAt: '' }) as CollectionRecord

const fields = [
  field({ key: 'name', label: 'Name', type: 'text' }),
  field({ key: 'beitrag', label: 'Beitrag', type: 'number', options: { precision: 2, suffix: 'EUR' } }),
  field({ key: 'aktiv', label: 'Aktiv', type: 'checkbox' }),
  field({ key: 'notiz', label: 'Notiz', type: 'longText' }),
]

describe('escapeCsvCell', () => {
  it('leaves a plain value alone', () => {
    expect(escapeCsvCell('Anna')).toBe('Anna')
  })

  it('quotes a value containing the semicolon delimiter', () => {
    expect(escapeCsvCell('a;b')).toBe('"a;b"')
  })

  it('doubles embedded quotes', () => {
    expect(escapeCsvCell('sagt "hallo"')).toBe('"sagt ""hallo"""')
  })

  it('quotes a value with a line break, so a row cannot split', () => {
    expect(escapeCsvCell('zwei\nZeilen')).toBe('"zwei\nZeilen"')
  })
})

describe('toCsv', () => {
  it('writes a header of labels and one row per record', () => {
    const csv = toCsv(fields, [record({ name: 'Anna', beitrag: 120, aktiv: true })], 'de')
    const lines = csv.replace(CSV_BOM, '').trim().split('\r\n')
    expect(lines[0]).toBe('Name;Beitrag;Aktiv;Notiz')
    expect(lines[1]).toBe('Anna;120,00 EUR;✓;')
  })

  it('starts with a BOM so Excel reads umlauts correctly', () => {
    expect(toCsv(fields, [record({ name: 'Müller' })]).startsWith(CSV_BOM)).toBe(true)
  })

  it('quotes a value that would otherwise break the row', () => {
    const csv = toCsv(
      [field({ key: 'notiz', label: 'Notiz', type: 'text' })],
      [record({ notiz: 'a;b' })],
    )
    expect(csv).toContain('"a;b"')
  })

  it('exports exactly the records it is given — a filtered set stays filtered', () => {
    const csv = toCsv(fields, [record({ name: 'Anna' })], 'de')
    expect(csv).toContain('Anna')
    expect(csv.replace(CSV_BOM, '').trim().split('\r\n')).toHaveLength(2)
  })

  it('writes only the header when there are no records', () => {
    expect(toCsv(fields, []).replace(CSV_BOM, '').trim()).toBe('Name;Beitrag;Aktiv;Notiz')
  })
})

describe('toMarkdownBlocks', () => {
  it('puts the table name in a heading and one labelled block per record', () => {
    const md = toMarkdownBlocks(
      'Mitglieder',
      fields,
      [
        record({ name: 'Anna', beitrag: 120, aktiv: true }),
        record({ name: 'Bert', beitrag: 60, aktiv: false }),
      ],
      'de',
    )
    expect(md).toContain('## Mitglieder')
    expect(md).toContain('Name: Anna')
    expect(md).toContain('Beitrag: 120,00 EUR')
    // blocks are separated by a blank line
    expect(md).toContain('Name: Anna')
    expect(md.split('\n\n').length).toBeGreaterThanOrEqual(3)
  })

  it('omits empty values instead of printing blank pairs', () => {
    const md = toMarkdownBlocks('T', fields, [record({ name: 'Anna' })], 'de')
    expect(md).toContain('Name: Anna')
    expect(md).not.toContain('Notiz:')
    // an unchecked checkbox renders empty and is dropped too
    expect(md).not.toContain('Aktiv:')
  })

  it('works without a table name', () => {
    const md = toMarkdownBlocks('  ', fields, [record({ name: 'Anna' })])
    expect(md.startsWith('##')).toBe(false)
    expect(md).toContain('Name: Anna')
  })

  it('says so when the selection is empty', () => {
    expect(toMarkdownBlocks('T', fields, [])).toContain('keine Einträge')
  })
})

describe('csvFileName', () => {
  it('builds a dated, filesystem-safe name', () => {
    expect(csvFileName('Aktive Mitglieder 2026', new Date('2026-08-30T10:00:00Z')))
      .toBe('Aktive-Mitglieder-2026-2026-08-30.csv')
  })

  it('keeps umlauts but drops punctuation', () => {
    expect(csvFileName('Größen / Preise', new Date('2026-01-02T00:00:00Z')))
      .toBe('Größen-Preise-2026-01-02.csv')
  })

  it('falls back when the name has nothing usable', () => {
    expect(csvFileName('///', new Date('2026-01-02T00:00:00Z'))).toBe('tabelle-2026-01-02.csv')
  })
})
