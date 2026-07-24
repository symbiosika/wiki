import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { blocksAreEqual } from '@/utils/wikiBlocks'
import type {
  WikiBacklink,
  WikiBlock,
  WikiKnowledgeConfig,
  WikiOutgoingLink,
  WikiPage,
  WikiParserCapabilities,
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
  /**
   * Parser pass-through options (extra services). Only meaningful for file
   * imports whose type the configured parsing service supports; unsupported
   * flags are ignored by the backend. Discover the available ones via
   * {@link useWiki().fetchParserCapabilities}.
   */
  extractImages?: boolean
  parseImagesInDoc?: boolean
  ocr?: boolean
  detectTables?: boolean
}

/** A knowledge-ingest job returned by the import endpoints. */
export type IngestJob = Job<KnowledgeIngestResult>

/** Summary returned by the folder/repository markdown tree import. */
export interface WikiTreeImportResult {
  /** Number of pages created from a file's content. */
  pagesCreated: number
  /** Number of empty container ("folder") pages created. */
  foldersCreated: number
  /** Files that were not imported, with a reason. */
  skipped: { path: string; reason: string }[]
  /** Ids of the pages created directly at the base location. */
  rootPageIds: string[]
}

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
      state.value.config = {
        autoSummaries: true,
        pageTypes: [],
        statuses: [],
        attributes: [],
      }
    }
  }

  /**
   * Force-refresh the cached tenant knowledge config. Used after an admin edits
   * the per-organisation metadata definitions so the open document picks up the
   * new attribute keys without a full reload.
   */
  const reloadConfig = async (tenantId: string) => {
    state.value.config = null
    await loadConfig(tenantId)
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
   * Find a direct child page by title, case-insensitively. With a `parentId`
   * the lookup is scoped to that page's children; without one it looks at the
   * given scope's root level (personal / team / organisation). Used to reuse an
   * existing "folder" page instead of creating a duplicate on import.
   */
  const findChildPageByTitle = (
    scope: WikiScope,
    parentId: string | undefined,
    title: string,
  ): WikiTreeNode | null => {
    const wanted = title.trim().toLowerCase()
    const inList = (nodes: WikiTreeNode[]) =>
      nodes.find((n) => n.title.trim().toLowerCase() === wanted) ?? null

    if (parentId) {
      const parent = findTreeNode(parentId)
      return parent ? inList(parent.children) : null
    }
    if (scope.kind === 'organisation')
      return inList(state.value.tree.organisation)
    if (scope.kind === 'team') {
      const team = state.value.tree.teams.find((t) => t.teamId === scope.teamId)
      return team ? inList(team.pages) : null
    }
    return inList(state.value.tree.personal)
  }

  /**
   * Ensure a chain of "folder" pages exists for the given path segments,
   * creating any missing ones as empty pages under the running parent. Returns
   * the id of the deepest segment, or the untouched `baseParentId` when there
   * are no segments. Segments are matched/created level by level so importing a
   * whole dropped folder reuses shared parents instead of duplicating them.
   */
  const ensurePagePath = async (
    tenantId: string,
    scope: WikiScope,
    segments: string[],
    baseParentId?: string,
  ): Promise<string | undefined> => {
    let parentId = baseParentId
    for (const raw of segments) {
      const title = raw.trim()
      if (!title) continue
      const existing = findChildPageByTitle(scope, parentId, title)
      if (existing) {
        parentId = existing.id
      } else {
        // createPage refreshes the tree, so the next lookup sees this folder
        const page = await createPage(tenantId, scope, { title, parentId })
        parentId = page.id
      }
    }
    return parentId
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
    // Parser pass-through options — only appended when enabled (default off).
    if (options.extractImages) form.append('extractImages', 'true')
    if (options.parseImagesInDoc) form.append('parseImagesInDoc', 'true')
    if (options.ocr) form.append('ocr', 'true')
    if (options.detectTables) form.append('detectTables', 'true')

    // Returns the created ingest job; the tree is refreshed once the job
    // finishes (see the notifications store), not here.
    return await fetcher.postFormData<IngestJob>(
      `${api(tenantId)}/knowledge/texts/import`,
      form,
    )
  }

  /**
   * Fetch the capabilities (accepted modalities + per-modality feature flags)
   * of the configured parsing service, so the import UI can offer a checkbox
   * for each pass-through option the service actually supports. Returns an
   * empty modality list when nothing is advertised.
   */
  const fetchParserCapabilities = async (
    tenantId: string,
  ): Promise<WikiParserCapabilities> => {
    return await fetcher.get<WikiParserCapabilities>(
      `${api(tenantId)}/knowledge/parser/capabilities`,
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

  /**
   * Import a whole folder / repository of markdown files as a page tree in a
   * single request. Unlike {@link importFile} (one async job per file) this
   * runs synchronously on the server, which lets it reconstruct the hierarchy
   * and collapse folder notes (`Foo/` + `Foo.md`, `README.md`, `index.md`)
   * onto their folder — the async per-file path cannot, because a folder page
   * does not exist yet when a child needs it as a parent.
   *
   * Only text-based files (markdown / txt / html) belong here; binary
   * documents (PDF, Word) still go through {@link importFile}.
   */
  const importMarkdownTree = async (
    tenantId: string,
    scope: WikiScope,
    files: { path: string; content: string }[],
    options: {
      baseParentId?: string
      splitIntoBlocks?: boolean
      postProcessorNames?: string[]
      stripCommonRoot?: boolean
    } = {},
  ): Promise<WikiTreeImportResult> => {
    const { teamId, tenantWide } = scopeFields(scope)
    const response = await fetcher.post<{
      success: boolean
      data: WikiTreeImportResult
    }>(`${api(tenantId)}/wiki/import-tree`, {
      files,
      teamId,
      tenantWide,
      baseParentId: options.baseParentId,
      splitIntoBlocks: options.splitIntoBlocks ?? true,
      usePostProcessors:
        options.postProcessorNames && options.postProcessorNames.length > 0
          ? options.postProcessorNames
          : undefined,
      stripCommonRoot: options.stripCommonRoot,
    })
    await loadTree(tenantId)
    return response.data
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

  /**
   * Replace a page's per-organisation key-value metadata. The backend validates
   * the keys/values against the tenant knowledge config (unknown keys or values
   * outside a key's closed list are rejected). Empty-string values are dropped
   * so clearing a field removes the key entirely.
   */
  const saveAttributes = async (
    tenantId: string,
    pageId: string,
    attributes: Record<string, string>,
  ) => {
    const cleaned = Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== ''),
    )
    state.value.saving = true
    state.value.saveError = null
    try {
      const updated = await fetcher.put<WikiPage>(
        `${api(tenantId)}/knowledge/texts/${pageId}`,
        { tenantId, attributes: cleaned },
      )
      if (state.value.page?.id === pageId) {
        state.value.page.attributes = updated.attributes ?? {}
      }
      state.value.lastSavedAt = new Date().toISOString()
    } catch (error) {
      state.value.saveError =
        error instanceof Error ? error.message : 'Failed to save attributes'
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

  // ----- move (drag & drop reordering / re-parenting) ---------------------

  /** The section a node lives in; moves are only allowed within one section. */
  const scopeKey = (node: WikiTreeNode): string =>
    node.teamId ? `team:${node.teamId}` : node.tenantWide ? 'org' : 'personal'

  /** Locate a node in the reactive tree: its containing array, parent and index. */
  interface TreeLocation {
    siblings: WikiTreeNode[]
    parent: WikiTreeNode | null
    index: number
  }
  const locate = (id: string): TreeLocation | null => {
    const search = (
      siblings: WikiTreeNode[],
      parent: WikiTreeNode | null,
    ): TreeLocation | null => {
      for (let i = 0; i < siblings.length; i++) {
        const node = siblings[i]!
        if (node.id === id) return { siblings, parent, index: i }
        const hit = search(node.children, node)
        if (hit) return hit
      }
      return null
    }
    const { personal, teams, organisation } = state.value.tree
    return (
      search(personal, null) ??
      search(organisation, null) ??
      teams.reduce<TreeLocation | null>(
        (acc, team) => acc ?? search(team.pages, null),
        null,
      )
    )
  }

  /** True when `ancestorId` is `node` itself or one of its descendants. */
  const containsNode = (node: WikiTreeNode, id: string): boolean => {
    if (node.id === id) return true
    return node.children.some((child) => containsNode(child, id))
  }

  /**
   * Move a page within its sidebar section via drag & drop.
   *
   * `mode` describes the drop relative to `targetId`:
   *   - `before` / `after` — become a sibling before/after the target
   *   - `inside`           — become the target's (last) child
   *
   * The tree is updated optimistically and the new order persisted; on failure
   * we reload from the server to resync. Returns false when the move is invalid
   * (dropping onto itself, into its own subtree, or across sections).
   */
  const movePage = async (
    tenantId: string,
    dragId: string,
    targetId: string,
    mode: 'before' | 'inside' | 'after',
  ): Promise<boolean> => {
    if (dragId === targetId) return false

    const dragLoc = locate(dragId)
    const targetLoc = locate(targetId)
    if (!dragLoc || !targetLoc) return false

    const dragNode = dragLoc.siblings[dragLoc.index]!
    const targetNode = targetLoc.siblings[targetLoc.index]!

    // no cross-section moves, and never drop a page into its own subtree
    if (scopeKey(dragNode) !== scopeKey(targetNode)) return false
    if (containsNode(dragNode, targetId)) return false

    // resolve the destination sibling array, new parent and insert index
    let destSiblings: WikiTreeNode[]
    let newParentId: string | null
    let insertIndex: number
    if (mode === 'inside') {
      destSiblings = targetNode.children
      newParentId = targetNode.id
      insertIndex = destSiblings.length
    } else {
      destSiblings = targetLoc.siblings
      newParentId = targetNode.parentId
      insertIndex = targetLoc.index + (mode === 'after' ? 1 : 0)
    }

    const originalParentId = dragNode.parentId

    // --- optimistic tree update ---
    dragLoc.siblings.splice(dragLoc.index, 1)
    // removing an earlier item from the same array shifts the insert point
    if (dragLoc.siblings === destSiblings && dragLoc.index < insertIndex) {
      insertIndex--
    }
    destSiblings.splice(insertIndex, 0, dragNode)
    dragNode.parentId = newParentId

    const orderedIds = destSiblings.map((n) => n.id)

    try {
      await fetcher.post(`${api(tenantId)}/wiki/${dragId}/move`, {
        parentId: newParentId,
        orderedIds,
      })
      return true
    } catch (error) {
      // resync from the server so the UI never drifts from persisted state
      dragNode.parentId = originalParentId
      await loadTree(tenantId)
      throw error
    }
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
    reloadConfig,
    loadTree,
    findTreeNode,
    loadPage,
    closePage,
    createPage,
    ensurePagePath,
    findChildPageByTitle,
    importFile,
    importUrl,
    importMarkdownTree,
    fetchParserCapabilities,
    uploadImage,
    saveTitle,
    savePageMeta,
    saveAttributes,
    saveBlocks,
    deletePage,
    movePage,
    search,
    getLinks,
    getBacklinks,
    getRelated,
  }
})
