import { describe, it, expect } from 'vitest'
import {
  cardInitials,
  canvasSizeFor,
  sortCardsByStack,
  nextCardSpot,
  cardLabel,
} from './ideaBoards'

describe('cardInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(cardInitials('bjoern.enders@example.com')).toBe('BE')
  })

  it('falls back to the first two letters of a single word', () => {
    expect(cardInitials('testuser1@symbiosika.com')).toBe('TE')
  })

  it('ignores digits as word characters', () => {
    expect(cardInitials('user1_two@example.com')).toBe('UT')
  })

  it('returns an empty string for a missing or blank label', () => {
    expect(cardInitials(null)).toBe('')
    expect(cardInitials(undefined)).toBe('')
    expect(cardInitials('   ')).toBe('')
  })

  it('returns an empty string when the label has no letters at all', () => {
    expect(cardInitials('123@456.com')).toBe('')
  })

  it('handles a label without an @ part', () => {
    expect(cardInitials('Björn Enders')).toBe('BE')
  })
})

describe('canvasSizeFor', () => {
  it('returns the minimum size for an empty board', () => {
    expect(canvasSizeFor([])).toEqual({ width: 1200, height: 800 })
  })

  it('grows past the furthest card, keeping a drag margin', () => {
    const size = canvasSizeFor([
      { x: 1000, y: 100, width: 220, height: null },
      { x: 200, y: 900, width: 220, height: 150 },
    ])
    expect(size.width).toBe(1620) // 1000 + 220 + 400
    expect(size.height).toBe(1450) // 900 + 150 + 400
  })

  it('assumes a height for cards that grow with their text', () => {
    // 700 + 200 (assumed) + 400 = 1300
    expect(canvasSizeFor([{ x: 0, y: 700, width: 220, height: null }]).height).toBe(
      1300,
    )
  })
})

describe('sortCardsByStack', () => {
  it('orders lexicographically by the fractional-index key', () => {
    const sorted = sortCardsByStack([{ z: 'u' }, { z: 'a5' }, { z: 'n' }])
    expect(sorted.map((c) => c.z)).toEqual(['a5', 'n', 'u'])
  })

  it('does not mutate its input', () => {
    const input = [{ z: 'u' }, { z: 'n' }]
    sortCardsByStack(input)
    expect(input.map((c) => c.z)).toEqual(['u', 'n'])
  })
})

describe('nextCardSpot', () => {
  it('places the first card just inside the visible area', () => {
    expect(nextCardSpot({ left: 0, top: 0 }, 0)).toEqual({ x: 40, y: 40 })
  })

  it('follows the scroll position so new cards are never off screen', () => {
    expect(nextCardSpot({ left: 500, top: 300 }, 0)).toEqual({ x: 540, y: 340 })
  })

  it('clears the widest default card so nothing is placed on top', () => {
    const first = nextCardSpot({ left: 0, top: 0 }, 0)
    const second = nextCardSpot({ left: 0, top: 0 }, 1)
    // a heading defaults to 320px wide, so the gap has to exceed that
    expect(second.x - first.x).toBeGreaterThan(320)
    expect(second.y).toBe(first.y)
  })

  it('wraps to the next row and back to the first column', () => {
    const spots = Array.from({ length: 12 }, (_, i) =>
      nextCardSpot({ left: 0, top: 0 }, i),
    )
    const wrapped = spots.findIndex((spot, i) => i > 0 && spot.x === spots[0]!.x)
    expect(wrapped).toBeGreaterThan(0)
    expect(spots[wrapped]!.y).toBeGreaterThan(spots[0]!.y)
  })

  it('gives every slot of the grid a distinct position', () => {
    const spots = Array.from({ length: 12 }, (_, i) =>
      nextCardSpot({ left: 0, top: 0 }, i),
    ).map((s) => `${s.x}:${s.y}`)
    expect(new Set(spots).size).toBe(12)
  })

  it('reuses slots once the grid is full', () => {
    expect(nextCardSpot({ left: 0, top: 0 }, 12)).toEqual(
      nextCardSpot({ left: 0, top: 0 }, 0),
    )
  })
})

describe('cardLabel', () => {
  it('uses the first line', () => {
    expect(cardLabel('Erste Zeile\nzweite Zeile')).toBe('Erste Zeile')
  })

  it('truncates long lines with an ellipsis', () => {
    expect(cardLabel('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
  })

  it('returns an empty string for empty text', () => {
    expect(cardLabel('')).toBe('')
    expect(cardLabel('\n\n')).toBe('')
  })
})
