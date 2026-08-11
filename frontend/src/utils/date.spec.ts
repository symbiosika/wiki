import { describe, it, expect } from 'vitest'
import {
  parseServerDate,
  formatDateTime,
  formatRelativeIntl,
  formatExactDateTime,
} from './date'

describe('parseServerDate', () => {
  it('treats a naive (timezone-less) timestamp as UTC', () => {
    // Backend serialises `timestamp without time zone` (UTC) as a naive string.
    const d = parseServerDate('2026-07-22 17:20:07.123456')
    expect(d?.toISOString()).toBe('2026-07-22T17:20:07.123Z')
  })

  it('treats a naive ISO timestamp (T separator, no Z) as UTC', () => {
    const d = parseServerDate('2026-07-22T17:20:07')
    expect(d?.toISOString()).toBe('2026-07-22T17:20:07.000Z')
  })

  it('respects an explicit Z designator', () => {
    const d = parseServerDate('2026-07-22T17:20:07Z')
    expect(d?.toISOString()).toBe('2026-07-22T17:20:07.000Z')
  })

  it('respects an explicit numeric offset', () => {
    const d = parseServerDate('2026-07-22T19:20:07+02:00')
    expect(d?.toISOString()).toBe('2026-07-22T17:20:07.000Z')
  })

  it('passes Date and number inputs through', () => {
    const now = new Date('2026-07-22T17:20:07Z')
    expect(parseServerDate(now)).toBe(now)
    expect(parseServerDate(now.getTime())?.toISOString()).toBe(
      '2026-07-22T17:20:07.000Z',
    )
  })

  it('returns null for empty / invalid input', () => {
    expect(parseServerDate(null)).toBeNull()
    expect(parseServerDate(undefined)).toBeNull()
    expect(parseServerDate('')).toBeNull()
    expect(parseServerDate('not a date')).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('converts a naive UTC timestamp to the local timezone', () => {
    // Compare against the same instant explicitly marked as UTC: a naive value
    // must format identically once it is understood to be UTC.
    const naive = formatDateTime('2026-07-22 17:20:07', undefined, 'de-DE')
    const zoned = formatDateTime('2026-07-22T17:20:07Z', undefined, 'de-DE')
    expect(naive).toBe(zoned)
  })

  it('returns a placeholder for missing values', () => {
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime('')).toBe('-')
  })
})

describe('formatRelativeIntl', () => {
  it('describes a recent timestamp in the given locale', () => {
    const minutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    expect(formatRelativeIntl(minutesAgo, 'de')).toContain('Minuten')
    expect(formatRelativeIntl(minutesAgo, 'en')).toContain('minutes')
  })

  it('scales up through the units', () => {
    const daysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    expect(formatRelativeIntl(daysAgo, 'en')).toBe('3 days ago')
  })

  it('reads a naive server timestamp as UTC', () => {
    const naive = new Date(Date.now() - 2 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '')
    expect(formatRelativeIntl(naive, 'en')).toBe('2 hours ago')
  })

  it('returns an em dash for missing values', () => {
    expect(formatRelativeIntl(null, 'en')).toBe('—')
    expect(formatRelativeIntl('nonsense', 'en')).toBe('—')
  })
})

describe('formatExactDateTime', () => {
  it('formats date and time in the given locale', () => {
    expect(formatExactDateTime('2026-07-22T17:20:07Z', 'de')).toBe(
      new Date('2026-07-22T17:20:07Z').toLocaleString('de', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    )
  })

  it('returns an em dash for missing values', () => {
    expect(formatExactDateTime(null, 'en')).toBe('—')
  })
})
