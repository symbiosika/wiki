<template>
  <aside
    class="flex h-full w-80 max-w-[85vw] shrink-0 flex-col border-r border-surface-200 bg-surface-50 pt-[env(safe-area-inset-top)] lg:w-72 dark:border-surface-800 dark:bg-surface-900"
  >
    <!-- header: organisation → start page -->
    <div class="flex items-center gap-0.5 px-2 pt-3 pb-2">
      <button
        type="button"
        :title="$t('Wiki.goHome')"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-100 active:bg-surface-100 dark:hover:bg-surface-800 dark:active:bg-surface-800"
        @click="goHome"
      >
        <span
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-contrast"
        >
          {{ tenantInitial }}
        </span>
        <span
          class="truncate text-sm font-semibold text-surface-900 dark:text-surface-0"
        >
          {{ app.currentTenant?.name ?? $t('Wiki.appName') }}
        </span>
      </button>

      <!-- switch organisation (only if the user has several) -->
      <button
        v-if="app.state.tenants.length > 1"
        type="button"
        :title="$t('Wiki.switchTenant')"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 lg:h-7 lg:w-7 dark:hover:bg-surface-800 dark:hover:text-surface-300"
        @click="tenantMenuRef?.toggle($event)"
      >
        <IconChevronDown class="h-4 w-4" />
      </button>

      <!-- desktop: collapse -->
      <button
        type="button"
        :title="$t('Wiki.collapseSidebar')"
        class="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 lg:flex dark:hover:bg-surface-800 dark:hover:text-surface-300"
        @click="layout.toggleCollapsed()"
      >
        <IconPanelLeft class="h-4 w-4" />
      </button>

      <!-- mobile: close drawer -->
      <button
        type="button"
        :aria-label="$t('Wiki.closeMenu')"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors active:bg-surface-100 lg:hidden dark:active:bg-surface-800"
        @click="layout.closeSidebar()"
      >
        <IconClose class="h-5 w-5" />
      </button>
    </div>

    <Menu ref="tenantMenuRef" :model="tenantMenuItems" popup>
      <template #item="{ item, props: itemProps }">
        <a v-bind="itemProps.action" class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary"
          >
            {{
              String(item.label ?? '?')
                .trim()[0]
                ?.toUpperCase()
            }}
          </span>
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          <IconCheck
            v-if="item.tenantId === app.state.selectedTenant"
            class="h-4 w-4 shrink-0 text-primary"
          />
        </a>
      </template>
    </Menu>

    <!-- search -->
    <div class="relative px-3 py-2 pt-1">
      <IconMagnify
        class="pointer-events-none absolute top-1/2 left-5 h-4 w-4 -translate-y-1/2 text-surface-400"
      />
      <input
        v-model="searchQuery"
        type="search"
        :placeholder="$t('Wiki.search')"
        class="w-full rounded-md border border-surface-200 bg-surface-0 py-2 pr-2 pl-8 text-base text-surface-800 outline-none placeholder:text-surface-400 focus:border-primary lg:py-1.5 lg:text-sm dark:border-surface-700 dark:bg-surface-950 dark:text-surface-200"
      />
    </div>

    <!--
      Read-only / edit mode indicator.

      Sits right under the search so the current mode is always visible above
      the (scrolling) tree. Read-only is the default, "safe" state, so it is
      deliberately loud — a filled primary bar reading "Read-only mode" — and
      is easy to spot and click. Once editing, it turns into a quiet, border-
      only chip so it stops competing for attention while you work.
    -->
    <div class="px-3 pb-2">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
        :class="
          readOnly.readOnly
            ? 'bg-primary font-semibold text-primary-contrast hover:bg-primary-emphasis'
            : 'border border-surface-200 text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200'
        "
        :title="
          readOnly.readOnly
            ? $t('Wiki.readonly.enableEditing')
            : $t('Wiki.readonly.enableReadOnly')
        "
        @click="readOnly.toggle()"
      >
        <IconLock v-if="readOnly.readOnly" class="h-4 w-4 shrink-0" />
        <IconPencil v-else class="h-4 w-4 shrink-0" />
        <span class="flex-1 text-left">
          {{
            readOnly.readOnly
              ? $t('Wiki.readonly.readOnlyMode')
              : $t('Wiki.readonly.editMode')
          }}
        </span>
      </button>
    </div>

    <!-- search results -->
    <div
      v-if="searchQuery.trim()"
      class="flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
    >
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
        class="block w-full rounded-md px-2 py-2 text-left hover:bg-surface-100 active:bg-surface-100 lg:py-1.5 dark:hover:bg-surface-800 dark:active:bg-surface-800"
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
    <nav v-else class="flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
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
          @move="onMove"
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
            @move="onMove"
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
          @move="onMove"
        />
        <p
          v-if="!wiki.state.tree.organisation.length"
          class="px-2 py-1 text-xs text-surface-400 dark:text-surface-500"
        >
          {{ $t('Wiki.noPagesYet') }}
        </p>
      </WikiSidebarSection>
    </nav>

    <!-- footer: actions + account, collapsed by default so the tree gets the space -->
    <div class="border-t border-surface-200 dark:border-surface-800">
      <div v-show="footerExpanded" class="flex flex-col gap-2 px-3 pt-2 pb-1">
        <!-- open AI chat -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-emphasis"
          @click="aiChat.open()"
        >
          <IconChat class="h-4 w-4 shrink-0" />
          <span class="flex-1 text-left">{{ $t('Chat.chatWithAi') }}</span>
        </button>

        <!-- record daily protocol -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 active:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 dark:active:bg-surface-800"
          @click="protocol.openDialog()"
        >
          <IconMicrophone class="h-4 w-4" />
          {{ $t('Protocol.recordButton') }}
        </button>

        <!-- import a page from a file or URL -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 active:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 dark:active:bg-surface-800"
          @click="wiki.openImportDialog()"
        >
          <IconUpload class="h-4 w-4" />
          {{ $t('Wiki.import.button') }}
        </button>

        <!-- jobs (scheduled automations) -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
          :class="
            isJobsActive
              ? 'bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-surface-0'
              : 'text-surface-600 hover:bg-surface-100 active:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 dark:active:bg-surface-800'
          "
          @click="gotoJobs"
        >
          <IconJobs class="h-4 w-4" />
          {{ $t('Jobs.menu') }}
        </button>

        <!-- inbox (user notification queue) with unread chip -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
          :class="
            isNotificationsActive
              ? 'bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-surface-0'
              : 'text-surface-600 hover:bg-surface-100 active:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 dark:active:bg-surface-800'
          "
          @click="gotoNotifications"
        >
          <IconInbox class="h-4 w-4" />
          <span class="flex-1 text-left">{{ $t('Notifications.menu') }}</span>
          <span
            v-if="notifications.unreadCount > 0"
            class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-contrast"
          >
            {{
              notifications.unreadCount > 99 ? '99+' : notifications.unreadCount
            }}
          </span>
        </button>

        <!-- account: set apart from the actions above by a divider -->
        <div class="my-1 border-t border-surface-200 dark:border-surface-800" />

        <button
          type="button"
          :title="$t('Profile.title')"
          class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-100 active:bg-surface-100 dark:hover:bg-surface-800 dark:active:bg-surface-800"
          @click="gotoProfile"
        >
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
            :class="
              app.state.user?.profileImageName
                ? 'bg-transparent'
                : 'bg-primary text-primary-contrast'
            "
          >
            <img
              v-if="app.state.user?.profileImageName"
              :src="profileImageUrl"
              alt=""
              class="h-full w-full object-cover"
            />
            <template v-else>{{ userInitials }}</template>
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm text-surface-600 dark:text-surface-300"
          >
            {{ app.state.user?.email }}
          </span>
        </button>

        <button
          type="button"
          class="relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 active:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 dark:active:bg-surface-800"
          @click="gotoManage"
        >
          <IconCog class="h-4 w-4" />
          {{ $t('Wiki.manage') }}
          <span
            v-if="app.state.tenantInvitations.length > 0"
            class="absolute top-1.5 left-6 h-2 w-2 rounded-full bg-primary"
            :title="$t('UserTenants.invitations.openInvitations')"
          />
        </button>

        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 active:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 dark:active:bg-surface-800"
          @click="auth.logout()"
        >
          <IconLogout class="h-4 w-4" />
          {{ $t('Wiki.logout') }}
        </button>
      </div>

      <!-- slide-out toggle: the only thing visible here by default -->
      <button
        type="button"
        :title="
          footerExpanded ? $t('Wiki.collapseActions') : $t('Wiki.expandActions')
        "
        class="relative flex w-full items-center justify-center px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 active:bg-surface-100 dark:hover:bg-surface-800 dark:hover:text-surface-300 dark:active:bg-surface-800"
        @click="toggleFooterExpanded"
      >
        <IconChevronUp
          class="h-4 w-4 shrink-0 transition-transform"
          :class="{ 'rotate-180': footerExpanded }"
        />
        <span
          v-if="!footerExpanded && notifications.unreadCount > 0"
          class="absolute top-2.5 right-3 flex items-center"
        >
          <span class="relative flex items-center justify-center">
            <IconInbox class="h-4 w-4" />
            <span
              class="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-contrast"
            >
              {{
                notifications.unreadCount > 99
                  ? '99+'
                  : notifications.unreadCount
              }}
            </span>
          </span>
        </span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import IconMagnify from '~icons/mdi/magnify'
import IconChat from '~icons/mdi/robot-happy-outline'
import IconMicrophone from '~icons/mdi/microphone'
import IconUpload from '~icons/mdi/tray-arrow-up'
import IconJobs from '~icons/mdi/calendar-sync-outline'
import IconInbox from '~icons/mdi/inbox-arrow-down-outline'
import IconLogout from '~icons/mdi/logout'
import IconCog from '~icons/mdi/cog-outline'
import IconChevronDown from '~icons/mdi/chevron-down'
import IconCheck from '~icons/mdi/check'
import IconClose from '~icons/mdi/close'
import IconPanelLeft from '~icons/mdi/dock-left'
import IconChevronUp from '~icons/mdi/chevron-up'
import IconLock from '~icons/mdi/lock-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import type {
  WikiMovePayload,
  WikiScope,
  WikiSearchResult,
  WikiTreeNode,
} from '@/types/wiki'

const app = useApp()
const protocol = useProtocol()
const auth = useAuthStore()
const wiki = useWiki()
const notifications = useNotificationsStore()
const readOnly = useReadOnly()
const aiChat = useAiChat()
const layout = useLayout()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()
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

// ----- header: organisation ------------------------------------------------

const tenantInitial = computed(
  () => app.currentTenant?.name?.trim()?.[0]?.toUpperCase() ?? 'W',
)

const goHome = () => {
  router.push({ name: 'Wiki', params: { tenantId: tenantId.value } })
}

const tenantMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)

const tenantMenuItems = computed(() =>
  app.state.tenants.map((tenant) => ({
    label: tenant.name,
    tenantId: tenant.id,
    command: () => switchTenant(tenant.id),
  })),
)

// ----- expansion state (shared with WikiTreeItem via provide) --------------

const expandedIds = ref(new Set<string>())
provide('wikiExpandedIds', expandedIds)

// ----- drag & drop (shared drag state + move handler) ----------------------

/** The page currently being dragged (null while idle). Read by WikiTreeItem. */
const dragState = ref<{ id: string; scopeKey: string } | null>(null)
provide('wikiDragState', dragState)

const onMove = async (payload: WikiMovePayload) => {
  try {
    const moved = await wiki.movePage(
      tenantId.value,
      payload.dragId,
      payload.targetId,
      payload.mode,
    )
    // reveal the moved page when it was dropped into a (possibly collapsed) parent
    if (moved && payload.mode === 'inside') {
      expandedIds.value = new Set([...expandedIds.value, payload.targetId])
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Wiki.moveError'),
      life: 5000,
    })
  }
}

// ----- footer: actions/account drawer, collapsed by default, persisted -----

const FOOTER_EXPANDED_KEY = 'wiki:sidebar-footer-expanded'
const footerExpanded = ref(localStorage.getItem(FOOTER_EXPANDED_KEY) === '1')
const toggleFooterExpanded = () => {
  footerExpanded.value = !footerExpanded.value
  localStorage.setItem(FOOTER_EXPANDED_KEY, footerExpanded.value ? '1' : '0')
}

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
  // A brand-new page is empty and exists to be written in, so drop out of the
  // (default) global read-only mode and open it ready to edit — otherwise the
  // user lands on a locked, blank page and has to hunt for the mode toggle.
  readOnly.setReadOnly(false)
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
      searchResults.value = await wiki.search(
        tenantId.value,
        query,
        app.state.searchMode,
      )
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
  if (newTenantId === app.state.selectedTenant) return
  await app.setSelectedTenant(newTenantId)
  router.push({ name: 'Wiki', params: { tenantId: newTenantId } })
}

const gotoManage = () => {
  router.push({ name: 'Tenants', params: { tenantId: tenantId.value } })
}

const gotoProfile = () => {
  router.push({ name: 'Profile', params: { tenantId: tenantId.value } })
}

const profileImageUrl = '/api/v1/user/profile-image'

const isJobsActive = computed(
  () =>
    String(route.name ?? '').startsWith('Jobs') ||
    String(route.name ?? '').startsWith('UrlImportJob'),
)

const gotoJobs = () => {
  router.push({ name: 'Jobs', params: { tenantId: tenantId.value } })
}

const isNotificationsActive = computed(
  () => String(route.name ?? '') === 'Notifications',
)

const gotoNotifications = () => {
  router.push({ name: 'Notifications', params: { tenantId: tenantId.value } })
}

// open invitations are surfaced as a badge on the manage button
onMounted(() => {
  app.getTenantInvitations().catch(() => {})
})
</script>
