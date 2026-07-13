<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('Wiki.import.title')"
    class="w-[540px] max-w-[92vw]"
    @hide="reset"
  >
    <!-- Step: input -->
    <div v-if="step === 'input'" class="flex flex-col gap-4">
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
      <div v-if="mode === 'file'">
        <button
          type="button"
          class="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors"
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
          <span
            v-if="file"
            class="text-sm font-medium text-surface-800 dark:text-surface-100"
          >
            {{ file.name }}
          </span>
          <template v-else>
            <span class="text-sm text-surface-600 dark:text-surface-300">
              {{ $t('Wiki.import.dropHint') }}
            </span>
            <span class="text-xs text-surface-400 dark:text-surface-500">
              {{ $t('Wiki.import.fileTypes') }}
            </span>
          </template>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          class="hidden"
          :accept="FILE_ACCEPT"
          @change="onFileSelected"
        />
      </div>

      <!-- url -->
      <div v-else class="flex flex-col gap-1">
        <InputText
          v-model="url"
          type="url"
          class="w-full"
          placeholder="https://…"
          @keydown.enter="canSubmit && submit()"
        />
      </div>

      <!-- title (optional) -->
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

      <!-- scope -->
      <div class="flex flex-col gap-1">
        <label class="text-sm text-surface-700 dark:text-surface-300">
          {{ $t('Wiki.import.scopeLabel') }}
        </label>
        <Select
          v-model="scopeValue"
          :options="scopeOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>

      <label
        class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
      >
        <Checkbox v-model="splitIntoBlocks" binary />
        {{ $t('Wiki.import.splitIntoBlocks') }}
      </label>
    </div>

    <!-- Step: processing -->
    <div
      v-else-if="step === 'processing'"
      class="flex flex-col items-center gap-4 py-10 text-center"
    >
      <span
        class="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"
      >
        <IconImport class="h-7 w-7 animate-pulse text-primary" />
      </span>
      <div class="flex flex-col items-center gap-1">
        <span
          class="text-sm font-medium text-surface-800 dark:text-surface-100"
        >
          {{ $t('Wiki.import.processing') }}
        </span>
        <span
          v-if="sourceLabel"
          class="max-w-[22rem] truncate text-xs text-surface-500 dark:text-surface-400"
        >
          {{ sourceLabel }}
        </span>
      </div>
      <!-- indeterminate progress bar -->
      <div
        class="h-1 w-48 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700"
      >
        <div class="import-bar h-full w-1/3 rounded-full bg-primary" />
      </div>
      <span class="text-xs text-surface-400 dark:text-surface-500">
        {{ $t('Wiki.import.processingHint') }}
      </span>
    </div>

    <template #footer>
      <template v-if="step === 'input'">
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="visible = false"
        />
        <Button
          :label="$t('Wiki.import.submit')"
          size="small"
          :disabled="!canSubmit"
          @click="submit"
        />
      </template>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useI18n } from 'vue-i18n'
import IconUpload from '~icons/mdi/tray-arrow-up'
import IconImport from '~icons/mdi/file-import-outline'
import { useWiki } from '@/stores/wiki'
import { FetcherError } from '@/utils/fetcher'
import type { WikiScope } from '@/types/wiki'

const props = defineProps<{ tenantId: string }>()
const visible = defineModel<boolean>('visible', { required: true })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const wiki = useWiki()

/** accepted upload types (backend also parses PDF and office docs) */
const FILE_ACCEPT =
  '.md,.markdown,.txt,.html,.htm,.pdf,.doc,.docx,text/markdown,text/plain,text/html,application/pdf'

type Step = 'input' | 'processing'
const step = ref<Step>('input')
const mode = ref<'file' | 'url'>('file')
const file = ref<File | null>(null)
const url = ref('')
const title = ref('')
const splitIntoBlocks = ref(true)
const dragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

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

// scope: "current" | "personal" | "organisation" | "team:<id>"
const scopeValue = ref('personal')
const scopeOptions = computed(() => {
  const options: { label: string; value: string }[] = []
  const page = currentPage.value
  if (page) {
    const name = page.title?.trim() || t('Wiki.untitled')
    options.push({
      label: `${t('Wiki.import.underSelected')}: ${name}`,
      value: 'current',
    })
  }
  options.push(
    { label: t('Wiki.scope.personal'), value: 'personal' },
    ...wiki.state.tree.teams.map((team) => ({
      label: `${t('Wiki.scope.team')}: ${team.name}`,
      value: `team:${team.teamId}`,
    })),
    { label: t('Wiki.scope.organisation'), value: 'organisation' },
  )
  return options
})

const scope = computed<WikiScope>(() => {
  if (scopeValue.value === 'current' && currentPage.value) {
    return pageScope(currentPage.value)
  }
  if (scopeValue.value === 'organisation') return { kind: 'organisation' }
  if (scopeValue.value.startsWith('team:')) {
    return { kind: 'team', teamId: scopeValue.value.slice('team:'.length) }
  }
  return { kind: 'personal' }
})

// when importing under the selected page, nest the new page beneath it
const parentId = computed(() =>
  scopeValue.value === 'current' ? currentPage.value?.id : undefined,
)

const canSubmit = computed(() =>
  mode.value === 'file' ? !!file.value : url.value.trim().length > 0,
)

/** Human-readable source shown in the processing view. */
const sourceLabel = computed(() =>
  mode.value === 'file' ? (file.value?.name ?? '') : url.value.trim(),
)

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
}

const onDrop = (event: DragEvent) => {
  dragOver.value = false
  const dropped = event.dataTransfer?.files?.[0]
  if (dropped) file.value = dropped
}

const submit = async () => {
  if (!canSubmit.value) return
  step.value = 'processing'
  const options = {
    title: title.value.trim() || undefined,
    splitIntoBlocks: splitIntoBlocks.value,
    parentId: parentId.value,
  }
  try {
    const page =
      mode.value === 'file'
        ? await wiki.importFile(
            props.tenantId,
            scope.value,
            file.value!,
            options,
          )
        : await wiki.importUrl(
            props.tenantId,
            scope.value,
            url.value.trim(),
            options,
          )
    visible.value = false
    router.push({
      name: 'WikiPage',
      params: { tenantId: props.tenantId, pageId: page.id },
    })
  } catch (error) {
    step.value = 'input'
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
  }
}

const reset = () => {
  step.value = 'input'
  mode.value = 'file'
  file.value = null
  url.value = ''
  title.value = ''
  splitIntoBlocks.value = true
  scopeValue.value = 'personal'
  dragOver.value = false
}

// On open, default to nesting under the page the user just had selected.
watch(visible, (open) => {
  if (open) {
    reset()
    if (currentPage.value) scopeValue.value = 'current'
  }
})
</script>

<style scoped>
/* indeterminate progress bar for the import processing view */
.import-bar {
  animation: import-slide 1.1s ease-in-out infinite;
}
@keyframes import-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(360%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .import-bar {
    animation: none;
  }
}
</style>
