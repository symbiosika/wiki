<template>
  <div class="text-xs">
    <button
      type="button"
      class="group inline-flex max-w-full items-center gap-1 rounded px-0.5 py-0.5 text-left transition-colors"
      :class="
        call.isError
          ? 'text-red-400/90 hover:text-red-500 dark:text-red-400/80'
          : 'text-surface-400 hover:text-surface-600 dark:text-surface-500 dark:hover:text-surface-300'
      "
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="truncate">{{ label }}</span>

      <!-- running: the three dots breathe, nothing else moves -->
      <span v-if="running" class="ask-dots shrink-0" aria-hidden="true">
        <span>·</span><span>·</span><span>·</span>
      </span>

      <!-- finished: a chevron that only shows up on hover / when open -->
      <IconChevron
        v-else
        class="h-3 w-3 shrink-0 transition-all"
        :class="
          expanded
            ? 'rotate-180 opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        "
      />
    </button>

    <!-- details, on demand -->
    <div
      v-if="expanded"
      class="mt-1 space-y-2 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 dark:border-surface-800 dark:bg-surface-900"
    >
      <div v-if="hasInput">
        <p
          class="mb-1 text-[11px] font-semibold text-surface-500 dark:text-surface-400"
        >
          {{ $t('Chat.toolInput') }}
        </p>
        <pre
          class="max-h-48 overflow-auto rounded bg-surface-100/70 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-surface-600 dark:bg-surface-950/60 dark:text-surface-300"
          >{{ pretty(call.input) }}</pre
        >
      </div>

      <div v-if="call.errorText">
        <p class="mb-1 text-[11px] font-semibold text-red-500">
          {{ $t('Chat.toolError') }}
        </p>
        <pre
          class="max-h-48 overflow-auto rounded bg-red-100/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >{{ call.errorText }}</pre
        >
      </div>

      <div v-else-if="hasOutput">
        <p
          class="mb-1 text-[11px] font-semibold text-surface-500 dark:text-surface-400"
        >
          {{ $t('Chat.toolOutput') }}
        </p>
        <pre
          class="max-h-64 overflow-auto rounded bg-surface-100/70 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-surface-600 dark:bg-surface-950/60 dark:text-surface-300"
          >{{ pretty(call.output) }}</pre
        >
      </div>

      <p
        v-else-if="!hasInput"
        class="text-[11px] text-surface-400 dark:text-surface-500"
      >
        {{ $t('Ask.tool.noDetails') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One tool call, told the way a person reads it: a quiet grey line of text.
 *
 * While the tool runs the label is in present tense with three breathing dots
 * ("Wiki durchsuchen ···"); once it is done the same line stays put in past
 * tense and can be clicked open for the raw input and result. Nothing about it
 * competes with the answer — that is the whole point of this view, as opposed
 * to the technical ToolCallCard used in the wiki slide-over.
 */
import IconChevron from '~icons/mdi/chevron-down'
import {
  isToolRunning,
  type NormalizedToolCall,
} from '@/components/wiki/toolCall'

const props = defineProps<{ call: NormalizedToolCall }>()
const { t, te } = useI18n()

const expanded = ref(false)
const running = computed(() => isToolRunning(props.call))

/**
 * Localised label. Tools carry a running and a finished wording ("Wiki
 * durchsuchen" vs. "Wiki durchsucht"); both fall back to the shared tool names
 * of the wiki chat, and finally to the raw tool name for anything unknown.
 */
const label = computed(() => {
  const state = running.value ? 'running' : 'done'
  const specific = `Ask.tool.${props.call.toolName}.${state}`
  if (te(specific)) return t(specific)
  const shared = `Chat.tools.${props.call.toolName}`
  if (te(shared)) return t(shared)
  return props.call.toolName
})

const hasInput = computed(
  () =>
    props.call.input != null &&
    Object.keys(props.call.input as object).length > 0,
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

<style scoped>
/* three dots fading in turn — deliberately slow, so it reads as "working" */
.ask-dots span {
  animation: ask-dot 1.4s ease-in-out infinite;
  opacity: 0.25;
}
.ask-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.ask-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes ask-dot {
  0%,
  60%,
  100% {
    opacity: 0.25;
  }
  30% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ask-dots span {
    animation: none;
    opacity: 0.6;
  }
}
</style>
