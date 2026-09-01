<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('AgentInstructions.title')" />

    <ManageTabs />

    <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('AgentInstructions.tabDescription', { tenant: tenantName }) }}
    </p>

    <div class="flex flex-col gap-1">
      <label
        for="agent-instructions-content"
        class="text-sm font-medium text-surface-700 dark:text-surface-300"
      >
        {{ $t('AgentInstructions.content') }}
      </label>
      <Textarea
        id="agent-instructions-content"
        v-model="content"
        class="w-full font-mono text-sm"
        rows="18"
        :maxlength="MAX_INSTRUCTIONS_CHARS"
        :placeholder="$t('AgentInstructions.placeholder')"
        :disabled="store.loading"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('AgentInstructions.contentHint') }}
        </span>
        <span
          class="shrink-0 pl-3 text-xs text-surface-400 dark:text-surface-500"
        >
          {{
            $t('AgentInstructions.charCount', {
              count: content.length,
              max: MAX_INSTRUCTIONS_CHARS,
            })
          }}
        </span>
      </div>
    </div>

    <div class="mt-3 flex items-center justify-between gap-3">
      <span
        v-if="lastSavedAt"
        class="text-xs text-surface-400 dark:text-surface-500"
      >
        {{ $t('AgentInstructions.lastSaved', { date: lastSavedAt }) }}
      </span>
      <span v-else class="text-xs text-surface-400 dark:text-surface-500">
        {{ $t('AgentInstructions.notConfigured') }}
      </span>

      <div class="flex shrink-0 gap-2">
        <SecondaryButton
          v-if="exists"
          :label="$t('AgentInstructions.remove')"
          size="small"
          :disabled="store.saving"
          @click="confirmRemove"
        >
          <template #icon><IconTrash /></template>
        </SecondaryButton>
        <Button
          :label="$t('AgentInstructions.save')"
          size="small"
          :loading="store.saving"
          :disabled="store.loading || !dirty"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import IconTrash from '~icons/mdi/trash-can-outline'
import { useAgentInstructions } from '@/stores/agentInstructions'

/**
 * Generous but bounded: the instructions are prepended to every agent session,
 * so an unbounded page would quietly eat the model's context window.
 */
const MAX_INSTRUCTIONS_CHARS = 20000

const { t, locale } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const route = useRoute()
const app = useApp()
const store = useAgentInstructions()

// Instructions are maintained for the currently active organisation.
const tenantId = computed(() => String(route.params.tenantId))
const tenantName = computed(() => app.currentTenant?.name ?? '')

const content = ref('')
const savedContent = ref('')
/** Null until the organisation has saved instructions at least once. */
const updatedAt = ref<string | null>(null)

const exists = computed(() => updatedAt.value !== null)
const dirty = computed(() => content.value !== savedContent.value)

const lastSavedAt = computed(() =>
  updatedAt.value
    ? new Date(updatedAt.value).toLocaleString(locale.value)
    : null,
)

onMounted(async () => {
  await app.waitForInit()
  await load()
})

const load = async () => {
  try {
    const instructions = await store.load(tenantId.value)
    content.value = instructions?.content ?? ''
    savedContent.value = content.value
    updatedAt.value = instructions?.updatedAt ?? null
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('AgentInstructions.loadError'),
      life: 3000,
    })
  }
}

const save = async () => {
  try {
    const instructions = await store.save(tenantId.value, content.value)
    savedContent.value = instructions.content
    content.value = instructions.content
    updatedAt.value = instructions.updatedAt
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('AgentInstructions.saved'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('AgentInstructions.saveError'),
      life: 4000,
    })
  }
}

const confirmRemove = () => {
  confirm.require({
    message: t('AgentInstructions.removeConfirm'),
    header: t('AgentInstructions.remove'),
    rejectProps: {
      label: t('Common.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: remove,
  })
}

const remove = async () => {
  try {
    await store.remove(tenantId.value)
    content.value = ''
    savedContent.value = ''
    updatedAt.value = null
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('AgentInstructions.removed'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('AgentInstructions.removeError'),
      life: 4000,
    })
  }
}
</script>
