<template>
  <div class="mx-auto max-w-5xl px-4 py-5 sm:p-6">
    <ManageHeader
      :title="suite?.name ?? $t('AiTests.title')"
      :back-route-name="'AiTests'"
      :back-title="$t('AiTests.title')"
    >
      <template #actions>
        <SecondaryButton
          :label="$t('AiTests.delete')"
          size="small"
          severity="danger"
          @click="confirmDelete"
        />
        <Button
          :label="$t('AiTests.runNow')"
          size="small"
          :disabled="running || activeCount === 0"
          @click="runNow"
        >
          <template #icon><IconPlay /></template>
        </Button>
      </template>
    </ManageHeader>

    <div v-if="suite" class="flex flex-col gap-8">
      <!-- settings ------------------------------------------------------- -->
      <section class="flex flex-col gap-4">
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('AiTests.settings') }}
        </h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('AiTests.name') }}
            </label>
            <InputText v-model="settings.name" class="w-full" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('AiTests.judgeModel') }}
            </label>
            <InputText
              v-model="settings.judgeModelId"
              class="w-full"
              :placeholder="$t('AiTests.judgeModelPlaceholder')"
            />
            <p class="text-xs text-surface-400 dark:text-surface-500">
              {{ $t('AiTests.judgeModelHint') }}
            </p>
          </div>
          <div class="flex flex-col gap-1 sm:col-span-2">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('AiTests.description') }}
            </label>
            <Textarea v-model="settings.description" class="w-full" rows="2" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('AiTests.stepLimit') }}
            </label>
            <InputText
              v-model="settings.stepLimit"
              class="w-full"
              :placeholder="$t('AiTests.stepLimitPlaceholder')"
            />
          </div>
        </div>
        <div>
          <Button
            :label="$t('Common.save')"
            size="small"
            :disabled="!settingsChanged || savingSettings"
            @click="saveSettings"
          />
        </div>
      </section>

      <!-- questions (master–detail) --------------------------------------- -->
      <section class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2
            class="text-sm font-semibold text-surface-900 dark:text-surface-0"
          >
            {{ $t('AiTests.questions') }} ({{ questions.length }})
          </h2>
          <div class="flex gap-2">
            <SecondaryButton
              :label="$t('AiTests.bulkAdd')"
              size="small"
              @click="bulkDialog = true"
            />
            <SecondaryButton
              :label="$t('AiTests.addQuestion')"
              size="small"
              @click="addRow"
            />
            <Button
              :label="$t('AiTests.saveQuestions')"
              size="small"
              :disabled="!questionsChanged || savingQuestions"
              @click="saveQuestions"
            />
          </div>
        </div>

        <p class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('AiTests.keyboardHint') }}
        </p>

        <div
          v-if="questions.length === 0"
          class="rounded-lg border border-dashed border-surface-300 px-6 py-8 text-center text-sm text-surface-500 dark:border-surface-600 dark:text-surface-400"
        >
          {{ $t('AiTests.noQuestions') }}
        </div>

        <div
          v-else
          class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"
        >
          <!-- master list -->
          <ul
            class="flex max-h-[28rem] flex-col gap-1 overflow-y-auto rounded-lg border border-surface-200 p-1 dark:border-surface-700"
          >
            <li v-for="(q, i) in questions" :key="q.key">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors"
                :class="
                  i === selectedIndex
                    ? 'bg-surface-100 dark:bg-surface-800'
                    : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                "
                @click="selectIndex(i)"
              >
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  :class="
                    q.active
                      ? 'bg-emerald-500'
                      : 'bg-surface-300 dark:bg-surface-600'
                  "
                  :title="q.active ? $t('AiTests.active') : ''"
                />
                <span
                  class="flex-1 truncate"
                  :class="
                    q.question.trim()
                      ? 'text-surface-800 dark:text-surface-100'
                      : 'italic text-surface-400 dark:text-surface-500'
                  "
                >
                  {{ q.question.trim() || $t('AiTests.emptyQuestion') }}
                </span>
                <span
                  class="shrink-0 rounded bg-surface-100 px-1.5 py-0.5 text-[10px] text-surface-500 dark:bg-surface-700 dark:text-surface-300"
                >
                  {{ $t(`AiTests.typeShort.${q.type}`) }}
                </span>
              </button>
            </li>
          </ul>

          <!-- detail editor -->
          <div
            v-if="selected"
            ref="panelRef"
            class="flex flex-col gap-3 rounded-lg border border-surface-200 p-3 dark:border-surface-700"
          >
            <div class="flex items-center justify-between gap-2">
              <span
                class="text-xs font-medium text-surface-500 dark:text-surface-400"
              >
                {{
                  $t('AiTests.questionN', {
                    n: selectedIndex + 1,
                    total: questions.length,
                  })
                }}
              </span>
              <div class="flex items-center gap-1">
                <SecondaryButton
                  :label="$t('AiTests.previous')"
                  size="small"
                  :disabled="selectedIndex <= 0"
                  @click="selectPrev"
                />
                <SecondaryButton
                  :label="$t('AiTests.next')"
                  size="small"
                  :disabled="selectedIndex >= questions.length - 1"
                  @click="selectNext"
                />
                <button
                  type="button"
                  class="ml-1 rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-red-500 dark:hover:bg-surface-800"
                  :title="$t('AiTests.removeQuestion')"
                  @click="removeRow(selectedIndex)"
                >
                  <IconTrash class="h-4 w-4" />
                </button>
              </div>
            </div>

            <Textarea
              v-model="selected.question"
              class="w-full"
              rows="3"
              :placeholder="$t('AiTests.questionPlaceholder')"
            />

            <div class="flex flex-wrap items-center gap-3">
              <Select
                v-model="selected.type"
                :options="typeOptions"
                option-label="label"
                option-value="value"
                class="w-48"
              />
              <label
                class="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-300"
              >
                <Checkbox v-model="selected.active" binary />
                {{ $t('AiTests.active') }}
              </label>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <label class="text-xs text-surface-500 dark:text-surface-400">
                  {{ $t('AiTests.expectedFacts') }}
                </label>
                <Textarea
                  v-model="selected.expectedFactsText"
                  class="w-full"
                  rows="3"
                  :placeholder="$t('AiTests.expectedFactsPlaceholder')"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-surface-500 dark:text-surface-400">
                  {{ $t('AiTests.expectedPages') }}
                </label>
                <Textarea
                  v-model="selected.expectedPageIdsText"
                  class="w-full"
                  rows="3"
                  :placeholder="$t('AiTests.expectedPagesPlaceholder')"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- run history ---------------------------------------------------- -->
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('AiTests.runHistory') }}
        </h2>
        <DataTable
          v-if="runs.length > 0"
          :value="runs"
          class="cursor-pointer"
          @row-click="openRun"
        >
          <Column :header="$t('AiTests.status')">
            <template #body="{ data }">
              <span class="inline-flex items-center gap-1.5 text-xs">
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="runStatusDot(data.status)"
                />
                {{ $t(`AiTests.runStatus.${data.status}`) }}
              </span>
            </template>
          </Column>
          <Column :header="$t('AiTests.started')">
            <template #body="{ data }">
              <span class="text-xs text-surface-600 dark:text-surface-300">
                {{ formatDate(data.startedAt) }}
              </span>
            </template>
          </Column>
          <Column :header="$t('AiTests.passRate')">
            <template #body="{ data }">
              <span class="text-xs">
                {{ pct(data.aggregates?.passRate) }}
              </span>
            </template>
          </Column>
          <Column :header="$t('AiTests.meanScore')">
            <template #body="{ data }">
              <span class="text-xs">
                {{ score(data.aggregates?.meanTotal) }}
              </span>
            </template>
          </Column>
          <Column :header="$t('AiTests.hardGateFails')">
            <template #body="{ data }">
              <span
                class="text-xs"
                :class="
                  data.hardGateFails > 0
                    ? 'text-red-500'
                    : 'text-surface-500 dark:text-surface-400'
                "
              >
                {{ data.hardGateFails }}
              </span>
            </template>
          </Column>
        </DataTable>
        <div
          v-else
          class="rounded-lg border border-dashed border-surface-300 px-6 py-8 text-center text-sm text-surface-500 dark:border-surface-600 dark:text-surface-400"
        >
          {{ $t('AiTests.noRuns') }}
        </div>
      </section>
    </div>

    <!-- bulk-add dialog -->
    <Dialog
      v-model:visible="bulkDialog"
      modal
      :header="$t('AiTests.bulkAddTitle')"
      class="w-[520px] max-w-[92vw]"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-surface-500 dark:text-surface-400">
          {{ $t('AiTests.bulkAddHint') }}
        </p>
        <Select
          v-model="bulkType"
          :options="typeOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
        <Textarea
          v-model="bulkText"
          class="w-full"
          rows="8"
          :placeholder="$t('AiTests.bulkAddPlaceholder')"
        />
      </div>
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="bulkDialog = false"
        />
        <Button
          :label="$t('AiTests.bulkAddConfirm')"
          size="small"
          :disabled="bulkText.trim().length === 0 || bulkSaving"
          @click="confirmBulk"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import IconPlay from '~icons/mdi/play'
import IconTrash from '~icons/mdi/trash-can-outline'
import ManageHeader from '@/components/manage/ManageHeader.vue'
import { useAiTests } from '@/stores/aiTests'
import { FetcherError } from '@/utils/fetcher'
import type {
  AiTestSuite,
  AiTestQuestion,
  AiTestQuestionType,
  AiTestRun,
  AiTestRunStatus,
} from '@/types/aiTests'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const store = useAiTests()

const tenantId = computed(() => String(route.params.tenantId))
const suiteId = computed(() => String(route.params.suiteId))

const suite = ref<AiTestSuite | null>(null)
const runs = ref<AiTestRun[]>([])

interface EditableQuestion {
  key: string
  id?: string
  question: string
  type: AiTestQuestionType
  active: boolean
  expectedFactsText: string
  expectedPageIdsText: string
  showRefs: boolean
}

const questions = ref<EditableQuestion[]>([])
const originalQuestions = ref('')
/** index of the question shown in the detail panel (-1 = none) */
const selectedIndex = ref(-1)
const panelRef = ref<HTMLElement | null>(null)
const settings = ref({
  name: '',
  description: '',
  judgeModelId: '',
  stepLimit: '',
})
const originalSettings = ref('')

const typeOptions = computed(() =>
  (
    ['answerable', 'synthesis', 'not-in-wiki', 'ambiguous'] as AiTestQuestionType[]
  ).map((value) => ({ value, label: t(`AiTests.type.${value}`) })),
)

let keyCounter = 0
const nextKey = () => `q-${keyCounter++}`

const toEditable = (q: AiTestQuestion): EditableQuestion => ({
  key: nextKey(),
  id: q.id,
  question: q.question,
  type: q.type,
  active: q.active,
  expectedFactsText: (q.expectedFacts ?? []).join('\n'),
  expectedPageIdsText: (q.expectedPageIds ?? []).join('\n'),
  showRefs:
    (q.expectedFacts?.length ?? 0) > 0 || (q.expectedPageIds?.length ?? 0) > 0,
})

const snapshotQuestions = () =>
  JSON.stringify(
    questions.value.map((q) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      active: q.active,
      f: q.expectedFactsText,
      p: q.expectedPageIdsText,
    })),
  )

const reload = async () => {
  const detail = await store.getSuite(tenantId.value, suiteId.value)
  suite.value = detail.suite
  runs.value = detail.runs
  questions.value = detail.questions.map(toEditable)
  originalQuestions.value = snapshotQuestions()
  selectedIndex.value = questions.value.length > 0 ? 0 : -1
  settings.value = {
    name: detail.suite.name,
    description: detail.suite.description ?? '',
    judgeModelId: detail.suite.judgeModelId ?? '',
    stepLimit: detail.suite.stepLimit ? String(detail.suite.stepLimit) : '',
  }
  originalSettings.value = JSON.stringify(settings.value)
}

watch([tenantId, suiteId], reload, { immediate: true })

const activeCount = computed(
  () => questions.value.filter((q) => q.active).length,
)
const settingsChanged = computed(
  () => JSON.stringify(settings.value) !== originalSettings.value,
)
const questionsChanged = computed(
  () => snapshotQuestions() !== originalQuestions.value,
)

const formatDate = (iso: string) => new Date(iso).toLocaleString()
const pct = (n?: number) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const score = (n?: number) => (n == null ? '—' : n.toFixed(2))

const runStatusDot = (status: AiTestRunStatus) => {
  switch (status) {
    case 'success':
      return 'bg-emerald-500'
    case 'partial':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    case 'running':
      return 'bg-sky-500'
    default:
      return 'bg-surface-400'
  }
}

const showError = (error: unknown, fallback: string) => {
  const detail =
    error instanceof FetcherError && error.body ? error.body : fallback
  toast.add({
    severity: 'error',
    summary: t('Common.error'),
    detail,
    life: 5000,
  })
}

// ----- settings -------------------------------------------------------------

const savingSettings = ref(false)
const saveSettings = async () => {
  savingSettings.value = true
  try {
    const parsedStep = parseInt(settings.value.stepLimit, 10)
    const updated = await store.updateSuite(tenantId.value, suiteId.value, {
      name: settings.value.name.trim(),
      description: settings.value.description.trim() || null,
      judgeModelId: settings.value.judgeModelId.trim() || null,
      stepLimit: Number.isFinite(parsedStep) ? parsedStep : null,
    })
    suite.value = updated
    originalSettings.value = JSON.stringify(settings.value)
    await store.loadSuites(tenantId.value)
  } catch (error) {
    showError(error, t('AiTests.saveError'))
  } finally {
    savingSettings.value = false
  }
}

// ----- questions ------------------------------------------------------------

const savingQuestions = ref(false)

/** the question currently shown in the detail panel */
const selected = computed(() => questions.value[selectedIndex.value] ?? null)

/** move keyboard focus into the panel's question field after a selection */
const focusQuestion = () => {
  nextTick(() => {
    panelRef.value?.querySelector('textarea')?.focus()
  })
}

const selectIndex = (i: number) => {
  selectedIndex.value = i
  focusQuestion()
}
const selectPrev = () => {
  if (selectedIndex.value > 0) selectIndex(selectedIndex.value - 1)
}
const selectNext = () => {
  if (selectedIndex.value < questions.value.length - 1)
    selectIndex(selectedIndex.value + 1)
}
/** keep the selected index within bounds after the list length changes */
const clampSelection = () => {
  if (selectedIndex.value > questions.value.length - 1) {
    selectedIndex.value = questions.value.length - 1
  }
  if (selectedIndex.value < 0 && questions.value.length > 0) {
    selectedIndex.value = 0
  }
}

const addRow = () => {
  questions.value.push({
    key: nextKey(),
    question: '',
    type: 'answerable',
    active: true,
    expectedFactsText: '',
    expectedPageIdsText: '',
    showRefs: false,
  })
  selectIndex(questions.value.length - 1)
}
const removeRow = (index: number) => {
  questions.value.splice(index, 1)
  if (selectedIndex.value >= questions.value.length) {
    selectedIndex.value = questions.value.length - 1
  }
}

const splitLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const saveQuestions = async () => {
  savingQuestions.value = true
  try {
    const saved = await store.setQuestions(
      tenantId.value,
      suiteId.value,
      questions.value
        .filter((q) => q.question.trim().length > 0)
        .map((q) => ({
          id: q.id,
          question: q.question.trim(),
          type: q.type,
          active: q.active,
          expectedFacts: splitLines(q.expectedFactsText),
          expectedPageIds: splitLines(q.expectedPageIdsText),
        })),
    )
    questions.value = saved.map(toEditable)
    originalQuestions.value = snapshotQuestions()
    clampSelection()
  } catch (error) {
    showError(error, t('AiTests.saveError'))
  } finally {
    savingQuestions.value = false
  }
}

// ----- bulk add -------------------------------------------------------------

const bulkDialog = ref(false)
const bulkText = ref('')
const bulkType = ref<AiTestQuestionType>('answerable')
const bulkSaving = ref(false)
const confirmBulk = async () => {
  bulkSaving.value = true
  try {
    const saved = await store.bulkAddQuestions(
      tenantId.value,
      suiteId.value,
      bulkText.value,
      bulkType.value,
    )
    questions.value = saved.map(toEditable)
    originalQuestions.value = snapshotQuestions()
    clampSelection()
    bulkText.value = ''
    bulkDialog.value = false
  } catch (error) {
    showError(error, t('AiTests.saveError'))
  } finally {
    bulkSaving.value = false
  }
}

// ----- run ------------------------------------------------------------------

const running = ref(false)
const runNow = async () => {
  running.value = true
  try {
    const run = await store.runNow(tenantId.value, suiteId.value)
    router.push({
      name: 'AiTestRun',
      params: {
        tenantId: tenantId.value,
        suiteId: suiteId.value,
        runId: run.id,
      },
    })
  } catch (error) {
    showError(error, t('AiTests.runError'))
  } finally {
    running.value = false
  }
}

const openRun = (event: { data: { id: string } }) => {
  router.push({
    name: 'AiTestRun',
    params: {
      tenantId: tenantId.value,
      suiteId: suiteId.value,
      runId: event.data.id,
    },
  })
}

// ----- delete ---------------------------------------------------------------

const confirmDelete = () => {
  confirm.require({
    header: t('AiTests.deleteTitle'),
    message: t('AiTests.deleteConfirm'),
    acceptProps: { label: t('AiTests.delete'), severity: 'danger' },
    rejectProps: { label: t('Common.cancel'), outlined: true },
    accept: async () => {
      try {
        await store.deleteSuite(tenantId.value, suiteId.value)
        router.push({ name: 'AiTests', params: { tenantId: tenantId.value } })
      } catch (error) {
        showError(error, t('AiTests.deleteError'))
      }
    },
  })
}

// ----- keyboard navigation (pure keyboard operation) ------------------------
// Alt+↓/↑ = next/previous question, Alt+N = new, Ctrl/Cmd+S = save. Alt avoids
// clashing with the caret movement inside the focused question textarea.
const onKeydown = (e: KeyboardEvent) => {
  if (e.altKey && e.key === 'ArrowDown') {
    e.preventDefault()
    selectNext()
  } else if (e.altKey && e.key === 'ArrowUp') {
    e.preventDefault()
    selectPrev()
  } else if (e.altKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault()
    addRow()
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    if (questionsChanged.value && !savingQuestions.value) saveQuestions()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
