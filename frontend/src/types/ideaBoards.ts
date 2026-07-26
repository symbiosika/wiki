/**
 * Shared types for idea boards (mirrors the backend app API).
 *
 * A board is a free-form canvas: cards carry their own x/y position, there are
 * no sections or columns. "heading" cards are the labels that give a region of
 * the canvas its meaning.
 */

export type IdeaCardKind = 'note' | 'heading'

export type IdeaLinkType = 'relates' | 'duplicate' | 'answers' | 'blocks'

export interface IdeaBoardSettings {
  showAuthors?: boolean
  locked?: boolean
  background?: 'grid' | 'plain'
}

export interface IdeaBoard {
  id: string
  tenantId: string
  title: string
  description: string | null
  teamId: string | null
  tenantWide: boolean
  /** wiki page this board hangs off, if any */
  pageId: string | null
  settings: IdeaBoardSettings
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface IdeaCard {
  id: string
  boardId: string
  tenantId: string
  kind: IdeaCardKind
  text: string
  /** author label snapshotted when the card was written */
  authorLabel: string | null
  createdBy: string | null
  color: string | null
  x: number
  y: number
  width: number
  /** null = height grows with the text */
  height: number | null
  /** fractional-index stacking key; lexicographic order = back to front */
  z: string
  /** wiki page this card was promoted to, if any */
  pageId: string | null
  createdAt: string
  updatedAt: string
}

export interface IdeaCardComment {
  id: string
  cardId: string
  boardId: string
  tenantId: string
  text: string
  createdBy: string | null
  authorLabel: string | null
  createdAt: string
  updatedAt: string
}

export interface IdeaCardLink {
  id: string
  tenantId: string
  boardId: string
  sourceCardId: string
  targetCardId: string | null
  targetPageId: string | null
  /** title snapshot, so a page link stays readable after the page is gone */
  targetPageTitle: string | null
  type: IdeaLinkType
  createdBy: string | null
  createdAt: string
}

/** Everything `GET /idea-boards/:boardId` returns. */
export interface IdeaBoardDetail {
  board: IdeaBoard
  cards: IdeaCard[]
  comments: IdeaCardComment[]
  links: IdeaCardLink[]
}

export interface IdeaBoardInput {
  title: string
  description?: string | null
  teamId?: string | null
  tenantWide?: boolean
  pageId?: string | null
  settings?: IdeaBoardSettings
}

export interface IdeaCardInput {
  text?: string
  kind?: IdeaCardKind
  color?: string | null
  x?: number
  y?: number
  width?: number
  height?: number | null
}

export interface IdeaCardLinkInput {
  targetCardId?: string | null
  targetPageId?: string | null
  targetPageTitle?: string | null
  type?: IdeaLinkType
}

/**
 * Card palette. Keys are stored, the colours live here so theming (and dark
 * mode) stays a frontend concern.
 */
export const IDEA_CARD_COLORS = [
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'neutral',
] as const

export type IdeaCardColor = (typeof IDEA_CARD_COLORS)[number]
