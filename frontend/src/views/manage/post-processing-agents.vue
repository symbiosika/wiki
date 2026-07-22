<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('PostProcessingAgents.title')">
      <template #actions>
        <Button
          :label="$t('PostProcessingAgents.add')"
          size="small"
          @click="openCreate"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </template>
    </ManageHeader>

    <ManageTabs />

    <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('PostProcessingAgents.intro') }}
    </p>

    <!-- list -->
    <DataTable
      v-if="!store.loading && store.agents.length > 0"
      :value="store.agents"
      class="cursor-pointer"
      @row-click="openEdit"
    >
      <Column :header="$t('PostProcessingAgents.name')">
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
                  ? $t('PostProcessingAgents.enabled')
                  : $t('PostProcessingAgents.disabled')
              "
            />
            <span class="font-medium text-surface-900 dark:text-surface-0">
              {{ data.name }}
            </span>
          </div>
        </template>
      </Column>
      <Column :header="$t('PostProcessingAgents.description')">
        <template #body="{ data }">
          <span class="text-sm text-surface-600 dark:text-surface-300">
            {{ data.description || '—' }}
          </span>
        </template>
      </Column>
      <Column :header="$t('PostProcessingAgents.updatedAt')">
        <template #body="{ data }">
          <span class="text-xs text-surface-500 dark:text-surface-400">
            {{ formatDateTime(data.updatedAt) }}
          </span>
        </template>
      </Column>
    </DataTable>

    <div
      v-else-if="!store.loading"
      class="rounded-lg border border-dashed border-surface-300 px-6 py-10 text-center dark:border-surface-600"
    >
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('PostProcessingAgents.empty') }}
      </p>
      <Button
        :label="$t('PostProcessingAgents.add')"
        size="small"
        class="mt-3"
        @click="openCreate"
      />
    </div>

    <!-- create / edit dialog -->
    <Dialog
      v-model:visible="dialog"
      modal
      :header="
        editing
          ? $t('PostProcessingAgents.editTitle')
          : $t('PostProcessingAgents.createTitle')
      "
      class="w-[720px] max-w-[94vw]"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('PostProcessingAgents.name') }}
          </label>
          <InputText
            v-model="form.name"
            class="w-full"
            :placeholder="$t('PostProcessingAgents.namePlaceholder')"
            autofocus
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('PostProcessingAgents.description') }}
          </label>
          <InputText
            v-model="form.description"
            class="w-full"
            :placeholder="$t('PostProcessingAgents.descriptionPlaceholder')"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('PostProcessingAgents.prompt') }}
          </label>
          <Textarea
            v-model="form.prompt"
            class="w-full font-mono text-xs"
            rows="8"
            :placeholder="$t('PostProcessingAgents.promptPlaceholder')"
          />
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('PostProcessingAgents.promptHint') }}
          </span>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('PostProcessingAgents.modelId') }}
            </label>
            <InputText
              v-model="form.modelId"
              class="w-full"
              :placeholder="$t('PostProcessingAgents.modelIdPlaceholder')"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('PostProcessingAgents.maxSteps') }}
            </label>
            <InputText
              v-model="maxStepsInput"
              type="number"
              min="1"
              max="100"
              class="w-full"
              :placeholder="$t('PostProcessingAgents.maxStepsPlaceholder')"
            />
          </div>
        </div>

        <label
          class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
        >
          <Checkbox v-model="form.enabled" binary />
          {{ $t('PostProcessingAgents.enabledLabel') }}
        </label>

        <!-- test-run panel (only for a saved agent) -->
        <div
          v-if="editing"
          class="mt-2 flex flex-col gap-3 rounded-lg border border-surface-200 p-3 dark:border-surface-700"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-surface-800 dark:text-surface-100">
              {{ $t('PostProcessingAgents.testRun.title') }}
            </span>
            <Button
              :label="$t('PostProcessingAgents.testRun.run')"
              size="small"
              :disabled="testRunning || !testInput.trim()"
              @click="runTest"
            >
              <template #icon><IconPlay class="mr-1 h-4 w-4" /></template>
            </Button>
          </div>
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('PostProcessingAgents.testRun.hint') }}
          </span>

          <Textarea
            v-model="testInput"
            class="w-full font-mono text-xs"
            rows="5"
            :placeholder="$t('PostProcessingAgents.testRun.inputPlaceholder')"
          />

          <div
            v-if="testRunning"
            class="flex items-center gap-2 py-4 text-sm text-surface-500 dark:text-surface-400"
          >
            <IconSpinner class="h-4 w-4 animate-spin" />
            {{ $t('PostProcessingAgents.testRun.running') }}
          </div>

          <div v-else-if="testResult" class="flex flex-col gap-2">
            <div
              class="rounded-md bg-surface-50 px-3 py-2 text-xs text-surface-700 dark:bg-surface-800 dark:text-surface-200"
            >
              <span class="font-medium">
                {{ $t('PostProcessingAgents.testRun.summary') }}:
              </span>
              {{ testResult.summary }}
              <span class="text-surface-400 dark:text-surface-500">
                ({{
                  $t('PostProcessingAgents.testRun.edits', {
                    count: testResult.editCount,
                  })
                }}<template v-if="testResult.aborted">,
                  {{ $t('PostProcessingAgents.testRun.aborted') }}</template
                >)
              </span>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <span class="text-xs text-surface-500 dark:text-surface-400">
                  {{ $t('PostProcessingAgents.testRun.before') }}
                </span>
                <pre
                  class="max-h-64 overflow-auto rounded-md bg-surface-50 p-2 text-xs whitespace-pre-wrap dark:bg-surface-800"
                >{{ testInput }}</pre>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-surface-500 dark:text-surface-400">
                  {{ $t('PostProcessingAgents.testRun.after') }}
                </span>
                <pre
                  class="max-h-64 overflow-auto rounded-md bg-surface-50 p-2 text-xs whitespace-pre-wrap dark:bg-surface-800"
                >{{ testResult.text }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <SecondaryButton
          v-if="editing"
          :label="$t('Common.delete')"
          size="small"
          severity="danger"
          class="mr-auto"
          @click="confirmDelete"
        />
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="dialog = false"
        />
        <Button
          :label="editing ? $t('Common.save') : $t('Common.create')"
          size="small"
          :disabled="!canSave || saving"
          @click="save"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import IconPlus from '~icons/mdi/plus'
import IconPlay from '~icons/mdi/play'
import IconSpinner from '~icons/mdi/loading'
import ManageHeader from '@/components/manage/ManageHeader.vue'
import ManageTabs from '@/components/manage/ManageTabs.vue'
import { usePostProcessingAgents } from '@/stores/postProcessingAgents'
import { FetcherError } from '@/utils/fetcher'
import type {
  PostProcessingAgent,
  PostProcessingAgentTestRun,
} from '@/types/postProcessingAgents'

const route = useRoute()
const { t } = useI18n()

/** Full date + time in the viewer's local timezone (UTC-aware). */
const formatDateTime = (value: string | null | undefined) =>
  parseServerDate(value)?.toLocaleString() ?? '-'
const toast = useToast()
const confirm = useConfirm()
const store = usePostProcessingAgents()

const tenantId = computed(() => String(route.params.tenantId))

watch(
  tenantId,
  (id) => {
    if (id) store.loadAgents(id)
  },
  { immediate: true },
)

// ----- create / edit --------------------------------------------------------

const dialog = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const editing = computed(() => editingId.value !== null)

const emptyForm = () => ({
  name: '',
  description: '',
  prompt: '',
  modelId: '',
  enabled: true,
})
const form = ref(emptyForm())
const maxStepsInput = ref('')

const canSave = computed(
  () => form.value.name.trim().length > 0 && form.value.prompt.trim().length > 0,
)

const openCreate = () => {
  editingId.value = null
  form.value = emptyForm()
  maxStepsInput.value = ''
  resetTest()
  dialog.value = true
}

const openEdit = (event: { data: PostProcessingAgent }) => {
  const a = event.data
  editingId.value = a.id
  form.value = {
    name: a.name,
    description: a.description ?? '',
    prompt: a.prompt,
    modelId: a.modelId ?? '',
    enabled: a.enabled,
  }
  maxStepsInput.value = a.maxSteps != null ? String(a.maxSteps) : ''
  resetTest()
  dialog.value = true
}

const parsedMaxSteps = (): number | null => {
  const raw = maxStepsInput.value.trim()
  if (raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

const save = async () => {
  if (!canSave.value) return
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      prompt: form.value.prompt,
      modelId: form.value.modelId.trim() || null,
      maxSteps: parsedMaxSteps(),
      enabled: form.value.enabled,
    }
    if (editingId.value) {
      await store.updateAgent(tenantId.value, editingId.value, payload)
    } else {
      await store.createAgent(tenantId.value, payload)
    }
    dialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      life: 3000,
    })
  } catch (error) {
    const detail =
      error instanceof FetcherError && error.body
        ? error.body
        : t('PostProcessingAgents.saveError')
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail,
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}

const confirmDelete = () => {
  if (!editingId.value) return
  const id = editingId.value
  confirm.require({
    message: t('PostProcessingAgents.deleteConfirm'),
    header: t('PostProcessingAgents.deleteTitle'),
    rejectProps: {
      label: t('Common.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      try {
        await store.deleteAgent(tenantId.value, id)
        dialog.value = false
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          life: 3000,
        })
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          life: 5000,
        })
      }
    },
  })
}

// ----- test run -------------------------------------------------------------

const testInput = ref('')
const testRunning = ref(false)
const testResult = ref<PostProcessingAgentTestRun | null>(null)

const resetTest = () => {
  testInput.value = ''
  testResult.value = null
  testRunning.value = false
}

const runTest = async () => {
  if (!editingId.value || !testInput.value.trim()) return
  testRunning.value = true
  testResult.value = null
  try {
    testResult.value = await store.testRun(
      tenantId.value,
      editingId.value,
      testInput.value,
      form.value.name.trim() || undefined,
    )
  } catch (error) {
    const detail =
      error instanceof FetcherError && error.body
        ? error.body
        : t('PostProcessingAgents.testRun.error')
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail,
      life: 5000,
    })
  } finally {
    testRunning.value = false
  }
}
</script>
