<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('Chat.config.title')" />

    <ManageTabs />

    <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('Chat.config.tabDescription', { tenant: tenantName }) }}
    </p>

    <div class="flex flex-col gap-1">
      <label
        for="chat-system-prompt"
        class="text-sm font-medium text-surface-700 dark:text-surface-300"
      >
        {{ $t('Chat.config.systemPrompt') }}
      </label>
      <Textarea
        id="chat-system-prompt"
        v-model="systemPrompt"
        class="w-full"
        rows="10"
        :maxlength="MAX_SYSTEM_PROMPT_CHARS"
        :placeholder="$t('Chat.config.placeholder')"
        :disabled="chatConfig.loading"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('Chat.config.systemPromptHint') }}
        </span>
        <span
          class="shrink-0 pl-3 text-xs text-surface-400 dark:text-surface-500"
        >
          {{
            $t('Chat.config.charCount', {
              count: systemPrompt.length,
              max: MAX_SYSTEM_PROMPT_CHARS,
            })
          }}
        </span>
      </div>
    </div>
    <div class="mt-3 flex justify-end">
      <Button
        :label="$t('Chat.config.save')"
        size="small"
        :loading="chatConfig.saving"
        :disabled="chatConfig.loading || systemPrompt === savedSystemPrompt"
        @click="saveSystemPrompt"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useChatConfig, MAX_SYSTEM_PROMPT_CHARS } from '@/stores/chatConfig'

const { t } = useI18n()
const toast = useToast()
const route = useRoute()
const app = useApp()
const chatConfig = useChatConfig()

// The chat agent is configured for the currently active organisation.
const tenantId = computed(() => String(route.params.tenantId))
const tenantName = computed(() => app.currentTenant?.name ?? '')

const systemPrompt = ref('')
const savedSystemPrompt = ref('')

onMounted(async () => {
  await app.waitForInit()
  await loadChatConfig()
})

const loadChatConfig = async () => {
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

const saveSystemPrompt = async () => {
  try {
    const config = await chatConfig.saveConfig(tenantId.value, {
      systemPrompt: systemPrompt.value,
    })
    systemPrompt.value = config.systemPrompt
    savedSystemPrompt.value = config.systemPrompt
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
</script>
