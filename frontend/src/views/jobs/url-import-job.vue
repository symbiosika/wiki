<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader
      :title="job?.name || $t('Jobs.urlImport.jobFallback')"
      :back-title="$t('Jobs.title')"
      back-route-name="Jobs"
    >
      <template #actions>
        <SecondaryButton
          :label="$t('Jobs.urlImport.refresh')"
          size="small"
          :disabled="loading"
          @click="reload"
        />
        <Button
          :label="$t('Jobs.urlImport.runNow')"
          size="small"
          :disabled="running || !job"
          @click="runNow"
        >
          <template #icon><IconPlay /></template>
        </Button>
      </template>
    </ManageHeader>

    <div
      v-if="loadError"
      class="text-sm text-surface-500 dark:text-surface-400"
    >
      {{ $t('Jobs.urlImport.notFound') }}
    </div>

    <div v-else-if="job" class="flex flex-col gap-8">
      <!-- settings -->
      <section class="flex flex-col gap-4">
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('Jobs.urlImport.settings') }}
        </h2>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Jobs.urlImport.name') }}
          </label>
          <InputText v-model="settings.name" class="w-full" />
        </div>
        <CronField v-model="settings.cron" />
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Jobs.urlImport.scope') }}
          </label>
          <Select
            v-model="settings.scope"
            :options="scopeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Jobs.urlImport.parentPage') }}
          </label>
          <Select
            v-model="settings.parentId"
            :options="parentOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            show-clear
            :placeholder="$t('Jobs.urlImport.parentPageNone')"
            :empty-message="$t('Jobs.urlImport.parentPageEmpty')"
          />
          <p class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Jobs.urlImport.parentPageHint') }}
          </p>
        </div>
        <label
          class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
        >
          <Checkbox v-model="settings.enabled" binary />
          {{ $t('Jobs.urlImport.enabledLabel') }}
        </label>
        <div>
          <Button
            :label="$t('Common.save')"
            size="small"
            :disabled="savingSettings || !settingsChanged"
            @click="saveSettings"
          />
        </div>
      </section>

      <!-- urls -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2
            class="text-sm font-semibold text-surface-900 dark:text-surface-0"
          >
            {{ $t('Jobs.urlImport.urls') }}
          </h2>
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Jobs.urlImport.urlCount', { count: urls.length }) }}
          </span>
        </div>

        <!-- status list -->
        <ul
          v-if="urls.length"
          class="divide-y divide-surface-100 rounded-lg border border-surface-200 dark:divide-surface-800 dark:border-surface-700"
        >
          <li
            v-for="u in urls"
            :key="u.id"
            class="flex items-center gap-3 px-3 py-2"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="urlStatusDot(u.status)"
              :title="u.status"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <RouterLink
                  v-if="u.knowledgeTextId"
                  :to="{
                    name: 'WikiPage',
                    params: { tenantId, pageId: u.knowledgeTextId },
                  }"
                  class="truncate text-sm text-primary hover:underline"
                >
                  {{ u.title || u.url }}
                </RouterLink>
                <span
                  v-else
                  class="truncate text-sm text-surface-800 dark:text-surface-200"
                >
                  {{ u.title || u.url }}
                </span>
              </div>
              <div
                class="truncate text-xs text-surface-400 dark:text-surface-500"
              >
                {{ u.url }}
              </div>
              <div
                v-if="u.status === 'error' && u.lastError"
                class="mt-0.5 truncate text-xs text-red-500"
                :title="u.lastError"
              >
                {{ u.lastError }}
              </div>
            </div>
            <span
              v-if="u.lastImportedAt"
              class="shrink-0 text-xs text-surface-400 dark:text-surface-500"
            >
              {{ formatDate(u.lastImportedAt) }}
            </span>
          </li>
        </ul>

        <!-- editor -->
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Jobs.urlImport.editUrls') }}
          </label>
          <Textarea
            v-model="urlText"
            rows="6"
            class="w-full font-mono text-sm"
            :placeholder="$t('Jobs.urlImport.urlsPlaceholder')"
            spellcheck="false"
          />
          <p class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Jobs.urlImport.urlsHint') }}
          </p>
        </div>
        <div>
          <Button
            :label="$t('Jobs.urlImport.saveUrls')"
            size="small"
            :disabled="savingUrls || !urlsChanged"
            @click="saveUrls"
          />
        </div>
      </section>

      <!-- runs -->
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('Jobs.urlImport.runs') }}
        </h2>
        <DataTable
          v-if="runs.length"
          :value="runs"
          class="cursor-pointer"
          @row-click="openRun"
        >
          <Column :header="$t('Jobs.urlImport.runStatus')">
            <template #body="{ data }">
              <span class="inline-flex items-center gap-1.5 text-sm">
                <span
                  class="h-2 w-2 rounded-full"
                  :class="runStatusDot(data.status)"
                />
                {{ $t(`Jobs.urlImport.status.${data.status}`) }}
              </span>
            </template>
          </Column>
          <Column :header="$t('Jobs.urlImport.result')">
            <template #body="{ data }">
              <span class="text-sm text-surface-600 dark:text-surface-300">
                {{ data.succeeded }}/{{ data.total }}
                <span v-if="data.failed" class="text-red-500">
                  ({{ data.failed }} {{ $t('Jobs.urlImport.failed') }})
                </span>
              </span>
            </template>
          </Column>
          <Column :header="$t('Jobs.urlImport.trigger')">
            <template #body="{ data }">
              <span class="text-xs text-surface-500 dark:text-surface-400">
                {{ $t(`Jobs.urlImport.triggers.${data.trigger}`) }}
              </span>
            </template>
          </Column>
          <Column :header="$t('Jobs.urlImport.started')">
            <template #body="{ data }">
              <span class="text-xs text-surface-500 dark:text-surface-400">
                {{ formatDate(data.startedAt) }}
              </span>
            </template>
          </Column>
        </DataTable>
        <p v-else class="text-sm text-surface-400 dark:text-surface-500">
          {{ $t('Jobs.urlImport.noRuns') }}
        </p>
      </section>
    </div>

    <!-- run detail dialog -->
    <Dialog
      v-model:visible="runDialog"
      modal
      :header="$t('Jobs.urlImport.runDetail')"
      class="w-[560px] max-w-[92vw]"
    >
      <div v-if="selectedRun" class="flex flex-col gap-3">
        <div class="flex items-center gap-2 text-sm">
          <span
            class="h-2 w-2 rounded-full"
            :class="runStatusDot(selectedRun.status)"
          />
          <span class="font-medium">
            {{ $t(`Jobs.urlImport.status.${selectedRun.status}`) }}
          </span>
          <span class="text-surface-400">·</span>
          <span class="text-surface-600 dark:text-surface-300">
            {{ selectedRun.succeeded }}/{{ selectedRun.total }}
          </span>
        </div>
        <ul
          v-if="selectedRun.results.length"
          class="divide-y divide-surface-100 rounded-lg border border-surface-200 dark:divide-surface-800 dark:border-surface-700"
        >
          <li
            v-for="(r, i) in selectedRun.results"
            :key="i"
            class="flex items-start gap-2 px-3 py-2"
          >
            <span
              class="mt-1 h-2 w-2 shrink-0 rounded-full"
              :class="r.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'"
            />
            <div class="min-w-0 flex-1">
              <div
                class="truncate text-sm text-surface-800 dark:text-surface-200"
              >
                {{ r.url }}
              </div>
              <div v-if="r.error" class="text-xs text-red-500">
                {{ r.error }}
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-surface-400">
          {{ $t('Jobs.urlImport.runEmpty') }}
        </p>
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import IconPlay from '~icons/mdi/play'
import ManageHeader from '@/components/manage/ManageHeader.vue'
import CronField from '@/components/jobs/CronField.vue'
import { useUrlImportJobs } from '@/stores/urlImportJobs'
import { useWiki } from '@/stores/wiki'
import {
  pageOptionsForScope,
  scopeFromFlags,
  flagsFromScope,
  buildScopeOptions,
} from '@/utils/wikiTreeOptions'
import { FetcherError } from '@/utils/fetcher'
import type {
  UrlImportJob,
  UrlImportJobUrl,
  UrlImportRun,
  UrlImportRunStatus,
  UrlImportUrlStatus,
} from '@/types/urlImport'

const route = useRoute()
const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const store = useUrlImportJobs()
const wiki = useWiki()
const app = useApp()

const tenantId = computed(() => String(route.params.tenantId))
const jobId = computed(() => String(route.params.jobId))

const job = ref<UrlImportJob | null>(null)
const urls = ref<UrlImportJobUrl[]>([])
const runs = ref<UrlImportRun[]>([])
const loading = ref(false)
const loadError = ref(false)

const settings = ref<{
  name: string
  cron: string
  enabled: boolean
  scope: string
  parentId: string | null
}>({ name: '', cron: '', enabled: true, scope: 'organisation', parentId: null })
const urlText = ref('')

const scopeOptions = computed(() =>
  buildScopeOptions(app.state.teams, {
    organisation: t('Wiki.scope.organisation'),
    personal: t('Wiki.scope.personal'),
    team: t('Wiki.scope.team'),
  }),
)

// parent-page options within the currently selected scope
const parentOptions = computed(() =>
  pageOptionsForScope(wiki.state.tree, settings.value.scope),
)

const formatDate = (iso: string) => new Date(iso).toLocaleString()

const urlStatusDot = (status: UrlImportUrlStatus) =>
  status === 'success'
    ? 'bg-emerald-500'
    : status === 'error'
      ? 'bg-red-500'
      : 'bg-surface-400'

const runStatusDot = (status: UrlImportRunStatus) => {
  switch (status) {
    case 'success':
      return 'bg-emerald-500'
    case 'partial':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-sky-500'
  }
}

/** Serialize a URL row to a "url" or "url | title" editor line. */
const urlsToText = (list: UrlImportJobUrl[]) =>
  list.map((u) => (u.title ? `${u.url} | ${u.title}` : u.url)).join('\n')

/** Parse editor lines back into {url, title} entries. */
const parseUrlText = (text: string): { url: string; title?: string | null }[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf('|')
      if (sep === -1) return { url: line }
      return {
        url: line.slice(0, sep).trim(),
        title: line.slice(sep + 1).trim() || null,
      }
    })
    .filter((entry) => entry.url.length > 0)

const settingsChanged = computed(
  () =>
    !!job.value &&
    (settings.value.name.trim() !== job.value.name ||
      settings.value.cron.trim() !== job.value.cron ||
      settings.value.enabled !== job.value.enabled ||
      settings.value.scope !== scopeFromFlags(job.value) ||
      (settings.value.parentId ?? null) !== job.value.parentId),
)

const urlsChanged = computed(() => urlText.value !== urlsToText(urls.value))

const applyDetail = (detail: {
  job: UrlImportJob
  urls: UrlImportJobUrl[]
  runs: UrlImportRun[]
}) => {
  job.value = detail.job
  urls.value = detail.urls
  runs.value = detail.runs
  // guard the scope watcher so loading a job doesn't wipe its saved parent page
  applyingDetail = true
  settings.value = {
    name: detail.job.name,
    cron: detail.job.cron,
    enabled: detail.job.enabled,
    scope: scopeFromFlags(detail.job),
    parentId: detail.job.parentId,
  }
  urlText.value = urlsToText(detail.urls)
  nextTick(() => {
    applyingDetail = false
  })
}

// the chosen parent must live in the chosen scope — reset it when the user
// switches scope, but not while a freshly loaded job is being applied
let applyingDetail = false
watch(
  () => settings.value.scope,
  () => {
    if (!applyingDetail) settings.value.parentId = null
  },
)

const reload = async () => {
  loading.value = true
  loadError.value = false
  try {
    // the wiki tree feeds the parent-page picker; teams feed the scope picker
    wiki.loadTree(tenantId.value).catch(() => {})
    app.getTeams().catch(() => {})
    applyDetail(await store.getJob(tenantId.value, jobId.value))
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(jobId, reload, { immediate: true })

const notifyError = (error: unknown, fallback: string) => {
  const detail =
    error instanceof FetcherError && error.body ? error.body : t(fallback)
  toast.add({
    severity: 'error',
    summary: t('Common.error'),
    detail,
    life: 5000,
  })
}

const savingSettings = ref(false)
const saveSettings = async () => {
  savingSettings.value = true
  try {
    const { teamId, tenantWide } = flagsFromScope(settings.value.scope)
    await store.updateJob(tenantId.value, jobId.value, {
      name: settings.value.name.trim(),
      cron: settings.value.cron.trim(),
      enabled: settings.value.enabled,
      teamId,
      tenantWide,
      parentId: settings.value.parentId ?? null,
    })
    await reload()
  } catch (error) {
    notifyError(error, 'Jobs.urlImport.saveError')
  } finally {
    savingSettings.value = false
  }
}

const savingUrls = ref(false)
const saveUrls = async () => {
  savingUrls.value = true
  try {
    await store.setUrls(
      tenantId.value,
      jobId.value,
      parseUrlText(urlText.value),
    )
    await reload()
  } catch (error) {
    notifyError(error, 'Jobs.urlImport.saveError')
  } finally {
    savingUrls.value = false
  }
}

// ----- run now --------------------------------------------------------------

const running = ref(false)
const runNow = async () => {
  if (urls.value.length === 0) {
    confirm.require({
      header: t('Jobs.urlImport.runNow'),
      message: t('Jobs.urlImport.noUrlsWarning'),
      acceptProps: { label: t('Common.close') },
      rejectClass: 'hidden',
    })
    return
  }
  running.value = true
  try {
    await store.runNow(tenantId.value, jobId.value)
    toast.add({
      severity: 'info',
      summary: t('Jobs.urlImport.runStarted'),
      detail: t('Jobs.urlImport.runStartedHint'),
      life: 4000,
    })
    // the run executes async on the queue — poll a few times to reflect it
    scheduleRefreshes()
  } catch (error) {
    notifyError(error, 'Jobs.urlImport.runError')
  } finally {
    running.value = false
  }
}

let refreshTimers: ReturnType<typeof setTimeout>[] = []
const scheduleRefreshes = () => {
  refreshTimers.forEach(clearTimeout)
  refreshTimers = [2000, 5000, 10000].map((ms) =>
    setTimeout(() => reload(), ms),
  )
}

onBeforeUnmount(() => refreshTimers.forEach(clearTimeout))

// ----- run detail -----------------------------------------------------------

const runDialog = ref(false)
const selectedRun = ref<UrlImportRun | null>(null)
const openRun = (event: { data: UrlImportRun }) => {
  selectedRun.value = event.data
  runDialog.value = true
}
</script>
