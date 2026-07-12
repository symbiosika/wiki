import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { blocksAreEqual } from '@/utils/wikiBlocks'
import type {
  WikiBlock,
  WikiPage,
  WikiScope,
  WikiSearchResult,
  WikiTree,
  WikiTreeNode,
} from '@/types/wiki'

interface WikiState {
  tree: WikiTree
  treeLoading: boolean
  page: WikiPage | null
  blocks: WikiBlock[]
  pageLoading: boolean
  saving: boolean
  lastSavedAt: string | null
  saveError: string | null
}

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
  })

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
  ): Promise<WikiSearchResult[]> => {
    if (!query.trim()) return []
    return await fetcher.get<WikiSearchResult[]>(
      `${api(tenantId)}/knowledge/texts/search?q=${encodeURIComponent(query)}&mode=fulltext`,
    )
  }

  return {
    state,
    loadTree,
    findTreeNode,
    loadPage,
    closePage,
    createPage,
    saveTitle,
    saveBlocks,
    deletePage,
    search,
  }
})
