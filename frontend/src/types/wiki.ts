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

/** The page currently being dragged in the sidebar tree (shared via provide). */
export interface WikiDragState {
  id: string
  /** the section the page lives in — moves are only allowed within one section */
  scopeKey: string
}

/** A drag & drop move request emitted by a tree item. */
export interface WikiMovePayload {
  dragId: string
  targetId: string
  /** drop position relative to the target: sibling before/after, or child */
  mode: 'before' | 'inside' | 'after'
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
  // --- authorship (see framework knowledge.ts) ---
  /** User who created the page. */
  createdBy: string | null
  /** User who last edited the page. */
  updatedBy: string | null
  // --- controlled facets (see framework knowledge-config.ts) ---
  /** Classification, e.g. "FAQ" | "manual" | "text" | "policy" | "note". */
  pageType: string | null
  /** Trust signal, e.g. "draft" | "verified" | "outdated". */
  status: string | null
  /** Set when `status` transitions to "verified": when and by whom. */
  verifiedAt: string | null
  verifiedBy: string | null
  // --- AI page summary (the "docstring" of a page, see framework summaries.ts) ---
  /**
   * Short (1-2 sentence) AI-generated (or manual) description of the page.
   * Null when no summary has been generated yet (e.g. no LLM configured, or
   * the debounced sweeper has not run). Only surfaced read-only in the UI.
   */
  summary: string | null
  /** How the summary is maintained: "auto" | "manual" | "off". */
  summaryMode: 'auto' | 'manual' | 'off'
  /** When the summary was last (re)generated. */
  summaryUpdatedAt: string | null
  // --- per-organisation key-value metadata (see framework knowledge.ts) ---
  /**
   * Free key-value metadata whose allowed keys (and optionally a closed list of
   * values per key) are defined per organisation in the knowledge config. The
   * keys correspond to `WikiKnowledgeConfig.attributes[].key`.
   */
  attributes: Record<string, string>
}

/**
 * One per-organisation metadata key definition (see framework
 * knowledge-config.ts `KnowledgeAttributeDefinition`). Documents may carry a
 * value for each defined key in their `attributes` map.
 */
export interface KnowledgeAttributeDefinition {
  /** The stable attribute key stored on the document, e.g. "hersteller". */
  key: string
  /** Optional display label; falls back to the key when omitted. */
  label?: string
  /**
   * Optional closed list of allowed values. When present the value must be one
   * of these (rendered as a select); when omitted the value is free text.
   */
  values?: string[]
}

/**
 * Tenant knowledge configuration (facet vocabularies + flags), as returned by
 * GET /knowledge/texts/config. The `pageTypes` / `statuses` lists are the
 * closed vocabularies a page's facets are validated against on write, and
 * `attributes` are the per-organisation key-value metadata definitions.
 */
export interface WikiKnowledgeConfig {
  autoSummaries: boolean
  pageTypes: string[]
  statuses: string[]
  attributes: KnowledgeAttributeDefinition[]
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

/**
 * How the sidebar search queries the backend:
 * - `hybrid`   — full-text + semantic (embedding) fused via RRF (smartest)
 * - `fulltext` — Postgres tsvector / ILIKE lexical match only (fastest)
 * - `semantic` — embedding similarity only
 */
export type WikiSearchMode = 'hybrid' | 'fulltext' | 'semantic'

/** An outgoing `[[wikilink]]` of a page (resolved target or phantom link). */
export interface WikiOutgoingLink {
  targetTitle: string
  resolved: boolean
  /** target page — null for phantom links or targets the user cannot see */
  page: { id: string; title: string } | null
}

/** A page that links to the current page. */
export interface WikiBacklink {
  page: { id: string; title: string }
  /** the link target as written in the linking page */
  targetTitle: string
}

/** A semantically related page (embedding similarity). */
export interface WikiRelatedPage {
  id: string
  title: string
  /** distance of the closest chunk pair (smaller = more similar) */
  distance: number
}
