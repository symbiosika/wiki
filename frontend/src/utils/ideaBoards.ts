/**
 * Pure helpers for the idea board canvas.
 */
import type { IdeaCard } from '@/types/ideaBoards'

/** Empty canvas shown for a board without cards, in px. */
const MIN_CANVAS = { width: 1200, height: 800 }

/** Free space kept past the furthest card so there is always room to drag into. */
const CANVAS_MARGIN = 400

/** Assumed card height when a card has no explicit one (it grows with its text). */
const ASSUMED_CARD_HEIGHT = 200

/**
 * Derive the initials shown on a card from the author's label — the equivalent
 * of the "(BE)" people scribble on a physical sticky note. Keeps full email
 * addresses off the board.
 *
 * "bjoern.enders@example.com" → "BE", "testuser1" → "TE", "" → "".
 */
export const cardInitials = (authorLabel: string | null | undefined): string => {
  const label = authorLabel?.trim()
  if (!label) return ''
  const local = label.split('@')[0] ?? label
  // split on anything that is not a letter, so dots, underscores and digits
  // all act as separators
  const words = local.split(/[^\p{L}]+/u).filter(Boolean)
  if (words.length === 0) return ''
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2)
  return letters.toUpperCase()
}

/**
 * Size of the scrollable canvas: large enough to hold every card plus a margin,
 * never smaller than one screenful.
 */
export const canvasSizeFor = (
  cards: Pick<IdeaCard, 'x' | 'y' | 'width' | 'height'>[],
): { width: number; height: number } => {
  let width = MIN_CANVAS.width
  let height = MIN_CANVAS.height
  for (const card of cards) {
    width = Math.max(width, card.x + card.width + CANVAS_MARGIN)
    height = Math.max(
      height,
      card.y + (card.height ?? ASSUMED_CARD_HEIGHT) + CANVAS_MARGIN,
    )
  }
  return { width, height }
}

/**
 * Order cards back-to-front. `z` is a fractional-index key, so plain
 * lexicographic comparison is the stacking order — the same order the backend
 * returns them in.
 */
export const sortCardsByStack = <T extends Pick<IdeaCard, 'z'>>(
  cards: T[],
): T[] => [...cards].sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0))

/**
 * Grid new cards are dropped into. The horizontal step clears the widest
 * default card (a 320px heading), otherwise a heading placed in one column is
 * covered by the note in the next; three columns keep the whole grid inside a
 * normal viewport next to the sidebar.
 */
const SPOT_COLUMNS = 3
const SPOT_ROWS = 4
const SPOT_STEP_X = 344
const SPOT_STEP_Y = 168

/**
 * Where a newly added card is placed: into the visible part of the canvas,
 * laid out on a coarse grid.
 *
 * A cascading offset of a few pixels per card (the obvious first idea) leaves
 * every new card covering the previous one, which is unusable for headings in
 * particular — so successive cards step a full card width apart and wrap after
 * a few columns. Cards can still be dragged anywhere; this only decides where
 * they appear.
 */
export const nextCardSpot = (
  scroll: { left: number; top: number },
  cardCount: number,
): { x: number; y: number } => {
  const slot = cardCount % (SPOT_COLUMNS * SPOT_ROWS)
  const column = slot % SPOT_COLUMNS
  const row = Math.floor(slot / SPOT_COLUMNS)
  return {
    x: scroll.left + 40 + column * SPOT_STEP_X,
    y: scroll.top + 40 + row * SPOT_STEP_Y,
  }
}

/** First line of a card's text, for use as a label. */
export const cardLabel = (text: string, maxLength = 60): string => {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line
}
