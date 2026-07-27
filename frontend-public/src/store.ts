/**
 * Shared overview state.
 *
 * The published page tree is fetched once per tenant and reused by the
 * sidebar, the home page and the wiki-link resolver. A plain reactive module
 * is enough here — this app has one piece of shared state and no mutations
 * beyond loading it, so Pinia would only add ceremony.
 */
import { reactive, readonly } from 'vue'
import { fetchOverview, type WikiOverview, type WikiTreeNode } from './api'

interface State {
  tenantId: string | null
  overview: WikiOverview | null
  loading: boolean
  error: string | null
}

const state = reactive<State>({
  tenantId: null,
  overview: null,
  loading: false,
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

/**
 * Load the overview for a tenant. Repeated calls for the same tenant are a
 * no-op, so every route change does not refetch the tree.
 */
export const loadOverview = async (tenantId: string): Promise<void> => {
  if (state.tenantId === tenantId && state.overview) return

  state.tenantId = tenantId
  state.loading = true
  state.error = null
  titleIndex.clear()

  try {
    const overview = await fetchOverview(tenantId)
    state.overview = overview
    for (const section of overview.sections) indexTree(section.pages)
  } catch (error) {
    state.overview = null
    state.error =
      error instanceof Error ? error.message : 'Die Dokumentation konnte nicht geladen werden.'
  } finally {
    state.loading = false
  }
}

/** Resolve a wiki-link target to a published page id, or null. */
export const resolvePageByTitle = (title: string): string | null =>
  titleIndex.get(title.trim().toLowerCase()) ?? null

/** Title of a page in the loaded tree, or null when it is not in it. */
export const pageTitleById = (pageId: string): string | null => {
  for (const [title, id] of titleIndex) {
    if (id === pageId) return title
  }
  return null
}

export const overviewState = readonly(state)
