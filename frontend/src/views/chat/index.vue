<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col px-4 sm:px-6">
    <!-- messages -->
    <div ref="scrollRef" class="flex-1 space-y-3 overflow-y-auto py-4">
      <p
        v-if="!messages.length"
        class="pt-16 text-center text-sm text-surface-400 dark:text-surface-500"
      >
        {{ $t('Chat.noMessages') }}
      </p>

      <div
        v-for="(m, index) in messages"
        :key="m.id ? m.id : index"
        class="flex"
        :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm sm:max-w-[75%]"
          :class="
            m.role === 'user'
              ? 'rounded-br-md bg-primary text-primary-contrast whitespace-pre-wrap'
              : 'rounded-bl-md bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-100'
          "
        >
          <template
            v-for="(part, partIndex) in m.parts"
            :key="`${m.id}-${part.type}-${partIndex}`"
          >
            <template v-if="part.type === 'text'">
              <span v-if="m.role === 'user'">{{ part.text }}</span>
              <MarkdownRenderer v-else :content="part.text" />
            </template>
          </template>
        </div>
      </div>
    </div>

    <!-- input -->
    <form
      class="flex shrink-0 items-center gap-2 border-t border-surface-200 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-surface-800"
      @submit="handleSubmit"
    >
      <input
        v-model="input"
        :placeholder="$t('Chat.inputPlaceholder')"
        class="min-w-0 flex-1 rounded-full border border-surface-300 bg-surface-0 px-4 py-2.5 text-base outline-none placeholder:text-surface-400 focus:border-primary lg:py-2 lg:text-sm dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
        :disabled="isStreaming"
      />
      <button
        type="submit"
        :aria-label="$t('Chat.send')"
        :disabled="isStreaming || !input.trim()"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast transition-colors hover:bg-primary-emphasis disabled:opacity-40 lg:h-9 lg:w-9"
      >
        <IconSend class="h-5 w-5 lg:h-4 lg:w-4" />
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import IconSend from '~icons/mdi/send'

const route = useRoute()
const input = ref('')
const scrollRef = ref<HTMLElement | null>(null)

const tenantId = computed(() => route.params.tenantId as string)

const chatApiUrl = computed(() => {
  return `/api/v1/tenant/${tenantId.value}/chat`
})

const chat = ref<any>(null)

const messages = computed(() => chat.value?.state?.messagesRef ?? [])
const isStreaming = computed(() => chat.value?.state?.statusRef === 'streaming')

const initializeChat = () => {
  if (tenantId.value) {
    chat.value = new Chat({
      transport: new DefaultChatTransport({ api: chatApiUrl.value }),
    }) as any
  }
}

// Initialize chat when tenantId is available
watch(
  tenantId,
  () => {
    initializeChat()
  },
  { immediate: true },
)

// keep the newest message in view
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight })
  },
)

const handleSubmit = (e: Event) => {
  e.preventDefault()
  if (chat.value && input.value.trim()) {
    chat.value.sendMessage({ text: input.value })
    input.value = ''
  }
}
</script>
