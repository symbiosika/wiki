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
  /**
   * Resolved public-visibility flag: true when this page is reachable in the
   * public documentation site. Derived server-side from `publicMode` along the
   * parent chain, so a page can be public without carrying an own intent.
   * Drives the globe marker in the tree.
   */
  publicEffective: boolean
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
  // --- public publishing (see framework knowledge-text-public.ts) ---
  /**
   * Explicit publishing intent set by a person:
   *   "public"    publish this page and everything below it
   *   "excluded"  keep it internal even below a published parent
   *   null        inherit from the parent (the default)
   */
  publicMode: 'public' | 'excluded' | null
  /**
   * Resolved result of that intent along the parent chain — the value the
   * public API actually filters on. Read-only here; the server derives it and
   * ignores any client-supplied value.
   */
  publicEffective: boolean
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
   * Optional instruction handed to the PDF parser's extractor ("what exactly
   * to extract"). Falls back to the label/key when omitted.
   */
  description?: string
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

/**
 * Per-modality "extra service" flags the configured parsing service advertises
 * via its capabilities. Any flag defaults to `false` when absent. Mirrors the
 * framework `ServiceModality.features` shape (camelCase).
 */
export interface WikiParserFeatures {
  extractImages?: boolean
  extractFields?: boolean
  async?: boolean
  parseImagesInDoc?: boolean
  ocr?: boolean
  detectTables?: boolean
}

/** One document type the configured parsing service accepts. */
export interface WikiParserModality {
  modality: string
  mimeTypes: string[]
  extensions: string[]
  features?: WikiParserFeatures
}

/**
 * Capabilities of the configured parsing service (modalities + feature flags),
 * as returned by `GET /knowledge/parser/capabilities`. An empty `modalities`
 * list means the configured parser advertises no pass-through options.
 */
export interface WikiParserCapabilities {
  service: string
  modalities: WikiParserModality[]
}

/**
 * One heading entry for the page table of contents, derived live from the
 * editor document. `id` is the top-level block id (data-block-id) the heading
 * carries, so the ToC can scroll straight to it.
 */
export interface WikiTocEntry {
  id: string
  /** heading level 1-3 (H1/H2/H3) */
  level: number
  text: string
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
  /** wiki path (breadcrumb) of the hit, root first; '' for a top-level page */
  path?: string
  /**
   * The matched chunk's sequence number within the page (semantic hits only).
   * Address surrounding chunks via GET .../texts/:id/chunk-context?order=…
   */
  chunkOrder?: number | null
  /** source page number of the matched chunk (PDF imports), when known */
  sourcePage?: number | null
  /**
   * Id of the content block the matched chunk starts in (block-mode pages).
   * Lets the UI jump straight to the block in the rendered document. Null for
   * fulltext-only hits or chunks without block provenance.
   */
  blockId?: string | null
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
