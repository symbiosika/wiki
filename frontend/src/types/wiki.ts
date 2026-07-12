/**
 * Shared wiki types (mirrors the backend wiki API).
 */

export interface WikiTreeNode {
  id: string
  title: string
  parentId: string | null
  position: string | null
  contentMode: 'text' | 'blocks'
  teamId: string | null
  userId: string | null
  tenantWide: boolean
  updatedAt: string
  children: WikiTreeNode[]
}

export interface WikiTeamSection {
  teamId: string
  name: string
  role: string
  pages: WikiTreeNode[]
}

export interface WikiTree {
  personal: WikiTreeNode[]
  teams: WikiTeamSection[]
  organisation: WikiTreeNode[]
}

/** A full knowledge-text record as returned by GET /knowledge/texts/:id */
export interface WikiPage {
  id: string
  tenantId: string
  title: string
  text: string
  parentId: string | null
  teamId: string | null
  userId: string | null
  tenantWide: boolean
  contentMode: 'text' | 'blocks'
  position: string | null
  updatedAt: string
  createdAt: string
}

/** A content block as stored by the backend */
export interface WikiBlock {
  id?: string
  type: 'markdown' | 'html'
  content: string
  meta?: Record<string, unknown>
}

/** Where a new page lives: private, in a team, or organisation-wide */
export type WikiScope =
  | { kind: 'personal' }
  | { kind: 'team'; teamId: string }
  | { kind: 'organisation' }

export interface WikiSearchResult {
  id: string
  title: string
  score: number
  snippet: string
  matchedBy: string[]
}
