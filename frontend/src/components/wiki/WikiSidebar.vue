<template>
  <aside
    class="flex h-full w-72 shrink-0 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900"
  >
    <!-- header -->
    <div class="flex items-center gap-2 px-4 pt-4 pb-2">
      <span
        class="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-contrast"
      >
        W
      </span>
      <span
        class="truncate text-sm font-semibold text-surface-900 dark:text-surface-0"
      >
        {{ $t('Wiki.appName') }}
      </span>
    </div>

    <!-- tenant switcher (only if the user has several organisations) -->
    <div v-if="app.state.tenants.length > 1" class="px-3 pb-1">
      <select
        :value="app.state.selectedTenant"
        class="w-full cursor-pointer rounded-md border border-surface-200 bg-surface-0 px-2 py-1.5 text-sm text-surface-800 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-200"
        :aria-label="$t('Wiki.tenant')"
        @change="switchTenant(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="tenant in app.state.tenants"
          :key="tenant.id"
          :value="tenant.id"
        >
          {{ tenant.name }}
        </option>
      </select>
    </div>

    <!-- search -->
    <div class="relative px-3 py-2">
      <IconMagnify
        class="pointer-events-none absolute top-1/2 left-5 h-4 w-4 -translate-y-1/2 text-surface-400"
      />
      <input
        v-model="searchQuery"
        type="search"
        :placeholder="$t('Wiki.search')"
        class="w-full rounded-md border border-surface-200 bg-surface-0 py-1.5 pr-2 pl-8 text-sm text-surface-800 outline-none placeholder:text-surface-400 focus:border-primary dark:border-surface-700 dark:bg-surface-950 dark:text-surface-200"
      />
    </div>

    <!-- search results -->
    <div v-if="searchQuery.trim()" class="flex-1 overflow-y-auto px-2 pb-4">
      <div
        v-if="searchResults.length === 0 && !searchPending"
        class="px-2 py-2 text-sm text-surface-500 dark:text-surface-400"
      >
        {{ $t('Wiki.searchNoResults') }}
      </div>
      <button
        v-for="result in searchResults"
        :key="result.id"
        type="button"
        class="block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-100 dark:hover:bg-surface-800"
        @click="openSearchResult(result)"
      >
        <span
          class="block truncate text-sm text-surface-800 dark:text-surface-200"
        >
          {{ result.title || $t('Wiki.untitled') }}
        </span>
        <span
          v-if="result.snippet"
          class="block truncate text-xs text-surface-500 dark:text-surface-400"
        >
          {{ result.snippet }}
        </span>
      </button>
    </div>

    <!-- tree -->
    <nav v-else class="flex-1 overflow-y-auto px-2 pb-4">
      <!-- Personal -->
      <WikiSidebarSection
        :label="$t('Wiki.personal')"
        section-key="personal"
        :collapsed="collapsedSections.has('personal')"
        @toggle="toggleSection('personal')"
        @add="createPage({ kind: 'personal' })"
      >
        <WikiTreeItem
          v-for="node in wiki.state.tree.personal"
          :key="node.id"
          :node="node"
          @add-child="addChild"
          @delete="confirmDelete"
        />
        <p
          v-if="!wiki.state.tree.personal.length"
          class="px-2 py-1 text-xs text-surface-400 dark:text-surface-500"
        >
          {{ $t('Wiki.noPagesYet') }}
        </p>
      </WikiSidebarSection>

      <!-- Teams (one sub headline per team) -->
      <template v-if="wiki.state.tree.teams.length">
        <div
          class="mt-4 px-2 text-[11px] font-semibold tracking-wider text-surface-400 uppercase dark:text-surface-500"
        >
          {{ $t('Wiki.teams') }}
        </div>
        <WikiSidebarSection
          v-for="team in wiki.state.tree.teams"
          :key="team.teamId"
          :label="team.name"
          :section-key="`team:${team.teamId}`"
          nested
          :collapsed="collapsedSections.has(`team:${team.teamId}`)"
          @toggle="toggleSection(`team:${team.teamId}`)"
          @add="createPage({ kind: 'team', teamId: team.teamId })"
        >
          <WikiTreeItem
            v-for="node in team.pages"
            :key="node.id"
            :node="node"
            @add-child="addChild"
            @delete="confirmDelete"
          />
          <p
            v-if="!team.pages.length"
            class="px-2 py-1 text-xs text-surface-400 dark:text-surface-500"
          >
            {{ $t('Wiki.noPagesYet') }}
          </p>
        </WikiSidebarSection>
      </template>

      <!-- Organisation -->
      <WikiSidebarSection
        :label="$t('Wiki.organisation')"
        section-key="organisation"
        :collapsed="collapsedSections.has('organisation')"
        @toggle="toggleSection('organisation')"
        @add="createPage({ kind: 'organisation' })"
      >
        <WikiTreeItem
          v-for="node in wiki.state.tree.organisation"
          :key="node.id"
          :node="node"
          @add-child="addChild"
          @delete="confirmDelete"
        />
        <p
          v-if="!wiki.state.tree.organisation.length"
          class="px-2 py-1 text-xs text-surface-400 dark:text-surface-500"
        >
          {{ $t('Wiki.noPagesYet') }}
        </p>
      </WikiSidebarSection>
    </nav>

    <!-- footer: user -->
    <div
      class="flex items-center gap-2 border-t border-surface-200 px-4 py-3 dark:border-surface-800"
    >
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-contrast"
      >
        {{ userInitials }}
      </span>
      <span
        class="min-w-0 flex-1 truncate text-sm text-surface-700 dark:text-surface-300"
      >
        {{ app.state.user?.email }}
      </span>
      <button
        type="button"
        :title="$t('Wiki.manage')"
        class="relative flex h-7 w-7 items-center justify-center rounded text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
        @click="gotoManage"
      >
        <IconCog class="h-4 w-4" />
        <span
          v-if="app.state.tenantInvitations.length > 0"
          class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary"
          :title="$t('UserTenants.invitations.openInvitations')"
        />
      </button>
      <button
        type="button"
        :title="$t('Wiki.logout')"
        class="flex h-7 w-7 items-center justify-center rounded text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
        @click="auth.logout()"
      >
        <IconLogout class="h-4 w-4" />
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useConfirm } from 'primevue/useconfirm'
import IconMagnify from '~icons/mdi/magnify'
import IconLogout from '~icons/mdi/logout'
import IconCog from '~icons/mdi/cog-outline'
import type {
  WikiScope,
  WikiSearchResult,
  WikiTreeNode,
} from '@/types/wiki'

const app = useApp()
const auth = useAuthStore()
const wiki = useWiki()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const { t } = useI18n()

const tenantId = computed(() => String(route.params.tenantId ?? ''))

// (re)load the tree whenever the tenant context changes
watch(
  tenantId,
  (id) => {
    if (id) wiki.loadTree(id)
  },
  { immediate: true },
)

// ----- expansion state (shared with WikiTreeItem via provide) --------------

const expandedIds = ref(new Set<string>())
provide('wikiExpandedIds', expandedIds)

const collapsedSections = ref(new Set<string>())
const toggleSection = (key: string) => {
  const next = new Set(collapsedSections.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  collapsedSections.value = next
}

/** expand all ancestors of the currently open page */
const expandAncestors = (pageId: string) => {
  const next = new Set(expandedIds.value)
  let node = wiki.findTreeNode(pageId)
  while (node?.parentId) {
    next.add(node.parentId)
    node = wiki.findTreeNode(node.parentId)
  }
  expandedIds.value = next
}

watch(
  () => [route.params.pageId, wiki.state.treeLoading] as const,
  ([pageId, loading]) => {
    if (pageId && !loading) expandAncestors(String(pageId))
  },
  { immediate: true },
)

// ----- create / delete ------------------------------------------------------

const createPage = async (scope: WikiScope, parentId?: string) => {
  const page = await wiki.createPage(tenantId.value, scope, { parentId })
  if (parentId) {
    expandedIds.value = new Set([...expandedIds.value, parentId])
  }
  router.push({
    name: 'WikiPage',
    params: { tenantId: tenantId.value, pageId: page.id },
  })
}

const addChild = (node: WikiTreeNode) => {
  const scope: WikiScope = node.teamId
    ? { kind: 'team', teamId: node.teamId }
    : node.tenantWide
      ? { kind: 'organisation' }
      : { kind: 'personal' }
  createPage(scope, node.id)
}

const confirmDelete = (node: WikiTreeNode) => {
  confirm.require({
    header: t('Wiki.deletePageHeader'),
    message: t('Wiki.deletePageConfirm', {
      title: node.title || t('Wiki.untitled'),
    }),
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    rejectProps: { label: t('Common.cancel') },
    accept: async () => {
      const wasOpen = route.params.pageId === node.id
      await wiki.deletePage(tenantId.value, node.id)
      if (wasOpen) {
        router.push({ name: 'Wiki', params: { tenantId: tenantId.value } })
      }
    },
  })
}

// ----- search ---------------------------------------------------------------

const searchQuery = ref('')
const searchResults = ref<WikiSearchResult[]>([])
const searchPending = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(searchQuery, (query) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (!query.trim()) {
    searchResults.value = []
    return
  }
  searchPending.value = true
  searchTimer = setTimeout(async () => {
    try {
      searchResults.value = await wiki.search(tenantId.value, query)
    } finally {
      searchPending.value = false
    }
  }, 250)
})

const openSearchResult = (result: WikiSearchResult) => {
  searchQuery.value = ''
  router.push({
    name: 'WikiPage',
    params: { tenantId: tenantId.value, pageId: result.id },
  })
}

// ----- misc -----------------------------------------------------------------

const userInitials = computed(() => {
  const user = app.state.user
  const first = user?.firstname?.[0] ?? user?.email?.[0] ?? '?'
  const last = user?.surname?.[0] ?? ''
  return (first + last).toUpperCase()
})

const switchTenant = async (newTenantId: string) => {
  await app.setSelectedTenant(newTenantId)
  router.push({ name: 'Wiki', params: { tenantId: newTenantId } })
}

const gotoManage = () => {
  router.push({ name: 'Tenants', params: { tenantId: tenantId.value } })
}

// open invitations are surfaced as a badge on the manage button
onMounted(() => {
  app.getTenantInvitations().catch(() => {})
})
</script>
