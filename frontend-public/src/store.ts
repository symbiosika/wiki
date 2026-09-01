/**
 * Shared organisation + overview state.
 *
 * URLs address an organisation by slug, the API by tenant id, so every visit
 * starts by resolving one to the other. Both that and the published page tree
 * are fetched once per organisation and reused by the sidebar, the home page
 * and the wiki-link resolver.
 *
 * A plain reactive module is enough — one piece of shared state, no mutations
 * beyond loading it, so Pinia would only add ceremony.
 */
import { reactive, readonly } from 'vue'
import { applyBrandColor } from './brand'
import {
  fetchOverview,
  resolveOrganisation,
  type PublicOrganisation,
  type WikiOverview,
  type WikiTreeNode,
} from './api'

interface State {
  /** Slug currently loaded, as it appeared in the URL. */
  slug: string | null
  organisation: PublicOrganisation | null
  overview: WikiOverview | null
  loading: boolean
  /** Set when the slug does not resolve, as opposed to a transport failure. */
  notFound: boolean
  error: string | null
}

const state = reactive<State>({
  slug: null,
  organisation: null,
  overview: null,
  loading: false,
  notFound: false,
  error: null,
})

/** Title (lowercased) -> page id, for resolving `[[Wiki Links]]`. */
const titleIndex = new Map<string, string>()

const indexTree = (nodes: WikiTreeNode[]) => {
  for (const node of nodes) {
    // First match wins on duplicate titles, mirroring how the backend
    // resolves page links.
    const key = node.title.trim().toLowerCase()
    if (!titleIndex.has(key)) titleIndex.set(key, node.id)
    indexTree(node.children)
  }
}

const reset = (slug: string) => {
  // Drop the previous organisation's colour immediately; keeping it while the
  // next one resolves would show one organisation's branding on another's page.
  applyBrandColor(null)
  state.slug = slug
  state.organisation = null
  state.overview = null
  state.notFound = false
  state.error = null
  titleIndex.clear()
}

/**
 * Load an organisation and its published tree by slug. Repeated calls for the
 * same slug are a no-op, so route changes do not refetch.
 */
export const loadOrganisation = async (slug: string): Promise<void> => {
  if (state.slug === slug && state.overview) return

  reset(slug)
  state.loading = true

  try {
    const organisation = await resolveOrganisation(slug)
    state.organisation = organisation
    // as early as possible, so the page is not briefly painted in the default
    // palette before the tree arrives
    applyBrandColor(organisation.brandColor)

    const overview = await fetchOverview(organisation.id)
    state.overview = overview
    for (const section of overview.sections) indexTree(section.pages)
  } catch (error) {
    state.overview = null
    // A 404 on the slug is an ordinary outcome (mistyped or renamed
    // organisation), not a failure worth an error message.
    if (error instanceof Error && 'status' in error && error.status === 404) {
      state.notFound = true
    } else {
      state.error =
        error instanceof Error
          ? error.message
          : 'Die Dokumentation konnte nicht geladen werden.'
    }
  } finally {
    state.loading = false
  }
}

/** Tenant id of the loaded organisation — the API's identifier. */
export const tenantId = (): string | null => state.organisation?.id ?? null

/** Resolve a wiki-link target to a published page id, or null. */
export const resolvePageByTitle = (title: string): string | null =>
  titleIndex.get(title.trim().toLowerCase()) ?? null

export const overviewState = readonly(state)
