import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { blocksAreEqual } from '@/utils/wikiBlocks'
import type {
  WikiBacklink,
  WikiBlock,
  WikiKnowledgeConfig,
  WikiOutgoingLink,
  WikiPage,
  WikiRelatedPage,
  WikiScope,
  WikiSearchMode,
  WikiSearchResult,
  WikiTree,
  WikiTreeNode,
} from '@/types/wiki'
import type { Job, KnowledgeIngestResult } from '@/types/notifications'

interface WikiState {
  tree: WikiTree
  treeLoading: boolean
  page: WikiPage | null
  blocks: WikiBlock[]
  pageLoading: boolean
  saving: boolean
  lastSavedAt: string | null
  saveError: string | null
  /** UI: whether the "import page" dialog is open (mounted once in the layout) */
  importDialogOpen: boolean
  /** tenant facet vocabularies (page types / statuses); null until loaded */
  config: WikiKnowledgeConfig | null
}

/** Options shared by the file and URL import endpoints. */
export interface WikiImportOptions {
  title?: string
  parentId?: string
  /** split the imported markdown at top-level headings into blocks */
  splitIntoBlocks?: boolean
  /**
   * Post processors to run on the parsed markdown before storing. For tenant
   * post-processing agents these are `agent:<uuid>` names.
   */
  postProcessorNames?: string[]
  /**
   * Push a success/error message into the user's notification queue when the
   * ingest job finishes. Defaults to true so imports surface in the inbox.
   */
  notifyOnCompletion?: boolean
}

/** A knowledge-ingest job returned by the import endpoints. */
export type IngestJob = Job<KnowledgeIngestResult>

/** Result of an image upload for a wiki page. */
export interface WikiImageUpload {
  fileId: string
  /** auth-protected API path to embed as the image src */
  path: string
  /** ready-to-insert markdown snippet */
  markdown: string
}

/** Translate a scope into the team/organisation fields the backend expects. */
const scopeFields = (
  scope: WikiScope,
): { teamId?: string; tenantWide?: boolean } => ({
  teamId: scope.kind === 'team' ? scope.teamId : undefined,
  tenantWide: scope.kind === 'organisation' ? true : undefined,
})

const emptyTree = (): WikiTree => ({
  personal: [],
  teams: [],
  organisation: [],
})

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}`

/** Recursively search a node list for a page id. */
const findNode = (nodes: WikiTreeNode[], id: string): WikiTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = findNode(node.children, id)
    if (hit) return hit
  }
  return null
}

export const useWiki = defineStore('wiki', () => {
  const state = ref<WikiState>({
    tree: emptyTree(),
    treeLoading: false,
    page: null,
    blocks: [],
    pageLoading: false,
    saving: false,
    lastSavedAt: null,
    saveError: null,
    importDialogOpen: false,
    config: null,
  })

  const openImportDialog = () => {
    state.value.importDialogOpen = true
  }

  // ----- config (facet vocabularies) --------------------------------------

  /**
   * Load the tenant's knowledge config (page-type / status vocabularies) once.
   * Cached for the session — the vocabularies rarely change and every page
   * uses the same lists, so we avoid re-fetching on each page switch.
   */
  const loadConfig = async (tenantId: string) => {
    if (state.value.config) return
    try {
      state.value.config = await fetcher.get<WikiKnowledgeConfig>(
        `${api(tenantId)}/knowledge/texts/config`,
      )
    } catch {
      // fall back to empty vocabularies — the facet selectors simply stay empty
      state.value.config = { autoSummaries: true, pageTypes: [], statuses: [] }
    }
  }

  // ----- tree -------------------------------------------------------------

  const loadTree = async (tenantId: string) => {
    state.value.treeLoading = true
    try {
      const response = await fetcher.get<{ success: boolean; data: WikiTree }>(
        `${api(tenantId)}/wiki/tree`,
      )
      state.value.tree = response.data
    } finally {
      state.value.treeLoading = false
    }
  }

  const findTreeNode = (id: string): WikiTreeNode | null => {
    const { personal, teams, organisation } = state.value.tree
    return (
      findNode(personal, id) ??
      findNode(organisation, id) ??
      teams.reduce<WikiTreeNode | null>(
        (hit, team) => hit ?? findNode(team.pages, id),
        null,
      )
    )
  }

  // ----- page -------------------------------------------------------------

  const loadPage = async (tenantId: string, pageId: string) => {
    state.value.pageLoading = true
    state.value.saveError = null
    try {
      let page = await fetcher.get<WikiPage>(
        `${api(tenantId)}/knowledge/texts/${pageId}`,
      )
      // The block editor needs block mode; convert legacy text pages once.
      if (page.contentMode === 'text') {
        await fetcher.post(
          `${api(tenantId)}/knowledge/texts/${pageId}/convert-to-blocks`,
          {},
        )
        page = await fetcher.get<WikiPage>(
          `${api(tenantId)}/knowledge/texts/${pageId}`,
        )
      }
      const blocks = await fetcher.get<WikiBlock[]>(
        `${api(tenantId)}/knowledge/texts/${pageId}/blocks`,
      )
      state.value.page = page
      state.value.blocks = blocks
    } finally {
      state.value.pageLoading = false
    }
  }

  const closePage = () => {
    state.value.page = null
    state.value.blocks = []
    state.value.saveError = null
  }

  // ----- mutations ----------------------------------------------------------

  const createPage = async (
    tenantId: string,
    scope: WikiScope,
    options: { title?: string; parentId?: string } = {},
  ): Promise<WikiPage> => {
    const page = await fetcher.post<WikiPage>(
      `${api(tenantId)}/knowledge/texts`,
      {
        tenantId,
        title: options.title ?? '',
        text: '',
        contentMode: 'blocks',
        parentId: options.parentId,
        teamId: scope.kind === 'team' ? scope.teamId : undefined,
        tenantWide: scope.kind === 'organisation',
      },
    )
    await loadTree(tenantId)
    return page
  }

  /**
   * Import an uploaded file (markdown, html, txt, PDF, …) as a new page.
   *
   * Ingestion now runs on the framework job queue: the endpoint enqueues a
   * `knowledge:ingest` job and returns it immediately (the page does not exist
   * yet). Completion is surfaced via the user notification queue (opt-in
   * `notifyOnCompletion`) rather than by waiting for the finished page.
   */
  const importFile = async (
    tenantId: string,
    scope: WikiScope,
    file: File,
    options: WikiImportOptions = {},
  ): Promise<IngestJob> => {
    const { teamId, tenantWide } = scopeFields(scope)
    const form = new FormData()
    form.append('file', file)
    if (options.title) form.append('title', options.title)
    if (options.parentId) form.append('parentId', options.parentId)
    if (teamId) form.append('teamId', teamId)
    if (tenantWide) form.append('tenantWide', 'true')
    form.append('splitIntoBlocks', String(options.splitIntoBlocks ?? true))
    form.append(
      'notifyOnCompletion',
      String(options.notifyOnCompletion ?? true),
    )
    // the framework file route parses usePostProcessors as a comma-separated list
    if (options.postProcessorNames && options.postProcessorNames.length > 0) {
      form.append('usePostProcessors', options.postProcessorNames.join(','))
    }

    // Returns the created ingest job; the tree is refreshed once the job
    // finishes (see the notifications store), not here.
    return await fetcher.postFormData<IngestJob>(
      `${api(tenantId)}/knowledge/texts/import`,
      form,
    )
  }

  /**
   * Import a web page (Readability + Turndown) as a new page. Like
   * {@link importFile}, this enqueues a `knowledge:ingest` job and returns it.
   */
  const importUrl = async (
    tenantId: string,
    scope: WikiScope,
    url: string,
    options: WikiImportOptions = {},
  ): Promise<IngestJob> => {
    const { teamId, tenantWide } = scopeFields(scope)
    return await fetcher.post<IngestJob>(
      `${api(tenantId)}/knowledge/texts/import-url`,
      {
        url,
        title: options.title || undefined,
        parentId: options.parentId,
        teamId,
        tenantWide,
        splitIntoBlocks: options.splitIntoBlocks ?? true,
        notifyOnCompletion: options.notifyOnCompletion ?? true,
        // the framework URL route parses usePostProcessors as a string array
        usePostProcessors:
          options.postProcessorNames && options.postProcessorNames.length > 0
            ? options.postProcessorNames
            : undefined,
      },
    )
  }

  /** Upload an image for a page; returns its auth-protected path + markdown. */
  const uploadImage = async (
    tenantId: string,
    pageId: string,
    file: File,
  ): Promise<WikiImageUpload> => {
    const form = new FormData()
    form.append('file', file)
    return await fetcher.postFormData<WikiImageUpload>(
      `${api(tenantId)}/knowledge/texts/${pageId}/images`,
      form,
    )
  }

  const saveTitle = async (tenantId: string, pageId: string, title: string) => {
    state.value.saving = true
    state.value.saveError = null
    try {
      await fetcher.put(`${api(tenantId)}/knowledge/texts/${pageId}`, {
        tenantId,
        title,
      })
      if (state.value.page?.id === pageId) {
        state.value.page.title = title
      }
      const node = findTreeNode(pageId)
      if (node) node.title = title
      state.value.lastSavedAt = new Date().toISOString()
    } catch (error) {
      state.value.saveError =
        error instanceof Error ? error.message : 'Failed to save title'
      throw error
    } finally {
      state.value.saving = false
    }
  }

  /**
   * Update a page's controlled facets (classification / status). The backend
   * validates the values against the tenant vocabulary. When the status moves
   * to (or away from) "verified" we also stamp verifiedAt/verifiedBy so the
   * trust signal carries who confirmed it and when.
   */
  const savePageMeta = async (
    tenantId: string,
    pageId: string,
    patch: { pageType?: string | null; status?: string | null },
    verifiedByUserId?: string,
  ) => {
    const body: Record<string, unknown> = { tenantId, ...patch }
    if ('status' in patch) {
      if (patch.status === 'verified') {
        body.verifiedAt = new Date().toISOString()
        body.verifiedBy = verifiedByUserId ?? null
      } else {
        // leaving the verified state clears the verification stamp
        body.verifiedAt = null
        body.verifiedBy = null
      }
    }

    state.value.saving = true
    state.value.saveError = null
    try {
      const updated = await fetcher.put<WikiPage>(
        `${api(tenantId)}/knowledge/texts/${pageId}`,
        body,
      )
      if (state.value.page?.id === pageId) {
        if ('pageType' in patch) state.value.page.pageType = updated.pageType
        if ('status' in patch) {
          state.value.page.status = updated.status
          state.value.page.verifiedAt = updated.verifiedAt
          state.value.page.verifiedBy = updated.verifiedBy
        }
      }
      state.value.lastSavedAt = new Date().toISOString()
    } catch (error) {
      state.value.saveError =
        error instanceof Error ? error.message : 'Failed to save page metadata'
      throw error
    } finally {
      state.value.saving = false
    }
  }

  const saveBlocks = async (
    tenantId: string,
    pageId: string,
    blocks: WikiBlock[],
  ) => {
    // ignore saves for a page that is no longer open
    if (state.value.page?.id !== pageId) return
    if (blocksAreEqual(state.value.blocks, blocks)) return

    state.value.saving = true
    state.value.saveError = null
    try {
      const response = await fetcher.put<{
        blocks: WikiBlock[]
      }>(`${api(tenantId)}/knowledge/texts/${pageId}/blocks`, { blocks })
      if (state.value.page?.id === pageId) {
        state.value.blocks = response.blocks
      }
      state.value.lastSavedAt = new Date().toISOString()
    } catch (error) {
      state.value.saveError =
        error instanceof Error ? error.message : 'Failed to save page'
      throw error
    } finally {
      state.value.saving = false
    }
  }

  const deletePage = async (tenantId: string, pageId: string) => {
    await fetcher.delete(`${api(tenantId)}/knowledge/texts/${pageId}`)
    if (state.value.page?.id === pageId) closePage()
    await loadTree(tenantId)
  }

  // ----- search -------------------------------------------------------------

  const search = async (
    tenantId: string,
    query: string,
    mode: WikiSearchMode = 'hybrid',
  ): Promise<WikiSearchResult[]> => {
    if (!query.trim()) return []
    return await fetcher.get<WikiSearchResult[]>(
      `${api(tenantId)}/knowledge/texts/search?q=${encodeURIComponent(query)}&mode=${mode}`,
    )
  }

  // ----- references (links / backlinks / related) ---------------------------

  /** Outgoing `[[wikilinks]]` of a page (resolved + phantom). */
  const getLinks = async (
    tenantId: string,
    pageId: string,
  ): Promise<WikiOutgoingLink[]> =>
    await fetcher.get<WikiOutgoingLink[]>(
      `${api(tenantId)}/knowledge/texts/${pageId}/links`,
    )

  /** Pages that link to this page. */
  const getBacklinks = async (
    tenantId: string,
    pageId: string,
  ): Promise<WikiBacklink[]> =>
    await fetcher.get<WikiBacklink[]>(
      `${api(tenantId)}/knowledge/texts/${pageId}/backlinks`,
    )

  /** Semantically related pages (empty unless embeddings are enabled). */
  const getRelated = async (
    tenantId: string,
    pageId: string,
  ): Promise<WikiRelatedPage[]> =>
    await fetcher.get<WikiRelatedPage[]>(
      `${api(tenantId)}/knowledge/texts/${pageId}/related`,
    )

  return {
    state,
    openImportDialog,
    loadConfig,
    loadTree,
    findTreeNode,
    loadPage,
    closePage,
    createPage,
    importFile,
    importUrl,
    uploadImage,
    saveTitle,
    savePageMeta,
    saveBlocks,
    deletePage,
    search,
    getLinks,
    getBacklinks,
    getRelated,
  }
})
