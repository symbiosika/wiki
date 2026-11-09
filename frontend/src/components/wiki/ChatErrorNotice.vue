<template>
  <div
    class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
    role="alert"
  >
    <IconAlert class="mt-0.5 h-4 w-4 shrink-0" />
    <div class="min-w-0 flex-1">
      <p>{{ $t(`Chat.streamError.${parsed.code}`) }}</p>
      <details v-if="parsed.detail" class="mt-1">
        <summary
          class="cursor-pointer select-none opacity-80 hover:opacity-100"
        >
          {{ $t('Chat.streamError.details') }}
        </summary>
        <pre
          class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] opacity-90"
          >{{ parsed.detail }}</pre
        >
      </details>
    </div>
    <button
      v-if="retryable"
      type="button"
      class="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
      @click="emit('retry')"
    >
      {{ $t('Chat.streamError.retry') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import IconAlert from '~icons/mdi/alert-circle-outline'
import { parseChatStreamError } from '@/utils/chatStreamError'

/**
 * Error box of the wiki chat: explains in plain words what failed (busy
 * model, OpenRouter privacy settings, API key, credits …) and keeps the
 * provider's own message one click away for whoever has to fix it.
 */
const props = withDefaults(
  defineProps<{ error: Error | undefined | null; retryable?: boolean }>(),
  { retryable: false },
)
const emit = defineEmits<{ retry: [] }>()

const parsed = computed(() => parseChatStreamError(props.error?.message))
</script>
