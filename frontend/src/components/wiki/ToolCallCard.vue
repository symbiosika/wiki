<template>
  <div
    class="w-full overflow-hidden rounded-xl border text-xs"
    :class="
      call.isError
        ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30'
        : 'border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900'
    "
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left"
      @click="expanded = !expanded"
    >
      <!-- status icon -->
      <IconSpinner
        v-if="running"
        class="h-4 w-4 shrink-0 animate-spin text-primary"
      />
      <IconAlert
        v-else-if="call.isError"
        class="h-4 w-4 shrink-0 text-red-500"
      />
      <IconCheck v-else class="h-4 w-4 shrink-0 text-emerald-500" />

      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <IconTool class="h-3.5 w-3.5 shrink-0 text-surface-400" />
        <span class="truncate font-medium text-surface-700 dark:text-surface-200">
          {{ label }}
        </span>
      </span>

      <IconChevron
        class="h-4 w-4 shrink-0 text-surface-400 transition-transform"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <div v-if="expanded" class="space-y-2 border-t border-surface-200 px-3 py-2 dark:border-surface-800">
      <div v-if="hasInput">
        <p class="mb-1 font-semibold text-surface-500 dark:text-surface-400">
          {{ $t('Chat.toolInput') }}
        </p>
        <pre class="max-h-48 overflow-auto rounded bg-surface-100/70 p-2 font-mono text-[11px] leading-relaxed text-surface-700 dark:bg-surface-950/60 dark:text-surface-200">{{ pretty(call.input) }}</pre>
      </div>
      <div v-if="call.errorText">
        <p class="mb-1 font-semibold text-red-500">{{ $t('Chat.toolError') }}</p>
        <pre class="max-h-48 overflow-auto rounded bg-red-100/60 p-2 font-mono text-[11px] leading-relaxed text-red-700 dark:bg-red-950/40 dark:text-red-300">{{ call.errorText }}</pre>
      </div>
      <div v-else-if="hasOutput">
        <p class="mb-1 font-semibold text-surface-500 dark:text-surface-400">
          {{ $t('Chat.toolOutput') }}
        </p>
        <pre class="max-h-48 overflow-auto rounded bg-surface-100/70 p-2 font-mono text-[11px] leading-relaxed text-surface-700 dark:bg-surface-950/60 dark:text-surface-200">{{ pretty(call.output) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconTool from '~icons/mdi/wrench-outline'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconSpinner from '~icons/mdi/loading'
import IconChevron from '~icons/mdi/chevron-down'
import { isToolRunning, type NormalizedToolCall } from './toolCall'

const props = defineProps<{ call: NormalizedToolCall }>()
const { t, te } = useI18n()

const expanded = ref(false)
const running = computed(() => isToolRunning(props.call))

// Friendly, localised label; falls back to the raw tool name.
const label = computed(() => {
  const key = `Chat.tools.${props.call.toolName}`
  return te(key) ? t(key) : props.call.toolName
})

const hasInput = computed(
  () => props.call.input != null && Object.keys(props.call.input as object).length > 0,
)
const hasOutput = computed(() => props.call.output != null)

const pretty = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>
