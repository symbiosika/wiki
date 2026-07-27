import { describe, it, expect, beforeEach } from 'vitest'
import { applyBrandColor, deriveAccents } from './brand'

/** Relative luminance, mirroring the WCAG formula used in brand.ts. */
const luminance = (hex: string): number => {
  const int = parseInt(hex.replace('#', ''), 16)
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel((int >> 16) & 255) +
    0.7152 * channel((int >> 8) & 255) +
    0.0722 * channel(int & 255)
  )
}

describe('deriveAccents', () => {
  it('returns null for anything that is not a six-digit hex', () => {
    expect(deriveAccents(null)).toBeNull()
    expect(deriveAccents(undefined)).toBeNull()
    expect(deriveAccents('')).toBeNull()
    expect(deriveAccents('blue')).toBeNull()
    expect(deriveAccents('#abc')).toBeNull()
    expect(deriveAccents('#12345g')).toBeNull()
  })

  it('accepts a hex with or without the leading hash', () => {
    expect(deriveAccents('#336699')).toEqual(deriveAccents('336699'))
  })

  it('keeps a mid-tone colour as it is', () => {
    // luminance ~0.28: readable on white and on the dark page already, so
    // neither variant needs correcting
    const accents = deriveAccents('#5b8def')!
    expect(accents.light).toBe('#5b8def')
    expect(accents.dark).toBe('#5b8def')
  })

  it('lifts a saturated but dark colour off the dark page', () => {
    // ~0.15 luminance against a near-black background is roughly 2.6:1 — a
    // plausible-looking brand blue that still has to be lightened
    const accents = deriveAccents('#3366cc')!
    expect(accents.light).toBe('#3366cc')
    expect(luminance(accents.dark)).toBeGreaterThan(luminance('#3366cc'))
  })

  it('darkens a very light brand colour for the light appearance', () => {
    // a pale yellow is invisible on white; the light variant must come down
    const accents = deriveAccents('#ffee55')!
    expect(luminance(accents.light)).toBeLessThan(luminance('#ffee55'))
  })

  it('lightens a very dark brand colour for the dark appearance', () => {
    // near-black on a near-black page — the dark variant must come up
    const accents = deriveAccents('#101820')!
    expect(luminance(accents.dark)).toBeGreaterThan(luminance('#101820'))
  })

  it('produces valid hex in both variants', () => {
    for (const input of ['#000000', '#ffffff', '#ff0000', '#0a0a0a', '#f5f5f5']) {
      const accents = deriveAccents(input)!
      expect(accents.light).toMatch(/^#[0-9a-f]{6}$/)
      expect(accents.dark).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('moves pure white and pure black off the page background', () => {
    expect(luminance(deriveAccents('#ffffff')!.light)).toBeLessThan(luminance('#ffffff'))
    expect(luminance(deriveAccents('#000000')!.dark)).toBeGreaterThan(0)
  })
})

describe('applyBrandColor', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--brand-accent-light')
    document.documentElement.style.removeProperty('--brand-accent-dark')
  })

  const read = (name: string) =>
    document.documentElement.style.getPropertyValue(name)

  it('sets one custom property per appearance', () => {
    applyBrandColor('#5b8def')
    expect(read('--brand-accent-light')).toBe('#5b8def')
    expect(read('--brand-accent-dark')).toBe('#5b8def')
  })

  it('clears the properties for an absent colour, falling back to defaults', () => {
    applyBrandColor('#5b8def')
    applyBrandColor(null)
    expect(read('--brand-accent-light')).toBe('')
    expect(read('--brand-accent-dark')).toBe('')
  })

  it('clears rather than applies a malformed colour', () => {
    applyBrandColor('#5b8def')
    applyBrandColor('not-a-colour')
    expect(read('--brand-accent-light')).toBe('')
  })
})
