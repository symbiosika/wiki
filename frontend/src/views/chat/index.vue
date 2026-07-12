<template>
  <div class="p-4">
    <div
      v-if="chat?.state?.messagesRef"
      v-for="(m, index) in chat.state.messagesRef"
      :key="m.id ? m.id : index"
      class="mb-4"
    >
      {{ m.role === 'user' ? 'User: ' : 'AI: ' }}
      <div
        v-for="(part, partIndex) in m.parts"
        :key="`${m.id}-${part.type}-${partIndex}`"
      >
        <div v-if="part.type === 'text'">{{ part.text }}</div>
      </div>
    </div>

    <form @submit="handleSubmit" class="mt-4">
      <input
        v-model="input"
        placeholder="Say something..."
        class="w-full border border-surface-300 rounded px-3 py-2 dark:border-surface-600 dark:bg-surface-800"
        :disabled="chat?.state?.statusRef === 'streaming'"
      />
    </form>
  </div>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const input = ref('')

const tenantId = computed(() => route.params.tenantId as string)

const chatApiUrl = computed(() => {
  return `/api/v1/tenant/${tenantId.value}/chat`
})

const chat = ref<any>(null)

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
  { immediate: true }
)

const handleSubmit = (e: Event) => {
  e.preventDefault()
  if (chat.value) {
    chat.value.sendMessage({ text: input.value })
    input.value = ''
  }
}
</script>
