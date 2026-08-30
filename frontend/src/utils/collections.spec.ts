import { describe, it, expect } from 'vitest'
import {
  displayValue,
  sortValue,
  matchesSearch,
  emptyRecordData,
  recordLabel,
  filterKindFor,
  type CollectionField,
  type CollectionRecord,
} from './collections'

const field = (over: Partial<CollectionField> & { type: CollectionField['type'] }) =>
  ({
    id: 'f',
    collectionId: 'c',
    key: over.key ?? 'k',
    label: over.label ?? 'Feld',
    options: {},
    required: false,
    position: 0,
    hidden: false,
    ...over,
  }) as CollectionField

const record = (data: Record<string, unknown>) =>
  ({ id: 'r', collectionId: 'c', data, position: 0, createdAt: '', updatedAt: '' }) as CollectionRecord

describe('displayValue', () => {
  it('formats numbers with locale, precision and suffix', () => {
    const f = field({ type: 'number', options: { precision: 2, suffix: '€' } })
    expect(displayValue(f, 1234.5, 'de')).toBe('1.234,50 €')
  })

  it('formats dates in the given locale', () => {
    expect(displayValue(field({ type: 'date' }), '2026-03-01', 'de')).toBe('1.3.2026')
  })

  it('leaves an unparseable date as written rather than showing "Invalid Date"', () => {
    expect(displayValue(field({ type: 'date' }), 'irgendwas')).toBe('irgendwas')
  })

  it('joins multiSelect values', () => {
    expect(displayValue(field({ type: 'multiSelect' }), ['a', 'b'])).toBe('a, b')
  })

  it('renders empty values as an empty string, never "null"', () => {
    expect(displayValue(field({ type: 'text' }), null)).toBe('')
    expect(displayValue(field({ type: 'text' }), undefined)).toBe('')
  })
})

describe('sortValue', () => {
  it('sorts numbers numerically, not lexically', () => {
    const f = field({ type: 'number', key: 'n' })
    const values = [record({ n: 10 }), record({ n: 9 }), record({ n: 100 })]
      .map((r) => sortValue(f, r))
      .sort((a, b) => (a as number) - (b as number))
    expect(values).toEqual([9, 10, 100])
  })

  it('puts empty cells last for both text and numbers', () => {
    const num = field({ type: 'number', key: 'n' })
    expect(sortValue(num, record({}))).toBe(Number.POSITIVE_INFINITY)
    const text = field({ type: 'text', key: 't' })
    expect(sortValue(text, record({ t: 'zzz' })) < sortValue(text, record({}))).toBe(true)
  })

  it('is case-insensitive for text', () => {
    const f = field({ type: 'text', key: 't' })
    expect(sortValue(f, record({ t: 'Bert' })) > sortValue(f, record({ t: 'anna' }))).toBe(true)
  })
})

describe('matchesSearch', () => {
  const fields = [
    field({ type: 'text', key: 'name' }),
    field({ type: 'number', key: 'beitrag', options: { suffix: '€' } }),
    field({ type: 'checkbox', key: 'aktiv' }),
  ]

  it('matches the rendered text of any column', () => {
    expect(matchesSearch(fields, record({ name: 'Anna Meier' }), 'meier')).toBe(true)
    expect(matchesSearch(fields, record({ name: 'Anna Meier' }), 'bert')).toBe(false)
  })

  it('searches formatted numbers, so the user can search what they see', () => {
    expect(matchesSearch(fields, record({ beitrag: 1234 }), '1.234')).toBe(true)
  })

  it('an empty term matches everything', () => {
    expect(matchesSearch(fields, record({}), '   ')).toBe(true)
  })
})

describe('emptyRecordData', () => {
  it('gives each type its correct empty state', () => {
    const data = emptyRecordData([
      field({ type: 'text', key: 't' }),
      field({ type: 'checkbox', key: 'c' }),
      field({ type: 'multiSelect', key: 'm' }),
    ])
    expect(data).toEqual({ t: null, c: false, m: [] })
  })
})

describe('recordLabel', () => {
  const fields = [
    field({ type: 'number', key: 'nr' }),
    field({ type: 'text', key: 'name' }),
  ]

  it('prefers the configured title field', () => {
    const label = recordLabel(
      { fields, settings: { titleFieldKey: 'nr' } },
      record({ nr: 7, name: 'Anna' }),
    )
    expect(label).toBe('7')
  })

  it('falls back to the first text column', () => {
    expect(recordLabel({ fields, settings: {} }, record({ nr: 7, name: 'Anna' }))).toBe('Anna')
  })

  it('falls back again when the preferred columns are empty', () => {
    expect(recordLabel({ fields, settings: {} }, record({ nr: 7 }))).toBe('7')
  })

  it('returns the fallback for a wholly empty record', () => {
    expect(recordLabel({ fields, settings: {} }, record({}))).toBe('—')
  })
})

describe('filterKindFor', () => {
  it('maps each column type to a filter UI', () => {
    expect(filterKindFor('number')).toBe('number')
    expect(filterKindFor('checkbox')).toBe('boolean')
    expect(filterKindFor('select')).toBe('choice')
    expect(filterKindFor('multiSelect')).toBe('choice')
    expect(filterKindFor('date')).toBe('date')
    expect(filterKindFor('longText')).toBe('text')
  })
})
