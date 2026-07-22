<template>
  <div class="mx-auto max-w-3xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('Notifications.title')">
      <template #actions>
        <SecondaryButton
          v-if="store.messages.length > 0"
          :label="$t('Notifications.confirmAll')"
          size="small"
          @click="confirmAll"
        >
          <template #icon><IconCheckAll /></template>
        </SecondaryButton>
      </template>
    </ManageHeader>

    <p class="mb-5 -mt-3 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('Notifications.subtitle') }}
    </p>

    <!-- list -->
    <ul v-if="store.messages.length > 0" class="flex flex-col gap-2">
      <li
        v-for="m in store.messages"
        :key="m.id"
        class="flex items-start gap-3 rounded-lg border border-surface-200 bg-surface-0 px-4 py-3 dark:border-surface-700 dark:bg-surface-900"
      >
        <!-- severity icon -->
        <span
          class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          :class="iconWrapClass(m.messageType)"
        >
          <component :is="iconFor(m.messageType)" class="h-4 w-4" />
        </span>

        <!-- text -->
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-surface-900 dark:text-surface-0">
            {{ displayText(m) }}
          </p>
          <p
            v-if="m.meta?.error"
            class="mt-0.5 text-xs break-words text-red-600 dark:text-red-400"
          >
            {{ m.meta.error }}
          </p>
          <p class="mt-0.5 text-xs text-surface-400 dark:text-surface-500">
            {{ formatDateTime(m.createdAt) }}
          </p>
        </div>

        <!-- actions -->
        <div class="flex shrink-0 items-center gap-1">
          <SecondaryButton
            v-if="canOpen(m)"
            :label="$t('Notifications.open')"
            size="small"
            :disabled="opening === m.id"
            @click="open(m)"
          />
          <button
            type="button"
            :title="$t('Notifications.markRead')"
            class="flex h-8 w-8 items-center justify-center rounded-md text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            @click="confirmOne(m.id)"
          >
            <IconCheck class="h-4 w-4" />
          </button>
        </div>
      </li>
    </ul>

    <!-- empty state -->
    <div
      v-else-if="!store.loading"
      class="rounded-lg border border-dashed border-surface-300 px-6 py-12 text-center dark:border-surface-600"
    >
      <IconInbox
        class="mx-auto h-10 w-10 text-surface-300 dark:text-surface-600"
      />
      <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Notifications.empty') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import IconCheck from '~icons/mdi/check'
import IconCheckAll from '~icons/mdi/check-all'
import IconInbox from '~icons/mdi/inbox-arrow-down-outline'
import IconSuccess from '~icons/mdi/check-circle-outline'
import IconError from '~icons/mdi/alert-circle-outline'
import IconWarning from '~icons/mdi/alert-outline'
import IconInfo from '~icons/mdi/information-outline'
import { useNotificationsStore } from '@/stores/notifications'
import { fetcher } from '@/utils/fetcher'
import type { IngestJob } from '@/stores/wiki'
import type { MessageType, UserMessage } from '@/types/notifications'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const store = useNotificationsStore()

const tenantId = computed(() => String(route.params.tenantId ?? ''))
const opening = ref<string | null>(null)

onMounted(() => {
  store.load().catch(() => {})
})

/** Full date + time in the viewer's local timezone (UTC-aware). */
const formatDateTime = (value: string | null | undefined) =>
  parseServerDate(value)?.toLocaleString() ?? '-'

/** A completed wiki-import message can be opened straight to its page. */
const canOpen = (m: UserMessage) =>
  m.messageType === 'success' &&
  m.meta?.jobType === 'knowledge:ingest' &&
  !!m.meta?.jobId

/** Friendlier label for job-completion messages; fall back to the raw text. */
const displayText = (m: UserMessage) => {
  if (m.meta?.jobType === 'knowledge:ingest') {
    return m.messageType === 'success'
      ? t('Notifications.ingest.success')
      : t('Notifications.ingest.failed')
  }
  return m.message
}

const iconFor = (type: MessageType) => {
  switch (type) {
    case 'success':
      return IconSuccess
    case 'error':
      return IconError
    case 'warning':
      return IconWarning
    default:
      return IconInfo
  }
}

const iconWrapClass = (type: MessageType) => {
  switch (type) {
    case 'success':
      return 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
    case 'error':
      return 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
    case 'warning':
      return 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
    default:
      return 'bg-primary/10 text-primary'
  }
}

const confirmOne = async (id: string) => {
  try {
    await store.confirm(id)
  } catch {
    /* a failed confirm just leaves the message in place */
  }
}

const confirmAll = async () => {
  try {
    await store.confirmAll()
  } catch {
    /* leave the list untouched on error */
  }
}

/**
 * Open the page an import created: fetch the finished job, read its result
 * (`{ knowledgeText }`) and navigate. Then check the message off.
 */
const open = async (m: UserMessage) => {
  const jobId = m.meta?.jobId
  if (!jobId || !tenantId.value) return
  opening.value = m.id
  try {
    const job = await fetcher.get<IngestJob>(
      `/api/v1/tenant/${tenantId.value}/jobs/${jobId}`,
    )
    const pageId = job.result?.knowledgeText?.id
    if (!pageId) throw new Error('no page id')
    await confirmOne(m.id)
    router.push({
      name: 'WikiPage',
      params: { tenantId: tenantId.value, pageId },
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Notifications.openError'),
      life: 5000,
    })
  } finally {
    opening.value = null
  }
}
</script>
