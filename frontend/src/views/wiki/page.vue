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
        class="sticky top-0 z-10 -mx-4 flex shrink-0 items-center gap-2 bg-surface-0/90 px-4 py-2 text-xs text-surface-400 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 dark:bg-surface-950/90 dark:text-surface-500"
      >
        <span
          class="rounded-full border border-surface-200 px-2 py-0.5 dark:border-surface-700"
        >
          {{ scopeLabel }}
        </span>

        <!-- info: clickable chip that opens a metadata popover -->
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

        <!-- classification (pageType): clickable chip that opens a chooser -->
        <button
          v-if="page.pageType || editable"
          type="button"
          class="flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors disabled:cursor-default"
          :class="
            page.pageType
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-dashed border-surface-300 text-surface-400 hover:border-primary hover:text-primary dark:border-surface-600'
          "
          :disabled="!editable"
          :title="$t('Wiki.pageType.hint')"
          @click="pageTypeMenuRef?.toggle($event)"
        >
          <IconTag class="h-3.5 w-3.5" />
          <span>{{
            page.pageType
              ? facetLabel('pageType', page.pageType)
              : $t('Wiki.pageType.empty')
          }}</span>
        </button>

        <!-- status (trust signal): clickable chip that opens a chooser -->
        <button
          v-if="page.status || editable"
          type="button"
          class="flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors disabled:cursor-default"
          :class="
            page.status
              ? statusChipClass
              : 'border-dashed border-surface-300 text-surface-400 hover:border-primary hover:text-primary dark:border-surface-600'
          "
          :disabled="!editable"
          :title="$t('Wiki.status.hint')"
          @click="statusMenuRef?.toggle($event)"
        >
          <component :is="statusIcon" class="h-3.5 w-3.5" />
          <span>{{
            page.status
              ? facetLabel('status', page.status)
              : $t('Wiki.status.empty')
          }}</span>
        </button>

        <!-- per-organisation metadata (tags): read-only value chips -->
        <span
          v-for="chip in attributeChips"
          :key="chip.key"
          class="flex items-center gap-1 rounded-full border border-surface-200 px-2 py-0.5 text-surface-600 dark:border-surface-700 dark:text-surface-300"
          :title="`${chip.label}: ${chip.value}`"
        >
          <span class="text-surface-400 dark:text-surface-500"
            >{{ chip.label }}:</span
          >
          <span>{{ chip.value }}</span>
        </span>

        <!-- metadata editor: clickable chip that opens the attribute chooser -->
        <button
          v-if="editable && attributeDefinitions.length > 0"
          type="button"
          class="flex items-center gap-1 rounded-full border border-dashed border-surface-300 px-2 py-0.5 text-surface-400 transition-colors hover:border-primary hover:text-primary dark:border-surface-600"
          :class="{ 'border-primary text-primary': attributesOpen }"
          :title="$t('Wiki.attributes.hint')"
          @click="openAttributes($event)"
        >
          <IconTagMultiple class="h-3.5 w-3.5" />
          <span>{{ $t('Wiki.attributes.button') }}</span>
        </button>

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

      <!-- facet choosers, opened by the chips in the meta bar -->
      <Menu ref="pageTypeMenuRef" :model="pageTypeItems" popup />
      <Menu ref="statusMenuRef" :model="statusItems" popup />

      <!-- document metadata, opened by the "Info" chip -->
      <Popover ref="infoPopoverRef" @hide="infoOpen = false">
        <dl class="w-64 space-y-3 text-xs">
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
      </Popover>

      <!-- per-organisation metadata (tags) editor, opened by the "Tags" chip -->
      <Popover ref="attributesPopoverRef" @hide="attributesOpen = false">
        <div class="w-72 space-y-3">
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400">
            {{ $t('Wiki.attributes.title') }}
          </p>
          <div
            v-for="def in attributeDefinitions"
            :key="def.key"
            class="flex flex-col gap-1"
          >
            <label
              class="text-xs font-medium text-surface-700 dark:text-surface-300"
            >
              {{ def.label || def.key }}
            </label>
            <Select
              v-if="def.values && def.values.length"
              v-model="attrDraft[def.key]"
              :options="attributeOptions(def)"
              option-label="label"
              option-value="value"
              class="w-full"
            />
            <InputText
              v-else
              v-model="attrDraft[def.key]"
              class="w-full"
              :placeholder="$t('Wiki.attributes.valuePlaceholder')"
            />
          </div>
          <div class="flex justify-end pt-1">
            <Button
              :label="$t('Wiki.attributes.save')"
              size="small"
              :loading="wiki.state.saving"
              @click="saveAttributesDraft"
            />
          </div>
        </div>
      </Popover>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeAttributeDefinition, WikiBlock } from '@/types/wiki'
import IconRobot from '~icons/mdi/robot-outline'
import IconTagMultiple from '~icons/mdi/tag-multiple-outline'
import IconFilePdf from '~icons/mdi/file-pdf-box'
import IconSpinner from '~icons/mdi/loading'
import IconLock from '~icons/mdi/lock-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconTag from '~icons/mdi/tag-outline'
import IconInfo from '~icons/mdi/information-outline'
import IconCircle from '~icons/mdi/circle-outline'
import IconCheckCircle from '~icons/mdi/check-circle-outline'
import IconAlertCircle from '~icons/mdi/alert-circle-outline'
import IconDraft from '~icons/mdi/file-document-edit-outline'
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
  // facet vocabularies (page types / statuses) — cached, so this is a no-op
  // after the first page open
  void wiki.loadConfig(tenantId.value)
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

// ----- facets (classification / status) -------------------------------------

const pageTypeMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)
const statusMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)

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

/** Build a popup-menu model from a vocabulary + a "clear" entry when set. */
const facetItems = (
  facet: 'pageType' | 'status',
  vocabulary: string[],
  current: string | null | undefined,
  choose: (value: string | null) => void,
) => {
  const items = vocabulary.map((value) => ({
    label: facetLabel(facet, value),
    command: () => choose(value),
  }))
  if (current) {
    items.push({ label: t('Wiki.facets.clear'), command: () => choose(null) })
  }
  return items
}

const pageTypeItems = computed(() =>
  facetItems(
    'pageType',
    wiki.state.config?.pageTypes ?? [],
    page.value?.pageType,
    setPageType,
  ),
)

const statusItems = computed(() =>
  facetItems(
    'status',
    wiki.state.config?.statuses ?? [],
    page.value?.status,
    setStatus,
  ),
)

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

const statusChipClass = computed(() => {
  switch (page.value?.status) {
    case 'verified':
      return 'border-green-300 bg-green-50 text-green-700 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-400'
    case 'outdated':
      return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400'
    case 'draft':
      return 'border-surface-300 bg-surface-100 text-surface-600 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300'
    default:
      return 'border-surface-200 text-surface-500 dark:border-surface-700 dark:text-surface-400'
  }
})

// ----- per-organisation metadata (attributes / tags) ------------------------

const attributesPopoverRef = ref<{
  toggle: (event: Event) => void
  hide: () => void
} | null>(null)
const attributesOpen = ref(false)
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

const openAttributes = (event: Event) => {
  const attrs = page.value?.attributes ?? {}
  const draft: Record<string, string> = {}
  for (const def of attributeDefinitions.value) {
    draft[def.key] = attrs[def.key] ?? ''
  }
  attrDraft.value = draft
  attributesOpen.value = true
  attributesPopoverRef.value?.toggle(event)
}

const saveAttributesDraft = async () => {
  if (!page.value || !editable.value) return
  try {
    await wiki.saveAttributes(tenantId.value, page.value.id, attrDraft.value)
    attributesPopoverRef.value?.hide()
    attributesOpen.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      life: 2000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Wiki.attributes.saveError'),
      life: 4000,
    })
  }
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

// ----- info popover (document metadata) -------------------------------------

const infoPopoverRef = ref<{ toggle: (event: Event) => void } | null>(null)
const infoOpen = ref(false)

const toggleInfo = (event: Event) => {
  infoOpen.value = !infoOpen.value
  infoPopoverRef.value?.toggle(event)
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
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
</script>
