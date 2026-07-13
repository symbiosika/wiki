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
        <span v-else-if="wiki.state.lastSavedAt">{{ $t('Wiki.saved') }}</span>
        <button
          type="button"
          class="ml-1 flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300"
          :class="{ 'border-primary text-primary': assistant.open }"
          :title="$t('Assistant.title')"
          @click="toggleAssistant"
        >
          <IconRobot class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{ $t('Assistant.button') }}</span>
        </button>
      </div>

      <!-- title -->
      <textarea
        ref="titleRef"
        v-model="title"
        rows="1"
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
          :tenant-id="tenantId"
          :page-id="page.id"
          @change="onBlocksChange"
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
import DocumentAssistantPanel from '@/components/wiki/DocumentAssistantPanel.vue'
import { useDocumentAssistant } from '@/stores/documentAssistant'

const wiki = useWiki()
const assistant = useDocumentAssistant()
const route = useRoute()
const { t } = useI18n()

const tenantId = computed(() => String(route.params.tenantId))
const pageId = computed(() => String(route.params.pageId))

const page = computed(() => wiki.state.page)
const loadError = ref(false)

const title = ref('')
const titleRef = ref<HTMLTextAreaElement | null>(null)
const editorRef = ref<{ flush: () => void } | null>(null)
// bumped to remount the editor after the assistant edits the page server-side
const reloadKey = ref(0)

const toggleAssistant = () => {
  if (assistant.open) assistant.closePanel()
  else assistant.openPanel()
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
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(async () => {
    if (!page.value) return
    await wiki.saveTitle(tenantId.value, page.value.id, title.value.trim())
  }, 600)
}

const focusEditor = () => {
  const prose = document.querySelector<HTMLElement>('.wiki-editor .wiki-prose')
  prose?.focus()
}

// ----- blocks -----------------------------------------------------------------

const onBlocksChange = async (blocks: WikiBlock[]) => {
  if (!page.value) return
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
