<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col px-4 sm:px-6 lg:px-10">
    <!-- loading -->
    <div
      v-if="wiki.state.pageLoading"
      class="flex flex-1 items-center justify-center"
    >
      <ProgressSpinner class="h-10 w-10" />
    </div>

    <!-- not found -->
    <div
      v-else-if="loadError"
      class="flex flex-1 flex-col items-center justify-center gap-2"
    >
      <p class="text-surface-500 dark:text-surface-400">
        {{ $t('Wiki.pageNotFound') }}
      </p>
    </div>

    <template v-else-if="page">
      <!-- meta bar -->
      <div
        class="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-surface-0/90 px-4 py-2 text-xs text-surface-400 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 dark:bg-surface-950/90 dark:text-surface-500"
      >
        <span
          class="rounded-full border border-surface-200 px-2 py-0.5 dark:border-surface-700"
        >
          {{ scopeLabel }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ breadcrumb }}</span>
        <span v-if="wiki.state.saveError" class="text-red-500">
          {{ $t('Wiki.saveError') }}
        </span>
        <span v-else-if="wiki.state.saving">{{ $t('Wiki.saving') }}</span>
        <span v-else-if="wiki.state.lastSavedAt && editable">{{
          $t('Wiki.saved')
        }}</span>

        <!-- edit lock / read-only status -->
        <span
          v-if="lockedByOther"
          class="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
          :title="$t('Wiki.readonly.lockedBy', { name: lockHolderName })"
        >
          <IconLock class="h-3.5 w-3.5" />
          <span class="hidden truncate sm:inline">{{
            $t('Wiki.readonly.lockedBy', { name: lockHolderName })
          }}</span>
          <span class="sm:hidden">{{ $t('Wiki.readonly.locked') }}</span>
        </span>
        <button
          v-else
          type="button"
          class="flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors"
          :class="
            editable
              ? 'border-primary text-primary'
              : 'border-surface-200 text-surface-600 hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300'
          "
          :title="
            editable
              ? $t('Wiki.readonly.lockHint')
              : $t('Wiki.readonly.editHint')
          "
          @click="readOnly.toggle()"
        >
          <component :is="editable ? IconPencil : IconLock" class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{
            editable ? $t('Wiki.readonly.editing') : $t('Wiki.readonly.readOnly')
          }}</span>
        </button>

        <button
          type="button"
          class="ml-1 flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-surface-200 disabled:hover:text-surface-600 dark:border-surface-700 dark:text-surface-300"
          :class="{ 'border-primary text-primary': assistant.open }"
          :title="$t('Assistant.title')"
          :disabled="!editable"
          @click="toggleAssistant"
        >
          <IconRobot class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{ $t('Assistant.button') }}</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:text-surface-300"
          :title="$t('Wiki.export.title')"
          :disabled="exporting"
          @click="exportPdf"
        >
          <IconSpinner v-if="exporting" class="h-3.5 w-3.5 animate-spin" />
          <IconFilePdf v-else class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{
            exporting ? $t('Wiki.export.exporting') : $t('Wiki.export.button')
          }}</span>
        </button>
      </div>

      <!-- title -->
      <textarea
        ref="titleRef"
        v-model="title"
        rows="1"
        :readonly="!editable"
        :placeholder="$t('Wiki.titlePlaceholder')"
        class="mt-6 w-full resize-none overflow-hidden bg-transparent text-3xl font-bold text-surface-900 outline-none placeholder:text-surface-300 sm:mt-8 sm:text-4xl dark:text-surface-0 dark:placeholder:text-surface-600"
        @input="onTitleInput"
        @keydown.enter.prevent="focusEditor"
      />

      <!-- block editor -->
      <div class="flex-1 pt-4 pb-32">
        <!--
          NOTE: bound directly to the store state (not a local copy set after
          await): the render flush runs before the awaiting caller resumes,
          so a local copy would still be stale when the editor mounts.
        -->
        <BlockEditor
          :key="`${page.id}:${reloadKey}`"
          ref="editorRef"
          :blocks="wiki.state.blocks"
          :editable="editable"
          :tenant-id="tenantId"
          :page-id="page.id"
          @change="onBlocksChange"
        />

        <!-- page references: backlinks, outgoing links, related pages -->
        <WikiReferences
          :tenant-id="tenantId"
          :page-id="page.id"
          :refresh-key="`${reloadKey}:${wiki.state.lastSavedAt ?? ''}`"
        />
      </div>

      <!-- talk-to-your-document assistant -->
      <DocumentAssistantPanel
        :tenant-id="tenantId"
        :entry-id="page.id"
        @applied="onAssistantApplied"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { WikiBlock } from '@/types/wiki'
import IconRobot from '~icons/mdi/robot-outline'
import IconFilePdf from '~icons/mdi/file-pdf-box'
import IconSpinner from '~icons/mdi/loading'
import IconLock from '~icons/mdi/lock-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import { useToast } from 'primevue/usetoast'
import DocumentAssistantPanel from '@/components/wiki/DocumentAssistantPanel.vue'
import WikiReferences from '@/components/wiki/WikiReferences.vue'
import { useDocumentAssistant } from '@/stores/documentAssistant'
import { useApp } from '@/stores/main'
import { useWikiPresence } from '@/composables/useWikiPresence'
import { exportWikiPageToPdf } from '@/utils/wikiPdf'

const wiki = useWiki()
const app = useApp()
const assistant = useDocumentAssistant()
const readOnly = useReadOnly()
const route = useRoute()
const toast = useToast()
const { t } = useI18n()

const tenantId = computed(() => String(route.params.tenantId))
const pageId = computed(() => String(route.params.pageId))

const page = computed(() => wiki.state.page)
const loadError = ref(false)

// ----- read-only mode & per-page edit lock ----------------------------------

// editing is desired whenever the global read-only mode is switched off
const wantsEdit = computed(() => !readOnly.readOnly)
const presence = useWikiPresence(tenantId, pageId, wantsEdit)
const { canEdit, lockedByOther, lockHolderName } = presence

// the single gate the editor, title and assistant honour
const editable = computed(() => canEdit.value)

const title = ref('')
const titleRef = ref<HTMLTextAreaElement | null>(null)
const editorRef = ref<{
  flush: () => void
  getBlocks: () => WikiBlock[]
} | null>(null)
const exporting = ref(false)
// bumped to remount the editor after the assistant edits the page server-side
const reloadKey = ref(0)

const toggleAssistant = () => {
  // the assistant edits the document server-side, so keep it behind the lock
  if (!editable.value) return
  if (assistant.open) assistant.closePanel()
  else assistant.openPanel()
}

// close the assistant if the page becomes read-only while it is open
watch(editable, (canEdit) => {
  if (!canEdit && assistant.open) assistant.closePanel()
})

// ----- PDF export -----------------------------------------------------------

const exportPdf = async () => {
  if (!page.value || exporting.value) return
  exporting.value = true
  try {
    // use the live editor content so unsaved edits are included
    const blocks = editorRef.value?.getBlocks() ?? wiki.state.blocks
    await exportWikiPageToPdf({
      title: title.value.trim() || page.value.title || t('Wiki.untitled'),
      blocks,
      organisationName: app.currentTenant?.name,
      dateLabel: new Date().toLocaleDateString(),
      pageLabel: (current, total) =>
        t('Wiki.export.pageOf', { current, total }),
    })
  } catch (error) {
    console.error('PDF export failed', error)
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Wiki.export.error'),
      life: 5000,
    })
  } finally {
    exporting.value = false
  }
}

// After the assistant applies edits, pull the fresh content and remount the
// editor so the changes show up (the editor initialises from blocks once).
const onAssistantApplied = async () => {
  if (!page.value) return
  editorRef.value?.flush()
  await wiki.loadPage(tenantId.value, page.value.id)
  reloadKey.value += 1
}

const loadPage = async () => {
  loadError.value = false
  // save pending edits of the previous page before switching
  editorRef.value?.flush()
  // the assistant chat log is per-page
  assistant.reset()
  try {
    await wiki.loadPage(tenantId.value, pageId.value)
    title.value = wiki.state.page?.title ?? ''
    await nextTick()
    autoGrowTitle()
    if (!title.value) titleRef.value?.focus()
  } catch {
    loadError.value = true
  }
}

watch(pageId, loadPage, { immediate: true })

onBeforeUnmount(() => {
  editorRef.value?.flush()
})

// ----- title ----------------------------------------------------------------

let titleTimer: ReturnType<typeof setTimeout> | null = null

const autoGrowTitle = () => {
  const el = titleRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const onTitleInput = () => {
  autoGrowTitle()
  if (!editable.value) return
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(async () => {
    if (!page.value || !editable.value) return
    await wiki.saveTitle(tenantId.value, page.value.id, title.value.trim())
  }, 600)
}

const focusEditor = () => {
  const prose = document.querySelector<HTMLElement>('.wiki-editor .wiki-prose')
  prose?.focus()
}

// ----- blocks -----------------------------------------------------------------

const onBlocksChange = async (blocks: WikiBlock[]) => {
  if (!page.value || !editable.value) return
  await wiki.saveBlocks(tenantId.value, page.value.id, blocks)
}

// ----- meta -----------------------------------------------------------------

const scopeLabel = computed(() => {
  const current = page.value
  if (!current) return ''
  if (current.teamId) {
    const team = wiki.state.tree.teams.find(
      (entry) => entry.teamId === current.teamId,
    )
    return team ? `${t('Wiki.scope.team')}: ${team.name}` : t('Wiki.scope.team')
  }
  if (current.tenantWide) return t('Wiki.scope.organisation')
  return t('Wiki.scope.personal')
})

/** ancestor path of the page, e.g. "Handbook / Onboarding" */
const breadcrumb = computed(() => {
  const current = page.value
  if (!current) return ''
  const parts: string[] = []
  let node = current.parentId ? wiki.findTreeNode(current.parentId) : null
  while (node) {
    parts.unshift(node.title || t('Wiki.untitled'))
    node = node.parentId ? wiki.findTreeNode(node.parentId) : null
  }
  return parts.join(' / ')
})
</script>
