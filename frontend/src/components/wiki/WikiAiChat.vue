<template>
  <!-- backdrop + slide-over panel -->
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-200"
    leave-to-class="opacity-0"
  >
    <div
      v-if="aiChat.isOpen"
      class="fixed inset-0 z-50 bg-surface-950/40 backdrop-blur-[2px]"
      @click="aiChat.close()"
    />
  </Transition>

  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="translate-x-full"
    leave-active-class="transition-transform duration-200 ease-in"
    leave-to-class="translate-x-full"
  >
    <aside
      v-if="aiChat.isOpen"
      class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-surface-200 bg-surface-0 shadow-2xl dark:border-surface-800 dark:bg-surface-950"
    >
      <!-- header -->
      <header
        class="flex shrink-0 items-center gap-2 border-b border-surface-200 px-3 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] dark:border-surface-800"
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <IconChat class="h-5 w-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-surface-900 dark:text-surface-0">
            {{ $t('Chat.chatWithAi') }}
          </p>
          <p class="truncate text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Chat.wikiSubtitle') }}
          </p>
        </div>

        <!-- mode switch (read-only <-> edit-allowed) -->
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
          :class="
            isEdit
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'border border-surface-200 text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200'
          "
          :title="isEdit ? $t('Chat.mode.editTitle') : $t('Chat.mode.readTitle')"
          @click="aiChat.toggleMode()"
        >
          <IconPencil v-if="isEdit" class="h-3.5 w-3.5 shrink-0" />
          <IconLock v-else class="h-3.5 w-3.5 shrink-0" />
          <span>{{ isEdit ? $t('Chat.mode.edit') : $t('Chat.mode.read') }}</span>
        </button>

        <!-- quick settings: adjust the org system prompt -->
        <button
          type="button"
          :title="$t('Chat.config.settingsTitle')"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          @click="openSettings"
        >
          <IconCog class="h-4 w-4" />
        </button>

        <!-- clear conversation -->
        <button
          v-if="messages.length"
          type="button"
          :title="$t('Chat.clear')"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          @click="clearChat"
        >
          <IconBroom class="h-4 w-4" />
        </button>

        <!-- close -->
        <button
          type="button"
          :aria-label="$t('Chat.close')"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          @click="aiChat.close()"
        >
          <IconClose class="h-5 w-5" />
        </button>
      </header>

      <!-- messages -->
      <div ref="scrollRef" class="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4">
        <!-- empty state -->
        <div
          v-if="!messages.length"
          class="flex flex-col items-center gap-2 pt-12 text-center"
        >
          <span
            class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <IconChat class="h-6 w-6" />
          </span>
          <p class="text-sm font-medium text-surface-700 dark:text-surface-200">
            {{ $t('Chat.emptyTitle') }}
          </p>
          <p class="max-w-[16rem] text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Chat.emptyHint') }}
          </p>
        </div>

        <div
          v-for="(m, index) in messages"
          :key="m.id ? m.id : index"
          class="flex"
          :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[88%] space-y-2"
            :class="m.role === 'user' ? 'items-end' : 'items-start'"
          >
            <template
              v-for="(part, partIndex) in m.parts"
              :key="`${index}-${partIndex}`"
            >
              <!-- text -->
              <div
                v-if="part.type === 'text' && part.text"
                class="rounded-2xl px-3.5 py-2 text-sm"
                :class="
                  m.role === 'user'
                    ? 'rounded-br-md bg-primary text-primary-contrast whitespace-pre-wrap'
                    : 'rounded-bl-md bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-100'
                "
              >
                <span v-if="m.role === 'user'">{{ part.text }}</span>
                <MarkdownRenderer v-else :content="part.text" />
              </div>

              <!-- tool call -->
              <ToolCallCard
                v-else-if="normalizeToolPart(part)"
                :call="normalizeToolPart(part)!"
              />
            </template>
          </div>
        </div>

        <!-- thinking indicator -->
        <div v-if="isThinking" class="flex justify-start">
          <div
            class="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-surface-100 px-3.5 py-2.5 dark:bg-surface-800"
          >
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400 [animation-delay:-0.3s]" />
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400 [animation-delay:-0.15s]" />
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400" />
          </div>
        </div>

        <!-- error -->
        <div
          v-if="chatError"
          class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          <IconAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ $t('Chat.error') }}</span>
        </div>
      </div>

      <!-- input -->
      <form
        class="flex shrink-0 items-end gap-2 border-t border-surface-200 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-surface-800"
        @submit.prevent="handleSubmit"
      >
        <textarea
          ref="inputRef"
          v-model="input"
          rows="1"
          :placeholder="$t('Chat.inputPlaceholder')"
          class="max-h-32 min-w-0 flex-1 resize-none rounded-2xl border border-surface-300 bg-surface-0 px-3.5 py-2 text-sm text-surface-800 outline-none placeholder:text-surface-400 focus:border-primary dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
          @keydown.enter.exact.prevent="handleSubmit"
          @input="autoGrow"
        />
        <button
          v-if="isStreaming"
          type="button"
          :aria-label="$t('Chat.stop')"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-200 text-surface-700 transition-colors hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600"
          @click="stop"
        >
          <IconStop class="h-4 w-4" />
        </button>
        <button
          v-else
          type="submit"
          :aria-label="$t('Chat.send')"
          :disabled="!input.trim()"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast transition-colors hover:bg-primary-emphasis disabled:opacity-40"
        >
          <IconSend class="h-4 w-4" />
        </button>
      </form>
    </aside>
  </Transition>

  <!-- quick-settings dialog: edit this organisation's chat-agent prompt -->
  <Dialog
    v-model:visible="settingsOpen"
    modal
    :header="$t('Chat.config.settingsTitle')"
    class="w-[560px] max-w-[92vw]"
  >
    <div class="flex flex-col gap-1">
      <label
        for="chat-quick-system-prompt"
        class="text-sm font-medium text-surface-700 dark:text-surface-300"
      >
        {{ $t('Chat.config.systemPrompt') }}
      </label>
      <Textarea
        id="chat-quick-system-prompt"
        v-model="systemPrompt"
        class="w-full"
        rows="8"
        :maxlength="MAX_SYSTEM_PROMPT_CHARS"
        :placeholder="$t('Chat.config.placeholder')"
        :disabled="chatConfig.loading"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('Chat.config.systemPromptHint') }}
        </span>
        <span class="shrink-0 pl-3 text-xs text-surface-400 dark:text-surface-500">
          {{
            $t('Chat.config.charCount', {
              count: systemPrompt.length,
              max: MAX_SYSTEM_PROMPT_CHARS,
            })
          }}
        </span>
      </div>
    </div>
    <template #footer>
      <SecondaryButton
        :label="$t('Chat.close')"
        size="small"
        @click="settingsOpen = false"
      />
      <Button
        :label="$t('Chat.config.save')"
        size="small"
        :loading="chatConfig.saving"
        :disabled="chatConfig.loading || systemPrompt === savedSystemPrompt"
        @click="saveSettings"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { teamsAuthHeaders } from '@/utils/teamsSession'
import IconChat from '~icons/mdi/message-text-outline'
import IconClose from '~icons/mdi/close'
import IconSend from '~icons/mdi/send'
import IconStop from '~icons/mdi/stop'
import IconLock from '~icons/mdi/lock-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconBroom from '~icons/mdi/broom'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCog from '~icons/mdi/cog-outline'
import ToolCallCard from './ToolCallCard.vue'
import { normalizeToolPart } from './toolCall'
import { useToast } from 'primevue/usetoast'
import { useChatConfig, MAX_SYSTEM_PROMPT_CHARS } from '@/stores/chatConfig'

const route = useRoute()
const aiChat = useAiChat()
const chatConfig = useChatConfig()
const toast = useToast()
const { t } = useI18n()

const tenantId = computed(() => String(route.params.tenantId ?? ''))
const isEdit = computed(() => aiChat.mode === 'edit')

// quick-settings: this organisation's custom chat-agent system prompt
const settingsOpen = ref(false)
const systemPrompt = ref('')
const savedSystemPrompt = ref('')

const openSettings = async () => {
  settingsOpen.value = true
  if (!tenantId.value) return
  try {
    const config = await chatConfig.loadConfig(tenantId.value)
    systemPrompt.value = config.systemPrompt
    savedSystemPrompt.value = config.systemPrompt
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Chat.config.loadError'),
      life: 3000,
    })
  }
}

const saveSettings = async () => {
  if (!tenantId.value) return
  try {
    const config = await chatConfig.saveConfig(tenantId.value, {
      systemPrompt: systemPrompt.value,
    })
    systemPrompt.value = config.systemPrompt
    savedSystemPrompt.value = config.systemPrompt
    settingsOpen.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('Chat.config.saved'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Chat.config.saveError'),
      life: 3000,
    })
  }
}

const input = ref('')
const scrollRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

// One Chat instance per tenant. The transport hits our streaming endpoint; the
// JWT cookie authenticates automatically (same-origin fetch). shallowRef keeps
// the instance's own internal Vue refs intact (a deep ref would re-proxy them).
const chat = shallowRef<InstanceType<typeof Chat> | null>(null)

const initializeChat = () => {
  if (!tenantId.value) return
  chat.value = new Chat({
    transport: new DefaultChatTransport({
      api: `/api/v1/tenant/${tenantId.value}/chat`,
      // The transport does its own fetch, so the bearer session (Teams tab) has
      // to be attached here. A function, not a fixed object: the token is
      // replaced when a session is refreshed mid-conversation.
      headers: teamsAuthHeaders,
    }),
  })
}

watch(tenantId, initializeChat, { immediate: true })

const messages = computed<any[]>(() => chat.value?.messages ?? [])
const status = computed<string>(() => chat.value?.status ?? 'ready')
const isStreaming = computed(
  () => status.value === 'streaming' || status.value === 'submitted',
)
const chatError = computed(() => Boolean(chat.value?.error))

// "Thinking" = a request is in flight but the assistant has not produced any
// visible part for its current message yet (e.g. deciding on a tool call).
const isThinking = computed(() => {
  if (!isStreaming.value) return false
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'assistant') return true
  const hasVisible = (last.parts ?? []).some(
    (p: any) => (p.type === 'text' && p.text) || normalizeToolPart(p),
  )
  return !hasVisible
})

const scrollToBottom = async () => {
  await nextTick()
  scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight })
}

// keep the newest content in view as it streams
watch(
  () => [messages.value.length, JSON.stringify(messages.value.at(-1)?.parts ?? [])],
  scrollToBottom,
)

// focus the input when the panel opens
watch(
  () => aiChat.isOpen,
  (open) => {
    if (open) {
      scrollToBottom()
      nextTick(() => inputRef.value?.focus())
    }
  },
)

const autoGrow = () => {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`
}

const handleSubmit = () => {
  const text = input.value.trim()
  if (!text || !chat.value || isStreaming.value) return
  // send the current mode alongside the message so the backend enables the
  // matching tool set (read-only vs. edit-allowed)
  chat.value.sendMessage({ text }, { body: { mode: aiChat.mode } })
  input.value = ''
  nextTick(autoGrow)
}

const stop = () => {
  chat.value?.stop()
}

const clearChat = () => {
  if (chat.value) chat.value.messages = []
}
</script>
