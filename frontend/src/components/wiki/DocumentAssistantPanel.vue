<template>
  <Transition name="assistant-slide">
    <aside
      v-if="assistant.open"
      class="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-surface-200 bg-surface-0 shadow-xl sm:w-[380px] dark:border-surface-700 dark:bg-surface-900"
    >
      <!-- header -->
      <div
        class="flex items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700"
      >
        <IconRobot class="h-5 w-5 text-primary" />
        <span class="flex-1 font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('Assistant.title') }}
        </span>
        <button
          type="button"
          class="rounded-md p-1 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
          :aria-label="$t('Common.close')"
          @click="assistant.closePanel()"
        >
          <IconClose class="h-5 w-5" />
        </button>
      </div>

      <!-- messages -->
      <div ref="scrollRef" class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <p
          v-if="assistant.messages.length === 0"
          class="mt-6 text-center text-sm text-surface-400 dark:text-surface-500"
        >
          {{ $t('Assistant.hint') }}
        </p>

        <div
          v-for="(m, i) in assistant.messages"
          :key="i"
          class="flex"
          :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
            :class="bubbleClass(m)"
          >
            <template v-if="m.pending">
              <span class="inline-flex items-center gap-2">
                <IconLoading class="h-4 w-4 animate-spin" />
                {{ $t('Assistant.working') }}
              </span>
            </template>
            <template v-else-if="m.error && !m.text">
              {{ $t('Assistant.error') }}
            </template>
            <span v-else-if="m.role === 'user'" class="whitespace-pre-wrap">{{
              m.text
            }}</span>
            <MarkdownRenderer v-else :content="m.text" />
          </div>
        </div>
      </div>

      <!-- input -->
      <div class="border-t border-surface-200 p-3 dark:border-surface-700">
        <div
          v-if="isRecording || isConnecting"
          class="mb-2 flex items-center gap-2 text-xs text-red-500"
        >
          <span class="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {{ isConnecting ? $t('Protocol.connecting') : $t('Protocol.listening') }}
        </div>
        <div class="flex items-end gap-2">
          <Textarea
            v-model="input"
            rows="2"
            class="flex-1 resize-none text-sm"
            :placeholder="$t('Assistant.placeholder')"
            :disabled="assistant.busy"
            @keydown.enter.exact.prevent="send"
          />
          <button
            type="button"
            :disabled="assistant.busy || isConnecting"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:opacity-60"
            :class="
              isRecording
                ? 'animate-pulse bg-red-500 hover:bg-red-600'
                : 'bg-surface-500 hover:bg-surface-600'
            "
            :aria-label="isRecording ? $t('Protocol.stop') : $t('Protocol.record')"
            @click="toggleRecording"
          >
            <IconStop v-if="isRecording" class="h-4 w-4" />
            <IconMic v-else class="h-4 w-4" />
          </button>
          <button
            type="button"
            :disabled="!input.trim() || assistant.busy"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-emphasis disabled:opacity-60"
            :aria-label="$t('Assistant.send')"
            @click="send"
          >
            <IconSend class="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import IconRobot from '~icons/mdi/robot-outline'
import IconClose from '~icons/mdi/close'
import IconMic from '~icons/mdi/microphone'
import IconStop from '~icons/mdi/stop'
import IconSend from '~icons/mdi/send'
import IconLoading from '~icons/mdi/loading'
import { useDocumentAssistant } from '@/stores/documentAssistant'
import type { AssistantMessage } from '@/stores/documentAssistant'
import { useRealtimeTranscription } from '@/composables/useRealtimeTranscription'

const props = defineProps<{ tenantId: string; entryId: string }>()
const emit = defineEmits<{ applied: [] }>()

const { t } = useI18n()
const toast = useToast()
const assistant = useDocumentAssistant()

const input = ref('')
const scrollRef = ref<HTMLElement | null>(null)

const { isRecording, isConnecting, toggleRecording } = useRealtimeTranscription({
  tenantId: () => props.tenantId,
  onTranscriptionUpdate: (text) => {
    input.value = text
  },
  onTranscriptionComplete: (text) => {
    input.value = text
  },
  onError: (message) => {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: message,
      life: 4000,
    })
  },
})

const bubbleClass = (m: AssistantMessage): string => {
  if (m.role === 'user') return 'bg-primary text-primary-contrast'
  if (m.error) return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
  return 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-100'
}

const scrollToBottom = () => {
  nextTick(() => {
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(() => assistant.messages.length, scrollToBottom)

const send = async () => {
  const text = input.value.trim()
  if (!text || assistant.busy) return
  input.value = ''
  try {
    const res = await assistant.assist(props.tenantId, props.entryId, text)
    if (res.appliedEdits > 0) emit('applied')
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Assistant.error'),
      life: 4000,
    })
  }
}
</script>

<style scoped>
.assistant-slide-enter-active,
.assistant-slide-leave-active {
  transition: transform 0.2s ease;
}
.assistant-slide-enter-from,
.assistant-slide-leave-to {
  transform: translateX(100%);
}
</style>
