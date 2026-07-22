<template>
  <div class="mx-auto max-w-5xl px-4 py-5 sm:p-6">
    <button
      type="button"
      class="mb-2 flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
      @click="goBackToSuite"
    >
      <IconBack class="h-4 w-4" />
      {{ $t('AiTests.backToSuite') }}
    </button>

    <div v-if="run" class="flex flex-col gap-6">
      <!-- status header -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-200 p-4 dark:border-surface-700"
      >
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span
              class="h-2.5 w-2.5 rounded-full"
              :class="runStatusDot(run.status)"
            />
            <span
              class="text-sm font-semibold text-surface-900 dark:text-surface-0"
            >
              {{ $t(`AiTests.runStatus.${run.status}`) }}
            </span>
            <span class="text-xs text-surface-400 dark:text-surface-500">
              {{ formatDate(run.startedAt) }}
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span :class="chip">
              {{ $t('AiTests.progress') }}: {{ run.completed }}/{{ run.total }}
            </span>
            <span :class="chip">
              {{ $t('AiTests.passRate') }}:
              {{ pct(run.aggregates?.passRate) }}
            </span>
            <span :class="chip">
              {{ $t('AiTests.meanScore') }}:
              {{ score(run.aggregates?.meanTotal) }}
            </span>
            <span :class="run.hardGateFails > 0 ? chipDanger : chip">
              {{ $t('AiTests.hardGateFails') }}: {{ run.hardGateFails }}
            </span>
            <span :class="chip">
              {{ $t('AiTests.tokens') }}: {{ run.totalTokens }}
            </span>
          </div>
        </div>
        <SecondaryButton
          v-if="run.status === 'running'"
          :label="$t('AiTests.cancelRun')"
          size="small"
          severity="danger"
          @click="cancel"
        />
      </div>

      <!-- per-type breakdown -->
      <div
        v-if="run.aggregates && byTypeEntries.length > 0"
        class="flex flex-wrap gap-2"
      >
        <div
          v-for="[type, agg] in byTypeEntries"
          :key="type"
          class="rounded-md border border-surface-200 px-3 py-1.5 text-xs dark:border-surface-700"
        >
          <span class="font-medium">{{ $t(`AiTests.type.${type}`) }}</span>
          <span class="text-surface-500 dark:text-surface-400">
            · {{ agg.count }} · {{ pct(agg.passRate) }} ·
            {{ score(agg.meanTotal) }}
          </span>
        </div>
      </div>

      <!-- results -->
      <div class="flex flex-col gap-3">
        <div
          v-for="r in results"
          :key="r.id"
          class="rounded-lg border border-surface-200 dark:border-surface-700"
        >
          <button
            type="button"
            class="flex w-full items-start gap-3 p-3 text-left"
            @click="toggle(r.id)"
          >
            <span
              class="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              :class="verdictDot(r.verdict)"
              :title="r.verdict ?? ''"
            />
            <span class="flex-1">
              <span
                class="block text-sm font-medium text-surface-900 dark:text-surface-0"
              >
                {{ r.questionText }}
              </span>
              <span class="text-xs text-surface-400 dark:text-surface-500">
                {{ $t(`AiTests.type.${r.questionType}`) }} ·
                {{ $t('AiTests.total') }}: {{ score(r.totalScore ?? undefined) }}
                <template v-if="r.error"> · {{ $t('AiTests.failed') }}</template>
              </span>
            </span>
            <IconChevron
              class="h-4 w-4 shrink-0 text-surface-400 transition-transform"
              :class="expanded.has(r.id) ? 'rotate-180' : ''"
            />
          </button>

          <div
            v-if="expanded.has(r.id)"
            class="flex flex-col gap-4 border-t border-surface-200 p-3 dark:border-surface-700"
          >
            <p v-if="r.error" class="text-sm text-red-500">{{ r.error }}</p>

            <!-- scores -->
            <div v-if="r.scores" class="flex flex-wrap gap-1.5">
              <span :class="chip">
                {{ $t('AiTests.toolUsage') }}:
                {{ score(r.scores.toolUsage) }}
              </span>
              <span :class="chip">
                {{ $t('AiTests.groundedness') }}:
                {{ score(r.scores.groundedness) }}
              </span>
              <span :class="chip">
                {{ $t('AiTests.relevance') }}:
                {{ score(r.scores.relevance) }}
              </span>
              <span v-if="r.scores.reference != null" :class="chip">
                {{ $t('AiTests.reference') }}:
                {{ score(r.scores.reference) }}
              </span>
            </div>

            <!-- flags -->
            <div
              v-if="hasFlags(r)"
              class="flex flex-wrap gap-1.5"
            >
              <span
                v-if="r.judgeReport?.flags?.noAnswerCase"
                :class="chipInfo"
              >
                {{ $t('AiTests.flags.noAnswerCase') }}
              </span>
              <span
                v-if="r.judgeReport?.flags?.generalKnowledgeSuspected"
                :class="chipWarn"
              >
                {{ $t('AiTests.flags.generalKnowledgeSuspected') }}
              </span>
              <span
                v-for="reason in r.judgeReport?.flags?.hardGateReasons ?? []"
                :key="reason"
                :class="chipDanger"
              >
                {{ $t('AiTests.hardGate') }}: {{ reason }}
              </span>
            </div>

            <!-- answer -->
            <div v-if="r.answer">
              <h4 class="mb-1 text-xs font-semibold uppercase text-surface-400">
                {{ $t('AiTests.answer') }}
              </h4>
              <p
                class="whitespace-pre-wrap text-sm text-surface-700 dark:text-surface-200"
              >
                {{ r.answer }}
              </p>
            </div>

            <!-- relevance reasoning -->
            <div v-if="r.judgeReport?.relevanceReasoning">
              <h4 class="mb-1 text-xs font-semibold uppercase text-surface-400">
                {{ $t('AiTests.relevanceReasoning') }}
              </h4>
              <p class="text-sm text-surface-600 dark:text-surface-300">
                {{ r.judgeReport.relevanceReasoning }}
              </p>
            </div>

            <!-- claims -->
            <div v-if="(r.judgeReport?.claims?.length ?? 0) > 0">
              <h4 class="mb-1 text-xs font-semibold uppercase text-surface-400">
                {{ $t('AiTests.claims') }}
              </h4>
              <ul class="flex flex-col gap-1.5">
                <li
                  v-for="(claim, ci) in r.judgeReport!.claims!"
                  :key="ci"
                  class="flex items-start gap-2 text-sm"
                >
                  <span
                    class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
                    :class="claimDot(claim.verdict)"
                  />
                  <span class="text-surface-700 dark:text-surface-200">
                    {{ claim.claim }}
                    <span class="text-xs text-surface-400">
                      ({{ $t(`AiTests.claimVerdict.${claim.verdict}`) }})
                    </span>
                    <span
                      v-if="claim.reasoning"
                      class="block text-xs text-surface-400 dark:text-surface-500"
                    >
                      {{ claim.reasoning }}
                    </span>
                  </span>
                </li>
              </ul>
            </div>

            <!-- cited pages -->
            <div v-if="(r.judgeReport?.citedPageTitles?.length ?? 0) > 0">
              <h4 class="mb-1 text-xs font-semibold uppercase text-surface-400">
                {{ $t('AiTests.citedPages') }}
              </h4>
              <p class="text-sm text-surface-600 dark:text-surface-300">
                {{ r.judgeReport!.citedPageTitles!.join(', ') }}
              </p>
            </div>

            <!-- trajectory -->
            <div v-if="(r.trajectory?.steps?.length ?? 0) > 0">
              <h4 class="mb-1 text-xs font-semibold uppercase text-surface-400">
                {{ $t('AiTests.trajectory') }}
              </h4>
              <ol class="flex flex-col gap-2">
                <li
                  v-for="step in r.trajectory!.steps"
                  :key="step.index"
                  class="rounded-md bg-surface-50 p-2 text-xs dark:bg-surface-800"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-block h-1.5 w-1.5 rounded-full"
                      :class="step.ok ? 'bg-emerald-500' : 'bg-red-500'"
                    />
                    <code class="font-medium">{{ step.toolName }}</code>
                    <code class="text-surface-500 dark:text-surface-400">
                      {{ shortInput(step.input) }}
                    </code>
                  </div>
                  <button
                    type="button"
                    class="mt-1 text-primary hover:underline"
                    @click="toggleStep(r.id, step.index)"
                  >
                    {{
                      isStepOpen(r.id, step.index)
                        ? $t('AiTests.hideOutput')
                        : $t('AiTests.showOutput')
                    }}
                  </button>
                  <pre
                    v-if="isStepOpen(r.id, step.index)"
                    class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-100 p-2 text-surface-600 dark:bg-surface-900 dark:text-surface-300"
                    >{{ prettyOutput(step.output) }}</pre
                  >
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import IconBack from '~icons/mdi/arrow-left'
import IconChevron from '~icons/mdi/chevron-down'
import { useAiTests } from '@/stores/aiTests'
import { FetcherError } from '@/utils/fetcher'
import type {
  AiTestRun,
  AiTestResult,
  AiTestRunStatus,
  AiTestVerdict,
  AiTestClaimVerdict,
} from '@/types/aiTests'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const store = useAiTests()

const tenantId = computed(() => String(route.params.tenantId))
const suiteId = computed(() => String(route.params.suiteId))
const runId = computed(() => String(route.params.runId))

const run = ref<AiTestRun | null>(null)
const results = ref<AiTestResult[]>([])
const expanded = ref<Set<string>>(new Set())
const openSteps = ref<Set<string>>(new Set())

let pollTimer: ReturnType<typeof setTimeout> | null = null

const load = async () => {
  const detail = await store.getRun(tenantId.value, suiteId.value, runId.value)
  run.value = detail.run
  results.value = detail.results
  if (detail.run.status === 'running') {
    pollTimer = setTimeout(load, 3000)
  }
}

watch(
  [tenantId, suiteId, runId],
  () => {
    if (pollTimer) clearTimeout(pollTimer)
    load()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer)
})

const byTypeEntries = computed(() =>
  Object.entries(run.value?.aggregates?.byType ?? {}),
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

const verdictDot = (verdict: AiTestVerdict | null) => {
  switch (verdict) {
    case 'pass':
      return 'bg-emerald-500'
    case 'warn':
      return 'bg-amber-500'
    case 'fail':
      return 'bg-red-500'
    default:
      return 'bg-surface-400'
  }
}

const claimDot = (verdict: AiTestClaimVerdict) => {
  switch (verdict) {
    case 'supported':
      return 'bg-emerald-500'
    case 'unsupported':
      return 'bg-amber-500'
    case 'contradicted':
      return 'bg-red-500'
    default:
      return 'bg-surface-400'
  }
}

const hasFlags = (r: AiTestResult) =>
  !!r.judgeReport?.flags?.noAnswerCase ||
  !!r.judgeReport?.flags?.generalKnowledgeSuspected ||
  (r.judgeReport?.flags?.hardGateReasons?.length ?? 0) > 0

const toggle = (id: string) => {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const stepKey = (id: string, index: number) => `${id}:${index}`
const isStepOpen = (id: string, index: number) =>
  openSteps.value.has(stepKey(id, index))
const toggleStep = (id: string, index: number) => {
  const key = stepKey(id, index)
  const next = new Set(openSteps.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openSteps.value = next
}

const shortInput = (input: unknown) => {
  try {
    const s = JSON.stringify(input)
    return s.length > 80 ? `${s.slice(0, 80)}…` : s
  } catch {
    return ''
  }
}
const prettyOutput = (output: unknown) => {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

const chip =
  'inline-block rounded-full bg-surface-100 px-2.5 py-1 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-300'
const chipDanger =
  'inline-block rounded-full bg-red-100 px-2.5 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300'
const chipWarn =
  'inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300'
const chipInfo =
  'inline-block rounded-full bg-sky-100 px-2.5 py-1 text-xs text-sky-700 dark:bg-sky-950 dark:text-sky-300'

const goBackToSuite = () => {
  router.push({
    name: 'AiTestSuite',
    params: { tenantId: tenantId.value, suiteId: suiteId.value },
  })
}

const cancel = async () => {
  try {
    const updated = await store.cancelRun(
      tenantId.value,
      suiteId.value,
      runId.value,
    )
    run.value = updated
  } catch (error) {
    const detail =
      error instanceof FetcherError && error.body
        ? error.body
        : t('AiTests.cancelError')
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail,
      life: 5000,
    })
  }
}
</script>
