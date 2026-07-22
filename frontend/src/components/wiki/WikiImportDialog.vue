<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('Wiki.import.title')"
    class="w-[720px] max-w-[95vw] md:w-[940px]"
    @hide="reset"
  >
    <div class="flex flex-col gap-4">
      <!-- source toggle -->
      <div class="flex gap-2">
        <SecondaryButton
          size="small"
          :class="{ '!bg-primary !text-primary-contrast': mode === 'file' }"
          :label="$t('Wiki.import.fromFile')"
          @click="mode = 'file'"
        />
        <SecondaryButton
          size="small"
          :class="{ '!bg-primary !text-primary-contrast': mode === 'url' }"
          :label="$t('Wiki.import.fromUrl')"
          @click="mode = 'url'"
        />
      </div>

      <!-- file dropzone -->
      <div v-if="mode === 'file'" class="flex flex-col gap-3">
        <button
          type="button"
          class="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors"
          :class="
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-surface-300 hover:border-primary dark:border-surface-600'
          "
          @click="fileInputRef?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <IconUpload class="h-8 w-8 text-surface-400" />
          <span class="text-sm text-surface-600 dark:text-surface-300">
            {{ $t('Wiki.import.dropHint') }}
          </span>
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Wiki.import.fileTypes') }}
          </span>
          <span
            class="mt-1 flex items-center gap-1 text-xs text-surface-400 dark:text-surface-500"
          >
            <IconFolder class="h-3.5 w-3.5" />
            {{ $t('Wiki.import.dropFolderHint') }}
          </span>
        </button>

        <!-- hidden inputs: one for files, one for a whole folder -->
        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="hidden"
          :accept="FILE_ACCEPT"
          @change="onFilesSelected"
        />
        <input
          ref="folderInputRef"
          type="file"
          multiple
          webkitdirectory
          class="hidden"
          @change="onFilesSelected"
        />

        <div class="flex items-center justify-between">
          <SecondaryButton
            size="small"
            :label="$t('Wiki.import.selectFolder')"
            @click="folderInputRef?.click()"
          >
            <template #icon>
              <IconFolder class="mr-1 h-4 w-4" />
            </template>
          </SecondaryButton>
          <button
            v-if="entries.length"
            type="button"
            class="text-xs text-surface-500 hover:text-surface-800 dark:hover:text-surface-100"
            @click="entries = []"
          >
            {{ $t('Wiki.import.clearAll') }}
          </button>
        </div>

        <!-- per-file table -->
        <div
          v-if="entries.length"
          class="overflow-x-auto rounded-md border border-surface-200 dark:border-surface-700"
        >
          <table class="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col class="w-[28%]" />
              <col class="w-[36%]" />
              <col class="w-[30%]" />
              <col class="w-8" />
            </colgroup>
            <thead>
              <tr
                class="bg-surface-50 text-left text-[11px] uppercase tracking-wide text-surface-500 dark:bg-surface-800 dark:text-surface-400"
              >
                <th class="px-2 py-1.5 font-medium">
                  {{ $t('Wiki.import.colFile') }}
                </th>
                <th class="px-2 py-1.5 font-medium">
                  {{ $t('Wiki.import.colTitle') }}
                </th>
                <th class="px-2 py-1.5 font-medium">
                  {{ $t('Wiki.import.colPath') }}
                </th>
                <th class="px-1 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in entries"
                :key="entry.uid"
                class="border-t border-surface-200 dark:border-surface-700"
              >
                <td class="px-2 py-1.5">
                  <div class="flex items-center gap-1.5">
                    <IconFile class="h-4 w-4 shrink-0 text-surface-400" />
                    <div class="min-w-0">
                      <div
                        class="truncate text-surface-800 dark:text-surface-100"
                        :title="entry.file.name"
                      >
                        {{ entry.file.name }}
                      </div>
                      <div
                        class="text-[11px] text-surface-400 dark:text-surface-500"
                      >
                        {{ formatSize(entry.file.size) }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="px-2 py-1.5">
                  <InputText
                    v-model="entry.title"
                    class="w-full !px-2 !py-1 !text-xs"
                    :placeholder="stripExtension(entry.file.name)"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <InputText
                    v-model="entry.path"
                    class="w-full !px-2 !py-1 !text-xs"
                    :placeholder="$t('Wiki.import.pathPlaceholder')"
                  />
                </td>
                <td class="px-1 py-1.5 text-center">
                  <button
                    type="button"
                    class="text-surface-400 hover:text-red-500"
                    :aria-label="$t('Wiki.import.removeFile')"
                    @click="removeEntry(entry.uid)"
                  >
                    <IconClose class="h-4 w-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p
            class="border-t border-surface-200 px-3 py-1.5 text-xs text-surface-400 dark:border-surface-700 dark:text-surface-500"
          >
            {{ $t('Wiki.import.pathColHint') }}
          </p>
        </div>
      </div>

      <!-- url -->
      <div v-else class="flex flex-col gap-3">
        <InputText
          v-model="url"
          type="url"
          class="w-full"
          placeholder="https://…"
          @keydown.enter="canSubmit && submit()"
        />
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Wiki.import.titleLabel') }}
          </label>
          <InputText
            v-model="title"
            class="w-full"
            :placeholder="$t('Wiki.import.titlePlaceholder')"
          />
        </div>
      </div>

      <!-- base location (Ablageort) -->
      <div class="flex flex-col gap-1.5">
        <label class="text-sm text-surface-700 dark:text-surface-300">
          {{ $t('Wiki.import.scopeLabel') }}
        </label>
        <!-- segmented multi-switch: pick the base location kind -->
        <div
          class="inline-flex flex-wrap gap-1 rounded-lg bg-surface-100 p-1 dark:bg-surface-800"
        >
          <button
            v-for="option in scopeKindOptions"
            :key="option.value"
            type="button"
            class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              scopeKind === option.value
                ? 'bg-primary text-primary-contrast shadow-sm'
                : 'text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-surface-50'
            "
            @click="scopeKind = option.value"
          >
            <component :is="option.icon" class="h-4 w-4" />
            {{ option.label }}
          </button>
        </div>
        <!-- team picker, only when the "team" segment is active -->
        <Select
          v-if="scopeKind === 'team'"
          v-model="selectedTeamId"
          :options="teamOptions"
          option-label="label"
          option-value="value"
          class="w-full"
          :placeholder="$t('Wiki.scope.team')"
        />
        <span class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('Wiki.import.baseLocationHint') }}
        </span>
      </div>

      <!-- AI post-processing -->
      <div v-if="agentOptions.length > 1" class="flex flex-col gap-1">
        <label class="text-sm text-surface-700 dark:text-surface-300">
          {{ $t('Wiki.import.postProcessingLabel') }}
        </label>
        <Select
          v-model="postProcessorValue"
          :options="agentOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
        <span class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('Wiki.import.postProcessingHint') }}
        </span>
      </div>

      <label
        class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
      >
        <Checkbox v-model="splitIntoBlocks" binary />
        {{ $t('Wiki.import.splitIntoBlocks') }}
      </label>

      <!-- background-job hint: imports no longer block, they run as a job -->
      <p
        class="flex items-start gap-2 rounded-md bg-surface-100 px-3 py-2 text-xs text-surface-500 dark:bg-surface-800 dark:text-surface-400"
      >
        <IconInbox class="mt-0.5 h-4 w-4 shrink-0" />
        <span>{{ $t('Wiki.import.jobHint') }}</span>
      </p>
    </div>

    <template #footer>
      <SecondaryButton
        :label="$t('Common.cancel')"
        size="small"
        @click="visible = false"
      />
      <Button
        :label="submitLabel"
        size="small"
        :disabled="!canSubmit || submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useI18n } from 'vue-i18n'
import IconUpload from '~icons/mdi/tray-arrow-up'
import IconInbox from '~icons/mdi/inbox-arrow-down-outline'
import IconFolder from '~icons/mdi/folder-outline'
import IconFile from '~icons/mdi/file-document-outline'
import IconClose from '~icons/mdi/close'
import IconPersonal from '~icons/mdi/account-outline'
import IconTeam from '~icons/mdi/account-group-outline'
import IconOrganisation from '~icons/mdi/domain'
import IconCurrent from '~icons/mdi/file-tree-outline'
import { useWiki } from '@/stores/wiki'
import { usePostProcessingAgents } from '@/stores/postProcessingAgents'
import { FetcherError } from '@/utils/fetcher'
import type { WikiScope } from '@/types/wiki'

const props = defineProps<{ tenantId: string }>()
const visible = defineModel<boolean>('visible', { required: true })

const { t } = useI18n()
const route = useRoute()
const toast = useToast()
const wiki = useWiki()
const agentsStore = usePostProcessingAgents()

/** accepted upload types (backend also parses PDF and office docs) */
const FILE_ACCEPT =
  '.md,.markdown,.txt,.html,.htm,.pdf,.doc,.docx,text/markdown,text/plain,text/html,application/pdf'
/** extensions we keep when a folder / mixed selection is dropped */
const SUPPORTED_EXTENSIONS = [
  'md',
  'markdown',
  'txt',
  'html',
  'htm',
  'pdf',
  'doc',
  'docx',
]

/** One queued file plus its editable title and (additional) target path. */
interface ImportEntry {
  uid: string
  file: File
  title: string
  /** additional path segments (slash separated), relative to the base location */
  path: string
}

const mode = ref<'file' | 'url'>('file')
const entries = ref<ImportEntry[]>([])
const url = ref('')
const title = ref('')
const splitIntoBlocks = ref(true)
const dragOver = ref(false)
const submitting = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)

let uidCounter = 0

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '')

const isSupported = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_EXTENSIONS.includes(ext)
}

/** Human-readable file size (B / KB / MB). */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Directory portion of a relative file path ("a/b/c.pdf" -> "a/b", "c.pdf" -> ""). */
const dirOf = (relativePath: string): string => {
  const idx = relativePath.lastIndexOf('/')
  return idx > 0 ? relativePath.slice(0, idx) : ''
}

const addPicked = (picked: { file: File; relPath: string }[]) => {
  for (const { file, relPath } of picked) {
    if (!isSupported(file.name)) continue
    entries.value.push({
      uid: `f${uidCounter++}`,
      file,
      title: stripExtension(file.name),
      path: relPath,
    })
  }
}

const removeEntry = (uid: string) => {
  entries.value = entries.value.filter((e) => e.uid !== uid)
}

// ----- file / folder selection ------------------------------------------

const onFilesSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? []).map((file) => ({
    file,
    // webkitRelativePath is set for a directory pick, "" for a plain file pick
    relPath: dirOf(file.webkitRelativePath ?? ''),
  }))
  addPicked(picked)
  // reset so selecting the same file/folder again re-triggers change
  input.value = ''
}

// ----- drag & drop (with folder support via the entries API) -------------

/** Drain a directory reader (readEntries returns at most ~100 entries per call). */
const readAllEntries = (
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all)
          return
        }
        all.push(...batch)
        pump()
      }, reject)
    }
    pump()
  })

/** Recursively collect files from a dropped filesystem entry, tracking their folder path. */
const traverseEntry = async (
  entry: FileSystemEntry,
  parentDir: string,
  out: { file: File; relPath: string }[],
): Promise<void> => {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej))
    out.push({ file, relPath: parentDir })
  } else if (entry.isDirectory) {
    const dir = parentDir ? `${parentDir}/${entry.name}` : entry.name
    const children = await readAllEntries(
      (entry as FileSystemDirectoryEntry).createReader(),
    )
    for (const child of children) await traverseEntry(child, dir, out)
  }
}

const onDrop = async (event: DragEvent) => {
  dragOver.value = false
  const items = event.dataTransfer?.items
  const picked: { file: File; relPath: string }[] = []

  // Collect the entry handles synchronously — the DataTransferItemList is
  // emptied once the handler yields, but the FileSystemEntry objects survive.
  const entryHandles =
    items && items.length
      ? Array.from(items)
          .map((it) =>
            typeof it.webkitGetAsEntry === 'function'
              ? it.webkitGetAsEntry()
              : null,
          )
          .filter((e): e is FileSystemEntry => !!e)
      : []

  if (entryHandles.length) {
    for (const entry of entryHandles) await traverseEntry(entry, '', picked)
  } else {
    // fallback: no entries API — treat as a flat file list
    for (const file of Array.from(event.dataTransfer?.files ?? [])) {
      picked.push({ file, relPath: '' })
    }
  }
  addPicked(picked)
}

// AI post-processing: '' = none, otherwise the agent id (sent as agent:<id>)
const postProcessorValue = ref('')
const agentOptions = computed(() => [
  { label: t('Wiki.import.postProcessingNone'), value: '' },
  ...agentsStore.agents
    .filter((a) => a.enabled)
    .map((a) => ({ label: a.name, value: a.id })),
])
const postProcessorNames = computed(() =>
  postProcessorValue.value ? [`agent:${postProcessorValue.value}`] : undefined,
)

// the page currently open in the editor (i.e. selected in the tree), if any —
// offered as an import parent. Only counts while a page route is actually
// open, so a stale store page doesn't leak onto the home screen.
const currentPage = computed(() =>
  route.name === 'WikiPage' && wiki.state.page?.id === route.params.pageId
    ? wiki.state.page
    : null,
)

/** Scope of a page, derived from its team/organisation flags. */
const pageScope = (page: {
  teamId: string | null
  tenantWide: boolean
}): WikiScope =>
  page.teamId
    ? { kind: 'team', teamId: page.teamId }
    : page.tenantWide
      ? { kind: 'organisation' }
      : { kind: 'personal' }

// base location, chosen via the segmented multi-switch below. "team" narrows
// further to a specific team via `selectedTeamId`; "current" nests everything
// under the page that was open when the dialog was opened.
type ScopeKind = 'current' | 'personal' | 'team' | 'organisation'
const scopeKind = ref<ScopeKind>('personal')
const selectedTeamId = ref('')

const teamOptions = computed(() =>
  wiki.state.tree.teams.map((team) => ({
    label: team.name,
    value: team.teamId,
  })),
)

/** Segments shown in the switch — "current"/"team" only when applicable. */
const scopeKindOptions = computed(() => {
  const options: { value: ScopeKind; label: string; icon: Component }[] = []
  if (currentPage.value) {
    options.push({
      value: 'current',
      label: t('Wiki.import.underSelected'),
      icon: IconCurrent,
    })
  }
  options.push({
    value: 'personal',
    label: t('Wiki.scope.personal'),
    icon: IconPersonal,
  })
  if (teamOptions.value.length) {
    options.push({
      value: 'team',
      label: t('Wiki.scope.team'),
      icon: IconTeam,
    })
  }
  options.push({
    value: 'organisation',
    label: t('Wiki.scope.organisation'),
    icon: IconOrganisation,
  })
  return options
})

// default the team picker to the first team, and keep it valid as it changes
watch(
  [scopeKind, teamOptions],
  () => {
    if (scopeKind.value !== 'team') return
    const valid = teamOptions.value.some(
      (o) => o.value === selectedTeamId.value,
    )
    if (!valid) selectedTeamId.value = teamOptions.value[0]?.value ?? ''
  },
  { immediate: true },
)

const scope = computed<WikiScope>(() => {
  if (scopeKind.value === 'current' && currentPage.value) {
    return pageScope(currentPage.value)
  }
  if (scopeKind.value === 'organisation') return { kind: 'organisation' }
  if (scopeKind.value === 'team' && selectedTeamId.value) {
    return { kind: 'team', teamId: selectedTeamId.value }
  }
  return { kind: 'personal' }
})

// when importing under the selected page, nest the new pages beneath it
const baseParentId = computed(() =>
  scopeKind.value === 'current' ? currentPage.value?.id : undefined,
)

const canSubmit = computed(() =>
  mode.value === 'file'
    ? entries.value.length > 0
    : url.value.trim().length > 0,
)

const submitLabel = computed(() => {
  if (submitting.value && mode.value === 'file' && entries.value.length > 1) {
    return t('Wiki.import.progress', {
      done: importedCount.value,
      total: entries.value.length,
    })
  }
  if (mode.value === 'file' && entries.value.length > 1) {
    return t('Wiki.import.submitMulti', { count: entries.value.length })
  }
  return t('Wiki.import.submit')
})

const importedCount = ref(0)

/** Split an additional path into clean segments. */
const pathSegments = (path: string): string[] =>
  path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Enqueue the import(s) as background jobs. Each file is imported on its own,
 * nested under any additional path (folders are created on demand). Ingestion
 * (especially PDFs and large pages) can take minutes, so we don't wait for the
 * finished pages: the jobs run on the queue and push a completion message into
 * the inbox (`notifyOnCompletion`). We just confirm they started and close.
 */
const submit = async () => {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true

  const commonOptions = {
    splitIntoBlocks: splitIntoBlocks.value,
    postProcessorNames: postProcessorNames.value,
    notifyOnCompletion: true,
  }

  try {
    if (mode.value === 'url') {
      await wiki.importUrl(props.tenantId, scope.value, url.value.trim(), {
        ...commonOptions,
        title: title.value.trim() || undefined,
        parentId: baseParentId.value,
      })
    } else {
      importedCount.value = 0
      let failures = 0
      for (const entry of entries.value) {
        try {
          const parentId = await wiki.ensurePagePath(
            props.tenantId,
            scope.value,
            pathSegments(entry.path),
            baseParentId.value,
          )
          await wiki.importFile(props.tenantId, scope.value, entry.file, {
            ...commonOptions,
            title: entry.title.trim() || undefined,
            parentId,
          })
        } catch {
          failures++
        }
        importedCount.value++
      }
      if (failures > 0) {
        toast.add({
          severity: 'warn',
          summary: t('Common.error'),
          detail: t('Wiki.import.partialError', { count: failures }),
          life: 6000,
        })
      }
    }

    visible.value = false
    toast.add({
      severity: 'info',
      summary: t('Wiki.import.started'),
      detail: t('Wiki.import.startedDetail'),
      life: 5000,
    })
  } catch (error) {
    const detail =
      error instanceof FetcherError && error.body
        ? error.body
        : t('Wiki.import.error')
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail,
      life: 5000,
    })
  } finally {
    submitting.value = false
  }
}

const reset = () => {
  mode.value = 'file'
  entries.value = []
  url.value = ''
  title.value = ''
  splitIntoBlocks.value = true
  scopeKind.value = 'personal'
  postProcessorValue.value = ''
  dragOver.value = false
  submitting.value = false
  importedCount.value = 0
}

// On open, default to nesting under the page the user just had selected and
// fetch the tenant's enabled post-processing agents for the picker.
watch(visible, (open) => {
  if (open) {
    reset()
    if (currentPage.value) scopeKind.value = 'current'
    agentsStore.loadAgents(props.tenantId).catch(() => {})
  }
})
</script>
