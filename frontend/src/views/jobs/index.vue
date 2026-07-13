<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('Jobs.title')">
      <template #actions>
        <Button
          :label="$t('Jobs.urlImport.addJob')"
          size="small"
          @click="openCreate"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </template>
    </ManageHeader>

    <!-- tabs (only one job type today, but structured for more) -->
    <div
      class="mb-6 flex gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-700"
    >
      <button
        type="button"
        class="shrink-0 border-b-2 border-primary px-4 py-2.5 text-sm font-medium whitespace-nowrap text-primary sm:py-2"
      >
        {{ $t('Jobs.urlImport.tab') }}
      </button>
    </div>

    <!-- list -->
    <DataTable
      v-if="!store.loading && store.jobs.length > 0"
      :value="store.jobs"
      class="cursor-pointer"
      @row-click="openJob"
    >
      <Column :header="$t('Jobs.urlImport.name')">
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="
                data.enabled
                  ? 'bg-emerald-500'
                  : 'bg-surface-300 dark:bg-surface-600'
              "
              :title="
                data.enabled
                  ? $t('Jobs.urlImport.enabled')
                  : $t('Jobs.urlImport.disabled')
              "
            />
            <span class="font-medium text-surface-900 dark:text-surface-0">
              {{ data.name }}
            </span>
          </div>
        </template>
      </Column>
      <Column :header="$t('Jobs.urlImport.schedule')">
        <template #body="{ data }">
          <code class="text-xs text-surface-600 dark:text-surface-300">
            {{ data.cron }}
          </code>
        </template>
      </Column>
      <Column :header="$t('Jobs.urlImport.lastRun')">
        <template #body="{ data }">
          <span
            v-if="data.lastRunAt"
            class="inline-flex items-center gap-1.5 text-xs"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="runStatusDot(data.lastRunStatus)"
            />
            <span class="text-surface-600 dark:text-surface-300">
              {{ formatDate(data.lastRunAt) }}
            </span>
          </span>
          <span v-else class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Jobs.urlImport.never') }}
          </span>
        </template>
      </Column>
    </DataTable>

    <div
      v-else-if="!store.loading"
      class="rounded-lg border border-dashed border-surface-300 px-6 py-10 text-center dark:border-surface-600"
    >
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Jobs.urlImport.empty') }}
      </p>
      <Button
        :label="$t('Jobs.urlImport.addJob')"
        size="small"
        class="mt-3"
        @click="openCreate"
      />
    </div>

    <!-- create dialog -->
    <Dialog
      v-model:visible="createDialog"
      modal
      :header="$t('Jobs.urlImport.createTitle')"
      class="w-[460px] max-w-[92vw]"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Jobs.urlImport.name') }}
          </label>
          <InputText
            v-model="form.name"
            class="w-full"
            :placeholder="$t('Jobs.urlImport.namePlaceholder')"
            autofocus
          />
        </div>

        <CronField v-model="form.cron" />

        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Jobs.urlImport.scope') }}
          </label>
          <Select
            v-model="form.scope"
            :options="scopeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
      </div>

      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="createDialog = false"
        />
        <Button
          :label="$t('Common.create')"
          size="small"
          :disabled="!canCreate || creating"
          @click="confirmCreate"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import IconPlus from '~icons/mdi/plus'
import ManageHeader from '@/components/manage/ManageHeader.vue'
import CronField from '@/components/jobs/CronField.vue'
import { useUrlImportJobs } from '@/stores/urlImportJobs'
import { FetcherError } from '@/utils/fetcher'
import type { UrlImportRunStatus } from '@/types/urlImport'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const app = useApp()
const store = useUrlImportJobs()

const tenantId = computed(() => String(route.params.tenantId))

watch(
  tenantId,
  (id) => {
    if (id) store.loadJobs(id)
  },
  { immediate: true },
)

const formatDate = (iso: string) => new Date(iso).toLocaleString()

const runStatusDot = (status: UrlImportRunStatus | null) => {
  switch (status) {
    case 'success':
      return 'bg-emerald-500'
    case 'partial':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-surface-400'
  }
}

// ----- create ---------------------------------------------------------------

const createDialog = ref(false)
const creating = ref(false)
const form = ref({ name: '', cron: '0 6 * * *', scope: 'organisation' })

const scopeOptions = computed(() => [
  { label: t('Wiki.scope.organisation'), value: 'organisation' },
  { label: t('Wiki.scope.personal'), value: 'personal' },
  ...app.state.teams.map((team) => ({
    label: `${t('Wiki.scope.team')}: ${team.name}`,
    value: `team:${team.id}`,
  })),
])

const canCreate = computed(
  () => form.value.name.trim().length > 0 && form.value.cron.trim().length > 0,
)

const openCreate = () => {
  form.value = { name: '', cron: '0 6 * * *', scope: 'organisation' }
  createDialog.value = true
}

const confirmCreate = async () => {
  if (!canCreate.value) return
  creating.value = true
  try {
    const scope = form.value.scope
    const job = await store.createJob(tenantId.value, {
      name: form.value.name.trim(),
      cron: form.value.cron.trim(),
      tenantWide: scope === 'organisation',
      teamId: scope.startsWith('team:') ? scope.slice('team:'.length) : null,
    })
    createDialog.value = false
    openJob({ data: job })
  } catch (error) {
    const detail =
      error instanceof FetcherError && error.body
        ? error.body
        : t('Jobs.urlImport.createError')
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail,
      life: 5000,
    })
  } finally {
    creating.value = false
  }
}

const openJob = (event: { data: { id: string } }) => {
  router.push({
    name: 'UrlImportJob',
    params: { tenantId: tenantId.value, jobId: event.data.id },
  })
}
</script>
