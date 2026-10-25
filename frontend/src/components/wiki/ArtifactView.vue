<template>
  <div
    ref="rootRef"
    class="flex h-full min-h-0 flex-col bg-surface-0 dark:bg-surface-950"
  >
    <!-- toolbar: title + version on the left, actions on the right -->
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-surface-200 px-4 py-2 dark:border-surface-800"
    >
      <IconArtifact class="h-4 w-4 shrink-0 text-primary" />
      <div class="flex min-w-0 flex-1 flex-col">
        <span
          class="truncate text-sm font-semibold text-surface-900 dark:text-surface-0"
        >
          {{ title || $t('Wiki.untitled') }}
        </span>
        <span class="truncate text-xs text-surface-400 dark:text-surface-500">
          {{
            $t('Wiki.artifact.versionInfo', {
              version: info.current.version,
              files: info.current.fileCount,
              size: formatBytes(info.current.totalBytes),
              date: formatDate(info.current.createdAt),
            })
          }}
        </span>
      </div>

      <button
        v-if="info.current.warnings.length"
        type="button"
        class="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
        :title="$t('Wiki.artifact.warnings')"
        @click="warningsOpen = !warningsOpen"
      >
        <IconWarning class="h-3.5 w-3.5" />
        {{
          $t(
            'Wiki.artifact.warningsCount',
            { count: info.current.warnings.length },
            info.current.warnings.length,
          )
        }}
      </button>

      <span
        class="hidden items-center text-surface-400 md:flex dark:text-surface-500"
        :title="$t('Wiki.artifact.sandboxHint')"
      >
        <IconShield class="h-4 w-4" />
      </span>

      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-xs text-surface-600 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:text-surface-300"
        :title="action.label"
        :aria-label="action.label"
        :disabled="busy"
        @click="action.run"
      >
        <component :is="action.icon" class="h-3.5 w-3.5" />
      </button>

      <input
        ref="fileInputRef"
        type="file"
        class="hidden"
        :accept="ARTIFACT_ACCEPT"
        @change="onFileChosen"
      />
    </div>

    <!-- upload notes (absolute paths, window.claude, skipped files) -->
    <ul
      v-if="warningsOpen && info.current.warnings.length"
      class="shrink-0 list-disc space-y-1 border-b border-amber-200 bg-amber-50 py-2 pr-4 pl-9 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <li v-for="(warning, i) in info.current.warnings" :key="i">
        {{ warning }}
      </li>
    </ul>

    <!--
      The artifact itself. `sandbox` without allow-same-origin: the document
      gets an opaque origin, so it cannot reach the wiki's session or API. The
      server sends the same sandbox as a CSP header, which also covers the
      "open in new tab" case.
    -->
    <iframe
      :key="src"
      :src="src"
      :title="title || $t('Wiki.artifact.badge')"
      :sandbox="ARTIFACT_IFRAME_SANDBOX"
      allow="fullscreen; clipboard-write"
      allowfullscreen
      referrerpolicy="no-referrer"
      class="min-h-0 w-full flex-1 border-0 bg-white"
    />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import IconArtifact from '~icons/mdi/application-brackets-outline'
import IconWarning from '~icons/mdi/alert-outline'
import IconShield from '~icons/mdi/shield-check-outline'
import IconFullscreen from '~icons/mdi/fullscreen'
import IconFullscreenExit from '~icons/mdi/fullscreen-exit'
import IconOpenInNew from '~icons/mdi/open-in-new'
import IconUpload from '~icons/mdi/tray-arrow-up'
import IconDownload from '~icons/mdi/tray-arrow-down'
import IconTrash from '~icons/mdi/trash-can-outline'
import type { ArtifactInfo } from '@/types/wiki'
import { FetcherError } from '@/utils/fetcher'
import { formatDateTime } from '@/utils/date'
import {
  ARTIFACT_ACCEPT,
  ARTIFACT_IFRAME_SANDBOX,
  artifactContentUrl,
  deleteArtifact,
  downloadArtifact,
  formatBytes,
  isArtifactFile,
  uploadArtifact,
} from '@/utils/artifacts'

const props = defineProps<{
  tenantId: string
  pageId: string
  title: string
  info: ArtifactInfo
  /** offer "new version" and "remove" (the server checks write access) */
  canEdit: boolean
}>()

const emit = defineEmits<{
  updated: [info: ArtifactInfo]
  removed: []
}>()

const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()

const rootRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const warningsOpen = ref(false)
const busy = ref(false)
const isFullscreen = ref(false)

const src = computed(() => artifactContentUrl(props.info))

const formatDate = (value: string) => formatDateTime(value)

const errorDetail = (error: unknown, fallback: string) => {
  if (error instanceof FetcherError && error.body) {
    try {
      return (JSON.parse(error.body) as { error?: string }).error ?? error.body
    } catch {
      return error.body
    }
  }
  return fallback
}

const onFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === rootRef.value
}
onMounted(() =>
  document.addEventListener('fullscreenchange', onFullscreenChange),
)
onBeforeUnmount(() =>
  document.removeEventListener('fullscreenchange', onFullscreenChange),
)

const toggleFullscreen = async () => {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await rootRef.value?.requestFullscreen?.()
}

const openInTab = () => window.open(src.value, '_blank', 'noopener')

const onFileChosen = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!isArtifactFile(file.name)) {
    toast.add({
      severity: 'warn',
      summary: t('Wiki.artifact.invalidFile'),
      life: 4000,
    })
    return
  }
  busy.value = true
  try {
    const info = await uploadArtifact(props.tenantId, props.pageId, file)
    emit('updated', info)
    warningsOpen.value = info.current.warnings.length > 0
    toast.add({
      severity: 'success',
      summary: t('Wiki.artifact.uploaded', { version: info.current.version }),
      life: 3000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('Wiki.artifact.uploadError'),
      detail: errorDetail(error, t('Wiki.artifact.uploadError')),
      life: 6000,
    })
  } finally {
    busy.value = false
  }
}

const download = async () => {
  busy.value = true
  try {
    const base = (props.title || 'artifact').replace(/[\\/:*?"<>|]+/g, '')
    await downloadArtifact(
      props.tenantId,
      props.pageId,
      `${base} v${props.info.current.version}.zip`,
    )
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: errorDetail(error, t('Common.error')),
      life: 5000,
    })
  } finally {
    busy.value = false
  }
}

const remove = () =>
  confirm.require({
    message: t('Wiki.artifact.removeConfirm'),
    header: t('Wiki.artifact.remove'),
    rejectProps: {
      label: t('Common.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: { label: t('Wiki.artifact.remove'), severity: 'danger' },
    accept: async () => {
      busy.value = true
      try {
        await deleteArtifact(props.tenantId, props.pageId)
        emit('removed')
        toast.add({
          severity: 'success',
          summary: t('Wiki.artifact.removed'),
          life: 3000,
        })
      } catch (error) {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: errorDetail(error, t('Common.error')),
          life: 5000,
        })
      } finally {
        busy.value = false
      }
    },
  })

const actions = computed(() => {
  const list: {
    key: string
    label: string
    icon: Component
    run: () => void
  }[] = [
    {
      key: 'fullscreen',
      label: isFullscreen.value
        ? t('Wiki.artifact.exitFullscreen')
        : t('Wiki.artifact.fullscreen'),
      icon: isFullscreen.value ? IconFullscreenExit : IconFullscreen,
      run: () => void toggleFullscreen(),
    },
    {
      key: 'tab',
      label: t('Wiki.artifact.openInTab'),
      icon: IconOpenInNew,
      run: openInTab,
    },
    {
      key: 'download',
      label: t('Wiki.artifact.download'),
      icon: IconDownload,
      run: () => void download(),
    },
  ]
  if (props.canEdit) {
    list.push(
      {
        key: 'upload',
        label: t('Wiki.artifact.newVersion'),
        icon: IconUpload,
        run: () => fileInputRef.value?.click(),
      },
      {
        key: 'remove',
        label: t('Wiki.artifact.remove'),
        icon: IconTrash,
        run: remove,
      },
    )
  }
  return list
})
</script>
