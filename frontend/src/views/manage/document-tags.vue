<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('UserTenants.metadata.title')" />

    <ManageTabs />

    <!--
      Page type presentation. Kept above the attribute definitions because it
      changes what everyone sees in the sidebar, while attributes are a
      back-office concern. Saved through its own request: the two lists are
      independent parts of the knowledge config.
    -->
    <section class="mb-8">
      <h2
        class="mb-1 text-sm font-semibold text-surface-800 dark:text-surface-100"
      >
        {{ $t('UserTenants.pageTypes.title') }}
      </h2>
      <p class="mb-3 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('UserTenants.pageTypes.description') }}
      </p>

      <PageTypeStyleEditor v-model="pageTypeStyles" :page-types="pageTypes" />

      <div class="mt-3 flex justify-end">
        <Button
          :label="$t('UserTenants.metadata.save')"
          size="small"
          :loading="knowledgeConfig.saving"
          :disabled="knowledgeConfig.loading || !pageTypeStylesDirty"
          @click="savePageTypeStyles"
        />
      </div>
    </section>

    <h2
      class="mb-1 text-sm font-semibold text-surface-800 dark:text-surface-100"
    >
      {{ $t('UserTenants.metadata.attributesTitle') }}
    </h2>
    <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('UserTenants.metadata.description') }}
    </p>

    <div class="flex flex-col gap-3">
      <div
        v-for="(row, index) in attributeRows"
        :key="index"
        class="flex flex-col gap-2 rounded-lg border border-surface-200 p-3 sm:flex-row sm:items-start dark:border-surface-800"
      >
        <div class="flex flex-1 flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.metadata.key') }}
          </label>
          <InputText
            v-model="row.key"
            class="w-full"
            :placeholder="$t('UserTenants.metadata.keyPlaceholder')"
          />
        </div>
        <div class="flex flex-1 flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.metadata.label') }}
          </label>
          <InputText
            v-model="row.label"
            class="w-full"
            :placeholder="$t('UserTenants.metadata.labelPlaceholder')"
          />
        </div>
        <div class="flex flex-[2] flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.metadata.attrDescription') }}
          </label>
          <InputText
            v-model="row.description"
            class="w-full"
            :placeholder="$t('UserTenants.metadata.descriptionPlaceholder')"
          />
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('UserTenants.metadata.descriptionHint') }}
          </span>
        </div>
        <div class="flex flex-[2] flex-col gap-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.metadata.values') }}
          </label>
          <InputText
            v-model="row.valuesText"
            class="w-full"
            :placeholder="$t('UserTenants.metadata.valuesPlaceholder')"
          />
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('UserTenants.metadata.valuesHint') }}
          </span>
        </div>
        <button
          type="button"
          class="mt-1 self-start rounded p-2 text-surface-400 hover:bg-surface-100 hover:text-red-500 dark:hover:bg-surface-800"
          :title="$t('UserTenants.metadata.remove')"
          @click="removeAttribute(index)"
        >
          <IconTrash class="h-4 w-4" />
        </button>
      </div>

      <div
        v-if="attributeRows.length === 0"
        class="rounded-lg border border-dashed border-surface-200 p-4 text-center text-sm text-surface-400 dark:border-surface-800 dark:text-surface-500"
      >
        {{ $t('UserTenants.metadata.empty') }}
      </div>
    </div>

    <div class="mt-3 flex items-center justify-between">
      <SecondaryButton
        :label="$t('UserTenants.metadata.addAttribute')"
        size="small"
        @click="addAttribute"
      >
        <template #icon><IconPlus /></template>
      </SecondaryButton>
      <Button
        :label="$t('UserTenants.metadata.save')"
        size="small"
        :loading="knowledgeConfig.saving"
        :disabled="knowledgeConfig.loading || !metadataDirty"
        @click="saveMetadata"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconPlus from '~icons/mdi/plus'
import type {
  KnowledgeAttributeDefinition,
  WikiKnowledgeConfig,
  WikiPageTypeStyle,
} from '@/types/wiki'
import PageTypeStyleEditor from '@/components/manage/PageTypeStyleEditor.vue'
import { useKnowledgeConfig } from '@/stores/knowledgeConfig'

const { t } = useI18n()
const toast = useToast()
const route = useRoute()
const app = useApp()
const knowledgeConfig = useKnowledgeConfig()
const wiki = useWiki()

// Document tags are configured for the currently active organisation.
const tenantId = computed(() => String(route.params.tenantId))

/** Editable form rows for the per-organisation metadata (tag) definitions. */
interface AttributeRow {
  key: string
  label: string
  /** Extractor instruction passed to the PDF parser; empty falls back to label/key. */
  description: string
  /** Allowed values as a comma-separated string; empty means free text. */
  valuesText: string
}
const attributeRows = ref<AttributeRow[]>([])
const savedAttributesJson = ref('[]')

/**
 * Page type vocabulary (read-only here — it is validated on every page write,
 * so it is not edited from this screen) plus its editable presentation map.
 */
const pageTypes = ref<string[]>([])
const pageTypeStyles = ref<Record<string, WikiPageTypeStyle>>({})
const savedPageTypeStylesJson = ref('{}')

const pageTypeStylesDirty = computed(
  () => JSON.stringify(pageTypeStyles.value) !== savedPageTypeStylesJson.value,
)

onMounted(async () => {
  await app.waitForInit()
  await loadMetadata()
})

/** Turn the editable rows into the definition shape the backend expects. */
const toDefinitions = (rows: AttributeRow[]): KnowledgeAttributeDefinition[] =>
  rows
    .map((row) => {
      const values = row.valuesText
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      const def: KnowledgeAttributeDefinition = { key: row.key.trim() }
      const label = row.label.trim()
      if (label) def.label = label
      const description = row.description.trim()
      if (description) def.description = description
      if (values.length) def.values = values
      return def
    })
    .filter((def) => def.key.length > 0)

const toRows = (
  definitions: KnowledgeAttributeDefinition[] | undefined,
): AttributeRow[] =>
  (definitions ?? []).map((def) => ({
    key: def.key,
    label: def.label ?? '',
    description: def.description ?? '',
    valuesText: (def.values ?? []).join(', '),
  }))

/** True when the edited definitions differ from the last persisted ones. */
const metadataDirty = computed(
  () =>
    JSON.stringify(toDefinitions(attributeRows.value)) !==
    savedAttributesJson.value,
)

const loadMetadata = async () => {
  try {
    const config = await knowledgeConfig.loadConfig(tenantId.value)
    attributeRows.value = toRows(config.attributes)
    savedAttributesJson.value = JSON.stringify(
      toDefinitions(attributeRows.value),
    )
    applyPageTypeConfig(config)
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.metadata.loadError'),
      life: 3000,
    })
  }
}

const addAttribute = () => {
  attributeRows.value.push({
    key: '',
    label: '',
    description: '',
    valuesText: '',
  })
}

const removeAttribute = (index: number) => {
  attributeRows.value.splice(index, 1)
}

const saveMetadata = async () => {
  const definitions = toDefinitions(attributeRows.value)
  const keys = definitions.map((def) => def.key)
  if (new Set(keys).size !== keys.length) {
    toast.add({
      severity: 'warn',
      summary: t('Common.error'),
      detail: t('UserTenants.metadata.duplicateKey'),
      life: 4000,
    })
    return
  }
  try {
    const config = await knowledgeConfig.saveAttributes(
      tenantId.value,
      definitions,
    )
    attributeRows.value = toRows(config.attributes)
    savedAttributesJson.value = JSON.stringify(
      toDefinitions(attributeRows.value),
    )
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.metadata.saved'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.metadata.saveError'),
      life: 4000,
    })
  }
}

/** Hydrate the page type rows and reset their dirty baseline. */
const applyPageTypeConfig = (config: WikiKnowledgeConfig) => {
  pageTypes.value = config.pageTypes
  pageTypeStyles.value = { ...(config.pageTypeStyles ?? {}) }
  savedPageTypeStylesJson.value = JSON.stringify(pageTypeStyles.value)
}

const savePageTypeStyles = async () => {
  try {
    const config = await knowledgeConfig.savePageTypeStyles(
      tenantId.value,
      pageTypeStyles.value,
    )
    applyPageTypeConfig(config)
    // The wiki store caches the config for the sidebar and the open page, so
    // the new icons would otherwise only show up after a full reload.
    await wiki.reloadConfig(tenantId.value)
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.metadata.saved'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.metadata.saveError'),
      life: 4000,
    })
  }
}
</script>
