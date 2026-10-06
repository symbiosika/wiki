<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('Wiki.notify.title')"
    class="w-[560px] max-w-[92vw]"
  >
    <div v-if="loading" class="flex justify-center py-6">
      <IconSpinner class="h-6 w-6 animate-spin text-surface-400" />
    </div>
    <Message v-else-if="loadFailed" severity="error">
      {{ $t('Wiki.notify.loadError') }}
    </Message>
    <form v-else-if="audience" class="flex flex-col gap-4" @submit.prevent="send">
      <Message
        :severity="audience.scope === 'personal' ? 'warn' : 'info'"
        size="small"
      >
        {{ audienceText }}
      </Message>
      <Message v-if="!audience.canNotify" severity="warn" size="small">
        {{ $t('Wiki.notify.noPermission') }}
      </Message>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ $t('Wiki.notify.subject') }}</span>
        <InputText v-model="subject" class="w-full" :maxlength="100" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ $t('Wiki.notify.message') }}</span>
        <Textarea
          v-model="message"
          class="w-full"
          rows="7"
          auto-resize
          :maxlength="5000"
        />
        <small class="text-surface-500 dark:text-surface-400">
          {{ $t('Wiki.notify.linkHint') }}
        </small>
      </label>

      <div class="flex justify-end gap-2">
        <SecondaryButton :label="$t('Common.cancel')" @click="visible = false" />
        <Button
          type="submit"
          :label="$t('Wiki.notify.send', { count: audience.recipientCount })"
          :loading="sending"
          :disabled="!canSend"
        />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import IconSpinner from '~icons/mdi/loading'
import { useWiki, type WikiNotifyAudience } from '@/stores/wiki'

const visible = defineModel<boolean>('visible', { required: true })

const props = defineProps<{
  tenantId: string
  pageId: string
  pageTitle: string
}>()

const wiki = useWiki()
const toast = useToast()
const { t } = useI18n()

const audience = ref<WikiNotifyAudience | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const sending = ref(false)
const subject = ref('')
const message = ref('')

const audienceText = computed(() => {
  const a = audience.value
  if (!a) return ''
  if (a.scope === 'team') {
    return t('Wiki.notify.audienceTeam', {
      count: a.recipientCount,
      team: a.teamName ?? '',
    })
  }
  if (a.scope === 'organisation') {
    return t('Wiki.notify.audienceOrganisation', { count: a.recipientCount })
  }
  return t('Wiki.notify.audiencePersonal')
})

const canSend = computed(
  () =>
    !!audience.value?.canNotify &&
    audience.value.recipientCount > 0 &&
    message.value.trim() !== '' &&
    !sending.value,
)

const send = async () => {
  if (!canSend.value) return
  sending.value = true
  try {
    const result = await wiki.notifyPageMembers(props.tenantId, props.pageId, {
      subject: subject.value.trim() || null,
      message: message.value,
    })
    toast.add({
      severity: 'success',
      summary: t('Wiki.notify.sent', { count: result.recipientCount }),
      life: 4000,
    })
    visible.value = false
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Wiki.notify.sendError'),
      life: 5000,
    })
  } finally {
    sending.value = false
  }
}

watch(visible, async (open) => {
  if (!open) return
  const title = props.pageTitle.trim()
  subject.value = t('Wiki.notify.defaultSubject', { title })
  message.value = t('Wiki.notify.defaultMessage', { title })
  audience.value = null
  loadFailed.value = false
  loading.value = true
  try {
    audience.value = await wiki.getNotifyAudience(props.tenantId, props.pageId)
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
})
</script>
