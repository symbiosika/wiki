import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import type { WikiTree, WikiTreeNode } from '@/types/wiki'

/**
 * The sidebar tree is loaded once; pages renamed or moved elsewhere (an AI via
 * the MCP server, another user) must not leave it showing a stale title once
 * the page itself is opened with its current state.
 */
// the app relies on unplugin auto-imports, which vitest does not run
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)

const get = vi.fn()
vi.mock('@/utils/fetcher', () => ({
  fetcher: { get: (url: string) => get(url), post: vi.fn(), put: vi.fn() },
}))

const node = (over: Partial<WikiTreeNode> = {}): WikiTreeNode => ({
  id: 'p1',
  title: '01 Arbeitstreffen',
  parentId: null,
  position: null,
  contentMode: 'blocks',
  teamId: null,
  userId: null,
  tenantWide: true,
  updatedAt: '2026-01-01T00:00:00Z',
  pageType: null,
  publicEffective: false,
  children: [],
  ...over,
})

const tree = (nodes: WikiTreeNode[]): WikiTree =>
  ({ personal: [], teams: [], organisation: nodes }) as unknown as WikiTree

const page = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  title: '01 Arbeitsmeetings',
  parentId: null,
  pageType: null,
  contentMode: 'blocks',
  ...over,
})

const route = (serverTree: WikiTree, serverPage: ReturnType<typeof page>) =>
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/wiki/tree')) return { success: true, data: serverTree }
    if (url.endsWith('/blocks')) return []
    return serverPage
  })

const loadStore = async () => {
  const { useWiki } = await import('./wiki')
  return useWiki()
}

describe('wiki store: tree stays in sync with the opened page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    get.mockReset()
  })

  it('patches the tree title when the page was renamed elsewhere', async () => {
    const wiki = await loadStore()
    wiki.state.tree = tree([node()])
    route(tree([node()]), page())

    await wiki.loadPage('t1', 'p1')

    expect(wiki.state.tree.organisation[0]!.title).toBe('01 Arbeitsmeetings')
    expect(get).not.toHaveBeenCalledWith(expect.stringMatching(/\/wiki\/tree$/))
  })

  it('reloads the tree when the page was moved elsewhere', async () => {
    const wiki = await loadStore()
    wiki.state.tree = tree([node()])
    const moved = tree([
      node({
        id: 'parent',
        title: 'Parent',
        children: [node({ parentId: 'parent' })],
      }),
    ])
    route(moved, page({ parentId: 'parent' }))

    await wiki.loadPage('t1', 'p1')
    await vi.waitFor(() =>
      expect(wiki.state.tree.organisation[0]!.id).toBe('parent'),
    )
  })
})
