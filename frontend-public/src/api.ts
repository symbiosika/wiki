/**
 * Client for the public wiki API.
 *
 * Every endpoint here is unauthenticated and read-only — there is no token, no
 * cookie and no login redirect anywhere in this app. A 404 means "not
 * published or does not exist"; the backend deliberately does not distinguish
 * the two, so neither does this client.
 */

const API_BASE = '/api/v1/public/wiki'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface WikiTreeNode {
  id: string
  title: string
  parentId: string | null
  children: WikiTreeNode[]
}

export interface WikiSection {
  id: string
  name: string
  pages: WikiTreeNode[]
}

export interface PublicOrganisation {
  id: string
  name: string
  /** Readable identifier used in this app's URLs. */
  slug: string
  hasLogo: boolean
  /** Timestamp used as a cache buster on the logo URL. */
  logoUpdatedAt: string | null
  /** Primary brand colour as `#rrggbb`, or null for the default palette. */
  brandColor: string | null
}

export interface WikiOverview {
  organisation: PublicOrganisation | null
  sections: WikiSection[]
  pageCount: number
}

export interface WikiPage {
  id: string
  title: string
  text: string
  summary: string | null
  pageType: string | null
  status: string | null
  updatedAt: string
  parentId: string | null
}

export interface SearchHit {
  id: string
  title: string
  path: string
  snippet: string
  summary: string | null
  pageType: string | null
  status: string | null
  updatedAt: string
  score: number
}

const request = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
  let response: Response
  try {
    response = await fetch(path, { signal, headers: { accept: 'application/json' } })
  } catch (error) {
    // AbortError is a caller-initiated cancellation, not a failure — let it
    // through unchanged so callers can ignore it.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Die Dokumentation ist gerade nicht erreichbar.')
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 404
        ? 'Diese Seite ist nicht öffentlich verfügbar.'
        : `Anfrage fehlgeschlagen (${response.status}).`,
    )
  }
  return (await response.json()) as T
}

export const fetchOverview = (tenantId: string, signal?: AbortSignal) =>
  request<WikiOverview>(`${API_BASE}/${tenantId}/overview`, signal)

/**
 * Resolve a readable slug from the URL to an organisation.
 *
 * Slugs are derived from organisation names server-side rather than stored, so
 * this is a search. A 404 means no PUBLISHING organisation matches — an
 * organisation that has published nothing is not resolvable at all.
 */
export const resolveOrganisation = (slug: string, signal?: AbortSignal) =>
  request<PublicOrganisation>(
    `${API_BASE}/by-slug/${encodeURIComponent(slug)}`,
    signal,
  )

/** Organisations that have published something; drives the entry page. */
export const fetchOrganisations = async (
  signal?: AbortSignal,
): Promise<PublicOrganisation[]> => {
  const result = await request<{ organisations: PublicOrganisation[] }>(
    `${API_BASE}/organisations`,
    signal,
  )
  return result.organisations
}

export const fetchPage = (tenantId: string, pageId: string, signal?: AbortSignal) =>
  request<WikiPage>(`${API_BASE}/${tenantId}/pages/${pageId}`, signal)

export const search = async (
  tenantId: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> => {
  const params = new URLSearchParams({ q: query, limit: '20' })
  const result = await request<{ hits: SearchHit[] }>(
    `${API_BASE}/${tenantId}/search?${params}`,
    signal,
  )
  return result.hits
}

/**
 * URL of the organisation logo. The `v` parameter is the stored update
 * timestamp, so a replaced logo is not served from a stale cache.
 */
export const logoUrl = (organisation: PublicOrganisation): string | null =>
  organisation.hasLogo
    ? `${API_BASE}/${organisation.id}/logo?v=${encodeURIComponent(
        organisation.logoUpdatedAt ?? '',
      )}`
    : null

/** URL of an image embedded in a published page. */
export const imageUrl = (tenantId: string, pageId: string, filename: string) =>
  `${API_BASE}/${tenantId}/pages/${pageId}/images/${filename}`
