<template>
  <!-- loading: tree not ready yet -->
  <div v-if="loading" class="flex h-full items-center justify-center">
    <ProgressSpinner class="h-10 w-10" />
  </div>

  <!-- empty wiki: keep the original welcome / create-first-page state -->
  <div
    v-else-if="isEmpty"
    class="flex h-full flex-col items-center justify-center gap-3 px-6"
  >
    <div
      class="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-100 text-3xl dark:bg-surface-800"
    >
      📖
    </div>
    <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-0">
      {{ $t('Wiki.emptyState.title') }}
    </h1>
    <p
      class="max-w-sm text-center text-sm text-surface-500 dark:text-surface-400"
    >
      {{ $t('Wiki.emptyState.subtitle') }}
    </p>
    <div class="mt-2 flex flex-col items-center gap-2 sm:flex-row">
      <Button @click="createFirstPage">
        {{ $t('Wiki.emptyState.createFirst') }}
      </Button>
      <SecondaryButton
        :label="$t('Protocol.recordButton')"
        @click="protocol.openDialog()"
      >
        <template #icon><IconMicrophone class="h-4 w-4" /></template>
      </SecondaryButton>
    </div>
  </div>

  <!-- dashboard -->
  <div v-else class="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
    <!-- ask the assistant: the fastest way to an answer, so it comes first -->
    <AskDashboardCard :tenant-id="tenantId" class="mb-8" />

    <!-- header: greeting + quick actions -->
    <header
      class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div class="min-w-0">
        <h1
          class="truncate text-2xl font-semibold text-surface-900 dark:text-surface-0"
        >
          {{ greeting }}
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {{ $t('Wiki.dashboard.subtitle') }}
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <SecondaryButton
          size="small"
          :label="$t('Wiki.import.button')"
          @click="wiki.openImportDialog()"
        >
          <template #icon><IconImport class="h-4 w-4" /></template>
        </SecondaryButton>
        <SecondaryButton
          size="small"
          :label="$t('Protocol.recordButton')"
          @click="protocol.openDialog()"
        >
          <template #icon><IconMicrophone class="h-4 w-4" /></template>
        </SecondaryButton>
      </div>
    </header>

    <!-- areas the user belongs to -->
    <section class="mb-10">
      <h2
        class="mb-3 text-[13px] font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-400"
      >
        {{ $t('Wiki.dashboard.areas') }}
      </h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <button
          v-for="area in areas"
          :key="area.key"
          type="button"
          :disabled="!area.newestId"
          class="group flex flex-col items-start gap-3 rounded-xl border border-surface-200 bg-surface-0 p-4 text-left transition-colors dark:border-surface-800 dark:bg-surface-900"
          :class="
            area.newestId
              ? 'hover:border-primary/50 hover:bg-surface-50 dark:hover:bg-surface-800/60'
              : 'cursor-default opacity-70'
          "
          @click="openArea(area)"
        >
          <span
            class="flex h-10 w-10 items-center justify-center rounded-lg text-lg text-primary"
            :class="area.tint"
          >
            <component :is="area.icon" class="h-5 w-5" />
          </span>
          <span class="min-w-0 w-full">
            <span
              class="block truncate text-sm font-semibold text-surface-900 dark:text-surface-0"
            >
              {{ area.label }}
            </span>
            <span
              class="mt-0.5 block text-xs text-surface-500 dark:text-surface-400"
            >
              {{
                area.count === 0
                  ? $t('Wiki.noPagesYet')
                  : $t(
                      'Wiki.dashboard.pageCount',
                      { count: area.count },
                      area.count,
                    )
              }}
            </span>
          </span>
        </button>
      </div>
    </section>

    <!-- recently updated pages -->
    <section>
      <h2
        class="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-400"
      >
        <IconClock class="h-4 w-4" />
        {{ $t('Wiki.dashboard.recent') }}
      </h2>

      <p
        v-if="!recentPages.length"
        class="rounded-xl border border-dashed border-surface-200 px-4 py-6 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400"
      >
        {{ $t('Wiki.dashboard.noRecent') }}
      </p>

      <ul
        v-else
        class="divide-y divide-surface-100 overflow-hidden rounded-xl border border-surface-200 dark:divide-surface-800 dark:border-surface-800"
      >
        <li v-for="page in recentPages" :key="page.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-800/60"
            @click="openPage(page.id)"
          >
            <IconFile
              class="h-5 w-5 shrink-0 text-surface-400 dark:text-surface-500"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block truncate text-sm font-medium text-surface-900 dark:text-surface-0"
              >
                {{ page.title || $t('Wiki.untitled') }}
              </span>
            </span>
            <span
              class="hidden shrink-0 rounded-full bg-surface-100 px-2.5 py-0.5 text-xs font-medium text-surface-600 sm:inline dark:bg-surface-800 dark:text-surface-300"
            >
              {{ page.areaLabel }}
            </span>
            <span
              class="shrink-0 text-xs text-surface-400 dark:text-surface-500"
              :title="formatExact(page.updatedAt)"
            >
              {{ formatRelative(page.updatedAt) }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import IconMicrophone from '~icons/mdi/microphone'
import IconImport from '~icons/mdi/tray-arrow-down'
import IconClock from '~icons/mdi/clock-outline'
import IconFile from '~icons/mdi/file-document-outline'
import IconAccount from '~icons/mdi/account-outline'
import IconTeam from '~icons/mdi/account-group-outline'
import IconOrg from '~icons/mdi/office-building-outline'
import {
  parseServerDate,
  formatExactDateTime,
  formatRelativeIntl,
} from '@/utils/date'
import AskDashboardCard from '@/components/ask/AskDashboardCard.vue'
import type { WikiTreeNode } from '@/types/wiki'

/**
 * Wiki start page: a lightweight dashboard that surfaces the areas the user
 * belongs to and the pages they most recently touched, so opening the wiki
 * lands on something useful instead of a blank screen. Everything is derived
 * from the sidebar tree the app already loads — no extra API calls.
 */
const app = useApp()
const wiki = useWiki()
const protocol = useProtocol()
const readOnly = useReadOnly()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const tenantId = computed(() => String(route.params.tenantId))

const loading = computed(() => wiki.state.treeLoading && isEmpty.value)

// ----- derived tree data ----------------------------------------------------

interface RecentEntry {
  id: string
  title: string
  updatedAt: string
  areaLabel: string
}

/** Depth-first walk yielding every page in a section, tagged with its area. */
const collect = (
  nodes: WikiTreeNode[],
  areaLabel: string,
  acc: RecentEntry[],
): void => {
  for (const node of nodes) {
    acc.push({
      id: node.id,
      title: node.title,
      updatedAt: node.updatedAt,
      areaLabel,
    })
    if (node.children.length) collect(node.children, areaLabel, acc)
  }
}

const countNodes = (nodes: WikiTreeNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0)

/** Flat list of every page the user can see, each tagged with its area. */
const allPages = computed<RecentEntry[]>(() => {
  const tree = wiki.state.tree
  const acc: RecentEntry[] = []
  collect(tree.personal, t('Wiki.personal'), acc)
  for (const team of tree.teams) collect(team.pages, team.name, acc)
  collect(tree.organisation, t('Wiki.organisation'), acc)
  return acc
})

const isEmpty = computed(() => allPages.value.length === 0)

/** Newest 12 pages across all areas, most recently edited first. */
const recentPages = computed(() =>
  [...allPages.value]
    .sort(
      (a, b) =>
        (parseServerDate(b.updatedAt)?.getTime() ?? 0) -
        (parseServerDate(a.updatedAt)?.getTime() ?? 0),
    )
    .slice(0, 12),
)

interface AreaCard {
  key: string
  label: string
  icon: unknown
  tint: string
  count: number
  /** id of the area's most recently edited page, for jump-in on click */
  newestId: string | null
}

/** Newest page id within a section (or null when it has none). */
const newestIdOf = (nodes: WikiTreeNode[]): string | null => {
  const acc: RecentEntry[] = []
  collect(nodes, '', acc)
  if (!acc.length) return null
  return (
    acc.reduce((newest, page) =>
      (parseServerDate(page.updatedAt)?.getTime() ?? 0) >
      (parseServerDate(newest.updatedAt)?.getTime() ?? 0)
        ? page
        : newest,
    ).id ?? null
  )
}

const areas = computed<AreaCard[]>(() => {
  const tree = wiki.state.tree
  const cards: AreaCard[] = [
    {
      key: 'personal',
      label: t('Wiki.personal'),
      icon: IconAccount,
      tint: 'bg-primary/10',
      count: countNodes(tree.personal),
      newestId: newestIdOf(tree.personal),
    },
  ]
  for (const team of tree.teams) {
    cards.push({
      key: `team:${team.teamId}`,
      label: team.name,
      icon: IconTeam,
      tint: 'bg-primary/10',
      count: countNodes(team.pages),
      newestId: newestIdOf(team.pages),
    })
  }
  cards.push({
    key: 'organisation',
    label: t('Wiki.organisation'),
    icon: IconOrg,
    tint: 'bg-primary/10',
    count: countNodes(tree.organisation),
    newestId: newestIdOf(tree.organisation),
  })
  return cards
})

// ----- greeting -------------------------------------------------------------

const greeting = computed(() => {
  const name = app.state.user?.firstname?.trim()
  return name
    ? t('Wiki.dashboard.greetingNamed', { name })
    : t('Wiki.dashboard.greeting')
})

// ----- date formatting ------------------------------------------------------

const formatExact = (value: string): string =>
  formatExactDateTime(value, locale.value)

const formatRelative = (value: string): string =>
  formatRelativeIntl(value, locale.value)

// ----- navigation & actions -------------------------------------------------

const openPage = (pageId: string) => {
  router.push({
    name: 'WikiPage',
    params: { tenantId: tenantId.value, pageId },
  })
}

const openArea = (area: AreaCard) => {
  if (area.newestId) openPage(area.newestId)
}

const createFirstPage = async () => {
  const page = await wiki.createPage(tenantId.value, { kind: 'personal' })
  // a fresh, empty page exists to be written in — drop out of read-only mode
  readOnly.setReadOnly(false)
  openPage(page.id)
}

// The sidebar loads the tree on tenant change, but the dashboard can mount
// before that (or with the sidebar collapsed on mobile), so ensure it's here.
onMounted(() => {
  if (tenantId.value && isEmpty.value && !wiki.state.treeLoading) {
    wiki.loadTree(tenantId.value)
  }
})
</script>
