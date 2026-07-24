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
      <!--
        meta bar — three fixed zones (left / centre / right) via a
        1fr-auto-1fr grid so the centre group stays visually centred over the
        text column regardless of how wide the side groups get:
          • left   — the document assistant (chat)
          • centre — read-only toggle + info (document details live in Info now)
          • right  — content actions, with "Inhalt" pinned flush to the
                     very right edge
        Classification, status, tags and the AI summary used to be their own
        chips here; they are informational, so they moved into the Info popover.
      -->
      <div
        class="sticky top-0 z-10 -mx-4 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 bg-surface-0/90 px-4 py-2 text-xs text-surface-400 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 dark:bg-surface-950/90 dark:text-surface-500"
      >
        <!-- LEFT: document assistant, pinned to the far left -->
        <div class="flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-surface-200 disabled:hover:text-surface-600 dark:border-surface-700 dark:text-surface-300"
            :class="{ 'border-primary text-primary': assistant.open }"
            :title="$t('Assistant.title')"
            :disabled="lockedByOther"
            @click="toggleAssistant"
          >
            <IconChat class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">{{ $t('Assistant.button') }}</span>
          </button>
        </div>

        <!-- CENTRE: read-only status + info + save state, centred over the text -->
        <div class="flex items-center justify-center gap-2">
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
              presenceUnavailable
                ? $t('Wiki.readonly.presenceUnavailable')
                : editable
                  ? $t('Wiki.readonly.lockHint')
                  : $t('Wiki.readonly.editHint')
            "
            @click="readOnly.toggle()"
          >
            <component
              :is="editable ? IconPencil : IconLock"
              class="h-3.5 w-3.5"
            />
            <span class="hidden sm:inline">{{
              editable
                ? $t('Wiki.readonly.editing')
                : $t('Wiki.readonly.readOnly')
            }}</span>
          </button>

          <!-- info: clickable chip that opens the document-details popover -->
          <button
            type="button"
            class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300"
            :class="{ 'border-primary text-primary': infoOpen }"
            :title="$t('Wiki.info.hint')"
            @click="toggleInfo"
          >
            <IconInfo class="h-3.5 w-3.5" />
            <span>{{ $t('Wiki.info.button') }}</span>
          </button>

          <span v-if="wiki.state.saveError" class="text-red-500">
            {{ $t('Wiki.saveError') }}
          </span>
          <span v-else-if="wiki.state.saving">{{ $t('Wiki.saving') }}</span>
          <span v-else-if="wiki.state.lastSavedAt && editable">{{
            $t('Wiki.saved')
          }}</span>
        </div>

        <!-- RIGHT: content actions; "Inhalt" sits flush at the far edge -->
        <div class="flex items-center justify-end gap-2">
          <button
            v-if="editable"
            type="button"
            class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300"
            :title="$t('Editor.markdown.buttonHint')"
            @click="markdownDialogOpen = true"
          >
            <IconLanguageMarkdown class="h-3.5 w-3.5" />
            <span class="hidden lg:inline">{{
              $t('Editor.markdown.button')
            }}</span>
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:text-surface-300"
            :class="{ 'border-primary text-primary': copied }"
            :title="$t('Wiki.copyMarkdown.hint')"
            :disabled="copying"
            @click="copyMarkdown"
          >
            <IconSpinner v-if="copying" class="h-3.5 w-3.5 animate-spin" />
            <IconCheck v-else-if="copied" class="h-3.5 w-3.5" />
            <IconContentCopy v-else class="h-3.5 w-3.5" />
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
            <span class="hidden whitespace-nowrap lg:inline">{{
              exporting ? $t('Wiki.export.exporting') : $t('Wiki.export.button')
            }}</span>
          </button>

          <!--
            import a page from a file or URL. Lives here on the open page (rather
            than in the sidebar) so it reads as an "upload into the wiki" action,
            right where the content is.
          -->
          <button
            type="button"
            class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300"
            :title="$t('Wiki.import.button')"
            @click="wiki.openImportDialog()"
          >
            <IconUpload class="h-3.5 w-3.5" />
          </button>

          <!--
            table of contents: toggles a collapsible panel of page headings.
            Pinned last so "Inhalt" sits flush against the very right edge.
          -->
          <button
            type="button"
            class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 transition-colors hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300"
            :class="{ 'border-primary text-primary': tocOpen }"
            :title="$t('Wiki.toc.hint')"
            @click="tocOpen = !tocOpen"
          >
            <IconListBox class="h-3.5 w-3.5" />
            <span class="hidden whitespace-nowrap sm:inline">{{
              $t('Wiki.toc.button')
            }}</span>
          </button>
        </div>
      </div>

      <!-- title -->
      <!--
        shrink-0 is essential: the page is a fixed-height (h-full) flex column,
        so without it the flex layout shrinks this textarea to a sliver once the
        editor content below overflows the viewport — a <textarea> has no auto
        min-height floor to stop it. That made the title vanish and become
        unclickable on long pages.
      -->
      <textarea
        ref="titleRef"
        v-model="title"
        rows="1"
        :readonly="!editable"
        :placeholder="$t('Wiki.titlePlaceholder')"
        class="mt-6 w-full shrink-0 resize-none overflow-hidden bg-transparent text-3xl font-bold text-surface-900 outline-none placeholder:text-surface-300 sm:mt-8 sm:text-4xl dark:text-surface-0 dark:placeholder:text-surface-600"
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
          @toc="toc = $event"
        />

        <!-- page references: backlinks, outgoing links, related pages -->
        <WikiReferences
          :tenant-id="tenantId"
          :page-id="page.id"
          :refresh-key="`${reloadKey}:${wiki.state.lastSavedAt ?? ''}`"
        />
      </div>

      <!-- collapsible table of contents (page headings) -->
      <WikiTableOfContents
        :open="tocOpen"
        :headings="toc"
        @close="tocOpen = false"
        @navigate="navigateToHeading"
      />

      <!-- talk-to-your-document assistant -->
      <DocumentAssistantPanel
        :tenant-id="tenantId"
        :entry-id="page.id"
        @applied="onAssistantApplied"
      />

      <!-- manual "insert markdown" dialog, opened by the Markdown chip -->
      <MarkdownPasteDialog
        v-model:visible="markdownDialogOpen"
        @insert="onInsertMarkdown"
      />

      <!--
        document details, opened by the "Info" chip. This is now the single
        home for everything informational about the page: the AI summary,
        classification, status, per-organisation tags (all editable in place
        when the page is editable), plus location and the authorship stamps.
      -->
      <Popover ref="infoPopoverRef" @hide="onInfoHide">
        <div class="max-h-[70vh] w-80 space-y-4 overflow-y-auto text-xs">
          <!-- meta infos first: location, scope + authorship / timestamps -->
          <dl class="space-y-3">
            <div v-if="breadcrumb" class="flex flex-col gap-0.5">
              <dt class="font-medium text-surface-500 dark:text-surface-400">
                {{ $t('Wiki.info.location') }}
              </dt>
              <dd class="text-surface-800 dark:text-surface-100">
                {{ breadcrumb }}
              </dd>
            </div>

            <div class="flex flex-col gap-0.5">
              <dt class="font-medium text-surface-500 dark:text-surface-400">
                {{ $t('Wiki.info.scope') }}
              </dt>
              <dd class="text-surface-800 dark:text-surface-100">
                {{ scopeLabel }}
              </dd>
            </div>

            <div class="flex flex-col gap-0.5">
              <dt class="font-medium text-surface-500 dark:text-surface-400">
                {{ $t('Wiki.info.created') }}
              </dt>
              <dd class="text-surface-800 dark:text-surface-100">
                {{ formatDateTime(page.createdAt) }}
              </dd>
              <dd
                v-if="userLabel(page.createdBy)"
                class="text-surface-500 dark:text-surface-400"
              >
                {{ $t('Wiki.info.by', { name: userLabel(page.createdBy) }) }}
              </dd>
            </div>

            <div class="flex flex-col gap-0.5">
              <dt class="font-medium text-surface-500 dark:text-surface-400">
                {{ $t('Wiki.info.updated') }}
              </dt>
              <dd class="text-surface-800 dark:text-surface-100">
                {{ formatDateTime(page.updatedAt) }}
              </dd>
              <dd
                v-if="userLabel(page.updatedBy)"
                class="text-surface-500 dark:text-surface-400"
              >
                {{ $t('Wiki.info.by', { name: userLabel(page.updatedBy) }) }}
              </dd>
            </div>

            <div v-if="page.verifiedAt" class="flex flex-col gap-0.5">
              <dt class="font-medium text-surface-500 dark:text-surface-400">
                {{ $t('Wiki.info.verified') }}
              </dt>
              <dd class="text-surface-800 dark:text-surface-100">
                {{ formatDateTime(page.verifiedAt) }}
              </dd>
              <dd
                v-if="userLabel(page.verifiedBy)"
                class="text-surface-500 dark:text-surface-400"
              >
                {{ $t('Wiki.info.by', { name: userLabel(page.verifiedBy) }) }}
              </dd>
            </div>
          </dl>

          <hr class="border-surface-200 dark:border-surface-700" />

          <!-- AI-generated summary (read-only) -->
          <section v-if="page.summary" class="space-y-1">
            <p class="font-medium text-surface-500 dark:text-surface-400">
              {{ $t('Wiki.summary.title') }}
            </p>
            <p class="leading-relaxed text-surface-800 dark:text-surface-100">
              {{ page.summary }}
            </p>
            <p
              v-if="page.summaryUpdatedAt"
              class="text-surface-400 dark:text-surface-500"
            >
              {{
                $t('Wiki.summary.updated', {
                  date: formatDateTime(page.summaryUpdatedAt),
                })
              }}
            </p>
          </section>

          <!-- classification (pageType) -->
          <section v-if="editable || page.pageType" class="flex flex-col gap-1">
            <label class="font-medium text-surface-500 dark:text-surface-400">
              {{ $t('Wiki.info.classification') }}
            </label>
            <Select
              v-if="editable"
              v-model="pageTypeModel"
              :options="pageTypeOptions"
              option-label="label"
              option-value="value"
              show-clear
              class="w-full"
              :placeholder="$t('Wiki.pageType.empty')"
            />
            <span v-else class="text-surface-800 dark:text-surface-100">
              {{ facetLabel('pageType', page.pageType) }}
            </span>
          </section>

          <!-- status (trust signal) -->
          <section v-if="editable || page.status" class="flex flex-col gap-1">
            <label class="font-medium text-surface-500 dark:text-surface-400">
              {{ $t('Wiki.info.status') }}
            </label>
            <Select
              v-if="editable"
              v-model="statusModel"
              :options="statusOptions"
              option-label="label"
              option-value="value"
              show-clear
              class="w-full"
              :placeholder="$t('Wiki.status.empty')"
            />
            <span
              v-else
              class="flex items-center gap-1 text-surface-800 dark:text-surface-100"
            >
              <component :is="statusIcon" class="h-3.5 w-3.5" />
              {{ facetLabel('status', page.status) }}
            </span>
          </section>

          <!-- per-organisation metadata (document tags) -->
          <section
            v-if="attributeDefinitions.length || attributeChips.length"
            class="space-y-2"
          >
            <p class="font-medium text-surface-500 dark:text-surface-400">
              {{ $t('Wiki.attributes.title') }}
            </p>
            <template v-if="editable && attributeDefinitions.length">
              <div
                v-for="def in attributeDefinitions"
                :key="def.key"
                class="flex flex-col gap-1"
              >
                <label class="text-xs text-surface-600 dark:text-surface-400">
                  {{ def.label || def.key }}
                </label>
                <Select
                  v-if="def.values && def.values.length"
                  v-model="attrDraft[def.key]"
                  :options="attributeOptions(def)"
                  option-label="label"
                  option-value="value"
                  class="w-full"
                  @update:model-value="scheduleAttrSave"
                />
                <InputText
                  v-else
                  v-model="attrDraft[def.key]"
                  class="w-full"
                  :placeholder="$t('Wiki.attributes.valuePlaceholder')"
                  @update:model-value="scheduleAttrSave"
                />
              </div>
            </template>
            <div v-else class="flex flex-col gap-1">
              <span
                v-for="chip in attributeChips"
                :key="chip.key"
                class="text-surface-800 dark:text-surface-100"
              >
                <span class="text-surface-400 dark:text-surface-500"
                  >{{ chip.label }}:</span
                >
                {{ chip.value }}
              </span>
              <span
                v-if="!attributeChips.length"
                class="text-surface-400 dark:text-surface-500"
                >—</span
              >
            </div>
          </section>
        </div>
      </Popover>
    </template>
  </div>
</template>

<script setup lang="ts">
import type {
  KnowledgeAttributeDefinition,
  WikiBlock,
  WikiTocEntry,
} from '@/types/wiki'
import IconChat from '~icons/mdi/message-text-outline'
import IconListBox from '~icons/mdi/format-list-bulleted'
import IconFilePdf from '~icons/mdi/file-pdf-box'
import IconUpload from '~icons/mdi/tray-arrow-up'
import IconContentCopy from '~icons/mdi/content-copy'
import IconCheck from '~icons/mdi/check'
import IconSpinner from '~icons/mdi/loading'
import IconLock from '~icons/mdi/lock-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconInfo from '~icons/mdi/information-outline'
import IconCircle from '~icons/mdi/circle-outline'
import IconCheckCircle from '~icons/mdi/check-circle-outline'
import IconAlertCircle from '~icons/mdi/alert-circle-outline'
import IconDraft from '~icons/mdi/file-document-edit-outline'
import { useToast } from 'primevue/usetoast'
import IconLanguageMarkdown from '~icons/mdi/language-markdown-outline'
import DocumentAssistantPanel from '@/components/wiki/DocumentAssistantPanel.vue'
import WikiTableOfContents from '@/components/wiki/WikiTableOfContents.vue'
import MarkdownPasteDialog from '@/components/wiki/MarkdownPasteDialog.vue'
import WikiReferences from '@/components/wiki/WikiReferences.vue'
import { useDocumentAssistant } from '@/stores/documentAssistant'
import { useApp } from '@/stores/main'
import { useWikiPresence } from '@/composables/useWikiPresence'
import { exportWikiPageToPdf } from '@/utils/wikiPdf'
import { blocksToMarkdown } from '@/utils/wikiMarkdown'

const wiki = useWiki()
const app = useApp()
const assistant = useDocumentAssistant()
const readOnly = useReadOnly()
const route = useRoute()
const toast = useToast()
const { t, te, locale } = useI18n()

const tenantId = computed(() => String(route.params.tenantId))
const pageId = computed(() => String(route.params.pageId))

const page = computed(() => wiki.state.page)
const loadError = ref(false)

// ----- read-only mode & per-page edit lock ----------------------------------

// editing is desired whenever the global read-only mode is switched off
const wantsEdit = computed(() => !readOnly.readOnly)
const presence = useWikiPresence(tenantId, pageId, wantsEdit)
const { canEdit, lockedByOther, lockHolderName, presenceUnavailable } = presence

// the single gate the editor, title and assistant honour
const editable = computed(() => canEdit.value)

const title = ref('')
const titleRef = ref<HTMLTextAreaElement | null>(null)
const editorRef = ref<{
  flush: () => void
  getBlocks: () => WikiBlock[]
  insertMarkdown: (markdown: string) => void
} | null>(null)
const exporting = ref(false)
// bumped to remount the editor after the assistant edits the page server-side
const reloadKey = ref(0)

// ----- table of contents -----------------------------------------------------

// Live headings emitted by the editor, and whether the ToC panel is open.
const toc = ref<WikiTocEntry[]>([])
const tocOpen = ref(false)

const toggleAssistant = () => {
  if (assistant.open) {
    assistant.closePanel()
    return
  }
  // the assistant edits the document server-side, so it needs the edit lock;
  // someone else holding it is the only hard blocker
  if (lockedByOther.value) return
  // in read-only mode, opening the assistant switches editing on as well
  if (!editable.value) readOnly.setReadOnly(false)
  assistant.openPanel()
}

// close the assistant if the page becomes locked by someone else while open
watch(lockedByOther, (locked) => {
  if (locked && assistant.open) assistant.closePanel()
})

// close the assistant if the page becomes read-only while it is open
watch(editable, (canEdit) => {
  if (!canEdit && assistant.open) assistant.closePanel()
})

// ----- markdown paste --------------------------------------------------------

// Pasting raw markdown into the editor is auto-detected (see BlockEditor's
// handlePaste). This dialog is the explicit fallback: paste markdown, preview
// it, and insert it as formatted content at the cursor.
const markdownDialogOpen = ref(false)

const onInsertMarkdown = (markdown: string) => {
  editorRef.value?.insertMarkdown(markdown)
}

// ----- copy as markdown ------------------------------------------------------

// Icon-only chip that copies the page (title + content) as markdown, so it can
// be pasted straight into an AI agent / chat. Uses the live editor blocks so
// unsaved edits are included, matching the PDF export.
const copying = ref(false)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const copyMarkdown = async () => {
  if (!page.value || copying.value) return
  copying.value = true
  try {
    const blocks = editorRef.value?.getBlocks() ?? wiki.state.blocks
    const markdown = await blocksToMarkdown(
      blocks,
      title.value.trim() || page.value.title,
    )
    await navigator.clipboard.writeText(markdown)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 2000)
  } catch (error) {
    console.error('Copy as markdown failed', error)
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Wiki.copyMarkdown.error'),
      life: 4000,
    })
  } finally {
    copying.value = false
  }
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  if (attrSaveTimer) clearTimeout(attrSaveTimer)
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
  // facet vocabularies (page types / statuses) — cached, so this is a no-op
  // after the first page open
  void wiki.loadConfig(tenantId.value)
  try {
    await wiki.loadPage(tenantId.value, pageId.value)
    title.value = wiki.state.page?.title ?? ''
    await nextTick()
    autoGrowTitle()
    if (!title.value) titleRef.value?.focus()
    // honour a deep-link target (?block=… / ?match=…) once the editor renders
    scheduleJump()
  } catch {
    loadError.value = true
  }
}

watch(pageId, loadPage, { immediate: true })

// Re-jump when only the target changes but the page stays (e.g. two search
// hits in the same document opened one after another).
watch(
  () => [route.query.block, route.query.match],
  () => {
    if (!wiki.state.pageLoading) scheduleJump()
  },
)

onBeforeUnmount(() => {
  if (jumpHighlightTimer) clearTimeout(jumpHighlightTimer)
  editorRef.value?.flush()
})

// ----- deep-link jump (scroll to a block / match + highlight) ----------------

const JUMP_HIGHLIGHT_MS = 2200
let jumpHighlightTimer: ReturnType<typeof setTimeout> | null = null
// increments on every scheduleJump so a stale retry loop bows out
let jumpToken = 0

/** The rendered editor root (ProseMirror content), if mounted. */
const editorRoot = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.wiki-editor .wiki-prose')

/** Find a top-level block element by its stable data-block-id. */
const findBlockEl = (blockId: string): HTMLElement | null => {
  const root = editorRoot()
  if (!root) return null
  return (
    (Array.from(root.children).find(
      (el) => el.getAttribute('data-block-id') === blockId,
    ) as HTMLElement | undefined) ?? null
  )
}

/**
 * Fallback when no block id is known (fulltext hits, legacy chunks): the first
 * top-level block whose text contains the query — or one of its words, so a
 * multi-word query still lands somewhere sensible.
 */
const findMatchEl = (text: string): HTMLElement | null => {
  const root = editorRoot()
  if (!root) return null
  const needle = text.toLowerCase().trim()
  if (!needle) return null
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 3)
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const content = (el.textContent ?? '').toLowerCase()
    if (content.includes(needle) || tokens.some((t) => content.includes(t))) {
      return el
    }
  }
  return null
}

const scrollAndHighlight = (el: HTMLElement) => {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  document
    .querySelectorAll('.wiki-jump-highlight')
    .forEach((node) => node.classList.remove('wiki-jump-highlight'))
  el.classList.add('wiki-jump-highlight')
  if (jumpHighlightTimer) clearTimeout(jumpHighlightTimer)
  jumpHighlightTimer = setTimeout(() => {
    el.classList.remove('wiki-jump-highlight')
  }, JUMP_HIGHLIGHT_MS)
}

/**
 * Locate the deep-link target and scroll to it. The editor mounts and renders
 * asynchronously after the blocks load, so retry briefly until the node exists.
 */
const scheduleJump = () => {
  const block = route.query.block ? String(route.query.block) : ''
  const match = route.query.match ? String(route.query.match) : ''
  if (!block && !match) return

  const token = ++jumpToken
  let attempts = 0
  const tick = () => {
    if (token !== jumpToken) return // superseded by a newer jump
    const el = block ? findBlockEl(block) : findMatchEl(match)
    if (el) {
      scrollAndHighlight(el)
      return
    }
    if (attempts++ < 30) setTimeout(tick, 100) // ~3s budget for the editor
  }
  tick()
}

/** Scroll to a heading clicked in the table of contents (reuses the jump). */
const navigateToHeading = (blockId: string) => {
  const el = findBlockEl(blockId)
  if (el) scrollAndHighlight(el)
}

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

// ----- facets (classification / status) -------------------------------------
// Both live in the Info popover now, edited via Select dropdowns that save the
// moment a value is picked (or cleared).

/**
 * Human label for a facet value. Falls back to the raw value so tenant-custom
 * vocabularies (outside the shipped i18n keys) still render.
 */
const facetLabel = (
  facet: 'pageType' | 'status',
  value: string | null | undefined,
): string => {
  if (!value) return ''
  const key = `Wiki.${facet}.values.${value}`
  return te(key) ? t(key) : value
}

const setPageType = async (value: string | null) => {
  if (!page.value || !editable.value) return
  await wiki.savePageMeta(tenantId.value, page.value.id, { pageType: value })
}

const setStatus = async (value: string | null) => {
  if (!page.value || !editable.value) return
  await wiki.savePageMeta(
    tenantId.value,
    page.value.id,
    { status: value },
    app.state.user?.id,
  )
}

/** Select options for a facet vocabulary. */
const facetOptions = (facet: 'pageType' | 'status', vocabulary: string[]) =>
  vocabulary.map((value) => ({ label: facetLabel(facet, value), value }))

const pageTypeOptions = computed(() =>
  facetOptions('pageType', wiki.state.config?.pageTypes ?? []),
)

const statusOptions = computed(() =>
  facetOptions('status', wiki.state.config?.statuses ?? []),
)

/**
 * Writable models for the Info-popover selects: reading reflects the page,
 * assigning (a pick or a clear → null) persists immediately.
 */
const pageTypeModel = computed<string | null>({
  get: () => page.value?.pageType ?? null,
  set: (value) => void setPageType(value),
})

const statusModel = computed<string | null>({
  get: () => page.value?.status ?? null,
  set: (value) => void setStatus(value),
})

const statusIcon = computed(() => {
  switch (page.value?.status) {
    case 'verified':
      return IconCheckCircle
    case 'outdated':
      return IconAlertCircle
    case 'draft':
      return IconDraft
    default:
      return IconCircle
  }
})

// ----- per-organisation metadata (attributes / tags) ------------------------
// Edited inside the Info popover; the draft is seeded when that popover opens
// (see toggleInfo) and committed with the "Save" button.

/** Working copy edited in the popover; committed on save. */
const attrDraft = ref<Record<string, string>>({})

/** The per-organisation attribute definitions from the tenant config. */
const attributeDefinitions = computed<KnowledgeAttributeDefinition[]>(
  () => wiki.state.config?.attributes ?? [],
)

/**
 * The attribute values actually set on the page, as display chips. Labelled via
 * the definitions, but also surfaces values whose definition was later removed
 * so nothing stored silently disappears.
 */
const attributeChips = computed(() => {
  const attrs = page.value?.attributes ?? {}
  const labels = new Map(
    attributeDefinitions.value.map((def) => [def.key, def.label || def.key]),
  )
  return Object.entries(attrs)
    .filter(([, value]) => value)
    .map(([key, value]) => ({ key, label: labels.get(key) ?? key, value }))
})

/** Options for a closed-value attribute select, incl. a "clear" entry. */
const attributeOptions = (def: KnowledgeAttributeDefinition) => [
  { label: t('Wiki.attributes.none'), value: '' },
  ...(def.values ?? []).map((value) => ({ label: value, value })),
]

/** Seed the editable draft from the page's stored attribute values. */
const seedAttrDraft = () => {
  const attrs = page.value?.attributes ?? {}
  const draft: Record<string, string> = {}
  for (const def of attributeDefinitions.value) {
    draft[def.key] = attrs[def.key] ?? ''
  }
  attrDraft.value = draft
}

// Tags auto-save on edit, debounced, mirroring the title/blocks behaviour. The
// meta bar's "Speichert… / Gespeichert" indicator reflects the result; a
// failure surfaces there (wiki.state.saveError) rather than as a toast.
let attrSaveTimer: ReturnType<typeof setTimeout> | null = null

const scheduleAttrSave = () => {
  if (!editable.value) return
  if (attrSaveTimer) clearTimeout(attrSaveTimer)
  attrSaveTimer = setTimeout(() => {
    if (!page.value || !editable.value) return
    void wiki.saveAttributes(tenantId.value, page.value.id, attrDraft.value)
  }, 600)
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

// ----- info popover (document details) --------------------------------------
// Single home for summary, classification, status, tags, location + authorship.

const infoPopoverRef = ref<{ toggle: (event: Event) => void } | null>(null)
const infoOpen = ref(false)

const toggleInfo = (event: Event) => {
  // seed the tag draft on open so in-place edits start from stored values
  if (!infoOpen.value) seedAttrDraft()
  infoOpen.value = !infoOpen.value
  infoPopoverRef.value?.toggle(event)
}

const onInfoHide = () => {
  infoOpen.value = false
}

// userId -> email lookup, so authorship fields (createdBy / updatedBy /
// verifiedBy) can be shown as human-readable names. Loaded once per tenant.
const memberEmails = ref<Record<string, string>>({})

watch(
  tenantId,
  async (id) => {
    if (!id) return
    try {
      const members = await app.getTenantMembers(id)
      memberEmails.value = Object.fromEntries(
        members.map((member) => [member.id, member.userEmail]),
      )
    } catch {
      // membership list is a nicety; fall back to showing nothing for authors
      memberEmails.value = {}
    }
  },
  { immediate: true },
)

/** Human label for an author user id (email), or '' if unknown. */
const userLabel = (userId: string | null | undefined): string =>
  userId ? (memberEmails.value[userId] ?? '') : ''

/** Full date + time in the active locale, or '—' when missing. */
const formatDateTime = (value: string | null | undefined): string => {
  const date = parseServerDate(value)
  if (!date) return '—'
  return date.toLocaleString(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
</script>

<style>
/*
  Deep-link jump highlight. Global (not scoped): the editor renders its blocks
  unscoped via ProseMirror, so the class lands on nodes outside this
  component's scoped style. A brief tinted pulse draws the eye to the block a
  search hit / chunk citation pointed at, then fades out on its own.
*/
.wiki-jump-highlight {
  border-radius: 0.375rem;
  animation: wiki-jump-pulse 2.2s ease-out forwards;
}
@keyframes wiki-jump-pulse {
  0% {
    background-color: color-mix(
      in srgb,
      var(--p-primary-color) 28%,
      transparent
    );
    box-shadow: 0 0 0 6px
      color-mix(in srgb, var(--p-primary-color) 18%, transparent);
  }
  70% {
    background-color: color-mix(
      in srgb,
      var(--p-primary-color) 22%,
      transparent
    );
    box-shadow: 0 0 0 6px
      color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  }
  100% {
    background-color: transparent;
    box-shadow: 0 0 0 6px transparent;
  }
}
</style>
