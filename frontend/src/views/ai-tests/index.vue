<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('AiTests.title')">
      <template #actions>
        <Button
          :label="$t('AiTests.addSuite')"
          size="small"
          @click="openCreate"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </template>
    </ManageHeader>

    <p class="mb-6 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('AiTests.intro') }}
    </p>

    <!-- list -->
    <DataTable
      v-if="!store.loading && store.suites.length > 0"
      :value="store.suites"
      class="cursor-pointer"
      @row-click="openSuite"
    >
      <Column :header="$t('AiTests.name')">
        <template #body="{ data }">
          <span class="font-medium text-surface-900 dark:text-surface-0">
            {{ data.name }}
          </span>
          <p
            v-if="data.description"
            class="text-xs text-surface-400 dark:text-surface-500"
          >
            {{ data.description }}
          </p>
        </template>
      </Column>
      <Column :header="$t('AiTests.lastRun')">
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
            {{ $t('AiTests.never') }}
          </span>
        </template>
      </Column>
    </DataTable>

    <div
      v-else-if="!store.loading"
      class="rounded-lg border border-dashed border-surface-300 px-6 py-10 text-center dark:border-surface-600"
    >
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('AiTests.empty') }}
      </p>
      <Button
        :label="$t('AiTests.addSuite')"
        size="small"
        class="mt-3"
        @click="openCreate"
      />
    </div>

    <!-- create dialog -->
    <Dialog
      v-model:visible="createDialog"
      modal
      :header="$t('AiTests.createTitle')"
      class="w-[460px] max-w-[92vw]"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('AiTests.name') }}
          </label>
          <InputText
            v-model="form.name"
            class="w-full"
            :placeholder="$t('AiTests.namePlaceholder')"
            autofocus
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('AiTests.description') }}
          </label>
          <Textarea v-model="form.description" class="w-full" rows="2" />
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
import { useAiTests } from '@/stores/aiTests'
import { FetcherError } from '@/utils/fetcher'
import type { AiTestRunStatus } from '@/types/aiTests'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const store = useAiTests()

const tenantId = computed(() => String(route.params.tenantId))

watch(
  tenantId,
  (id) => {
    if (id) store.loadSuites(id)
  },
  { immediate: true },
)

const formatDate = (iso: string) => new Date(iso).toLocaleString()

const runStatusDot = (status: AiTestRunStatus | null) => {
  switch (status) {
    case 'success':
      return 'bg-emerald-500'
    case 'partial':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    case 'cancelled':
      return 'bg-surface-400'
    default:
      return 'bg-surface-400'
  }
}

// ----- create ---------------------------------------------------------------

const createDialog = ref(false)
const creating = ref(false)
const form = ref<{ name: string; description: string }>({
  name: '',
  description: '',
})

const canCreate = computed(() => form.value.name.trim().length > 0)

const openCreate = () => {
  form.value = { name: '', description: '' }
  createDialog.value = true
}

const confirmCreate = async () => {
  if (!canCreate.value) return
  creating.value = true
  try {
    const suite = await store.createSuite(tenantId.value, {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
    })
    createDialog.value = false
    openSuite({ data: suite })
  } catch (error) {
    const detail =
      error instanceof FetcherError && error.body
        ? error.body
        : t('AiTests.createError')
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

const openSuite = (event: { data: { id: string } }) => {
  router.push({
    name: 'AiTestSuite',
    params: { tenantId: tenantId.value, suiteId: event.data.id },
  })
}
</script>
