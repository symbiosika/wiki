<template>
  <div class="flex flex-col items-center gap-2">
    <button
      type="button"
      :disabled="isTranscribing"
      class="flex items-center justify-center rounded-full text-white shadow-md transition-colors disabled:opacity-60"
      :class="[
        sizeClass,
        isRecording
          ? 'animate-pulse bg-red-500 hover:bg-red-600'
          : 'bg-primary hover:bg-primary-emphasis',
      ]"
      :aria-label="isRecording ? $t('Protocol.stop') : $t('Protocol.record')"
      @click="toggleRecording"
    >
      <IconStop v-if="isRecording" :class="iconClass" />
      <IconLoading v-else-if="isTranscribing" :class="[iconClass, 'animate-spin']" />
      <IconMic v-else :class="iconClass" />
    </button>

    <span
      v-if="showStatus"
      class="text-sm text-surface-500 dark:text-surface-400"
    >
      <template v-if="isRecording">{{ $t('Protocol.recording') }}</template>
      <template v-else-if="isTranscribing">{{ $t('Protocol.transcribing') }}</template>
      <template v-else>{{ $t('Protocol.clickToRecord') }}</template>
    </span>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

    <div
      v-if="showResult && transcription"
      class="mt-2 w-full rounded-md border border-surface-200 bg-surface-50 p-3 text-sm text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
    >
      {{ transcription }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import IconMic from '~icons/mdi/microphone'
import IconStop from '~icons/mdi/stop'
import IconLoading from '~icons/mdi/loading'
import { useTranscription } from '@/composables/useTranscription'

const props = withDefaults(
  defineProps<{
    tenantId: string
    size?: 'sm' | 'md' | 'lg'
    showStatus?: boolean
    showResult?: boolean
  }>(),
  { size: 'lg', showStatus: true, showResult: true },
)

const emit = defineEmits<{
  'transcription-complete': [text: string]
  error: [message: string]
}>()

const {
  isRecording,
  isTranscribing,
  transcription,
  error,
  toggleRecording,
} = useTranscription({
  tenantId: () => props.tenantId,
  onTranscriptionComplete: (text) => emit('transcription-complete', text),
  onError: (message) => emit('error', message),
})

const sizeClass = computed(
  () =>
    ({
      sm: 'h-12 w-12',
      md: 'h-16 w-16',
      lg: 'h-20 w-20',
    })[props.size],
)
const iconClass = computed(
  () =>
    ({
      sm: 'h-5 w-5',
      md: 'h-7 w-7',
      lg: 'h-9 w-9',
    })[props.size],
)

defineExpose({ toggleRecording })
</script>
