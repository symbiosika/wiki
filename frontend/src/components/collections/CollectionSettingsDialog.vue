<script setup lang="ts">
/**
 * Everything about the table's setup in ONE dialog: its name and description,
 * its columns, whether it is mirrored into the page text, and deleting it.
 *
 * Previously the columns lived here and the rest behind a second icon in the
 * panel header. Two entry points for "configure this table" is one too many —
 * nobody can predict which of them holds the switch they want.
 *
 * Reordering is done with up/down buttons instead of drag-and-drop: for the
 * handful of columns a collection has, buttons are faster, keyboard-accessible
 * and cannot be dropped in the wrong place.
 */
import { useConfirm } from 'primevue/useconfirm'
import IconPlus from '~icons/mdi/plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconUp from '~icons/mdi/arrow-up'
import IconDown from '~icons/mdi/arrow-down'
import IconEye from '~icons/mdi/eye-outline'
import IconEyeOff from '~icons/mdi/eye-off-outline'
import type { Collection } from '@/utils/collections'
import {
  COLLECTION_FIELD_TYPES,
  CHOICE_COLORS,
  choiceClasses,
  type CollectionField,
  type CollectionFieldType,
} from '@/utils/collections'

const props = defineProps<{
  visible: boolean
  collection: Collection
  fields: CollectionField[]
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  add: [{ label: string; type: CollectionFieldType; options?: any; required?: boolean }]
  update: [{ id: string; patch: Partial<CollectionField> }]
  remove: [string]
  reorder: [string[]]
  /** name / description / settings of the table itself */
  updateCollection: [{ name?: string | null; description?: string | null; settings?: any }]
  deleteCollection: []
}>()

const { t } = useI18n()
const confirm = useConfirm()

const typeOptions = computed(() =>
  COLLECTION_FIELD_TYPES.map((type) => ({
    label: t(`Collections.types.${type}`),
    value: type,
  })),
)

/** the column currently expanded for editing */
const openId = ref<string | null>(null)

// --- the table itself ----------------------------------------------------

/**
 * Name and description are buffered locally and committed on blur, so typing
 * does not fire a request per keystroke. The name placeholder shows the page
 * title: that is what the table is called while it has no name of its own.
 */
const nameDraft = ref('')
const descriptionDraft = ref('')

watch(
  () => [props.visible, props.collection?.id] as const,
  ([visible]) => {
    if (!visible) return
    nameDraft.value = props.collection?.name ?? ''
    descriptionDraft.value = props.collection?.description ?? ''
  },
  { immediate: true },
)

function commitName() {
  const next = nameDraft.value.trim()
  if (next === (props.collection?.name ?? '')) return
  emit('updateCollection', { name: next || null })
}

function commitDescription() {
  const next = descriptionDraft.value.trim()
  if (next === (props.collection?.description ?? '')) return
  emit('updateCollection', { description: next || null })
}

function toggleMaterialize(value: boolean) {
  emit('updateCollection', { settings: { materialize: value } })
}

function confirmDeleteCollection() {
  confirm.require({
    message: t('Collections.deleteConfirm'),
    header: t('Collections.delete'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: () => emit('deleteCollection'),
  })
}

// ---- new column ---------------------------------------------------------

const draft = ref<{ label: string; type: CollectionFieldType; required: boolean; choices: string }>({
  label: '',
  type: 'text',
  required: false,
  choices: '',
})

const draftNeedsChoices = computed(
  () => draft.value.type === 'select' || draft.value.type === 'multiSelect',
)

/** One option per line — the fastest way to type a list of statuses. */
function parseChoices(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => ({ value }))
}

const canAdd = computed(() => {
  if (!draft.value.label.trim()) return false
  if (draftNeedsChoices.value && parseChoices(draft.value.choices).length === 0) return false
  return true
})

function addField() {
  if (!canAdd.value) return
  emit('add', {
    label: draft.value.label.trim(),
    type: draft.value.type,
    required: draft.value.required,
    ...(draftNeedsChoices.value
      ? { options: { choices: parseChoices(draft.value.choices) } }
      : {}),
  })
  draft.value = { label: '', type: 'text', required: false, choices: '' }
}

// ---- editing an existing column ----------------------------------------

function patch(field: CollectionField, patchData: Partial<CollectionField>) {
  emit('update', { id: field.id, patch: patchData })
}

/** Local buffer for the choices textarea, flushed on blur. */
const choiceDrafts = ref<Record<string, string>>({})

function choiceText(field: CollectionField): string {
  if (choiceDrafts.value[field.id] !== undefined) return choiceDrafts.value[field.id]!
  return (field.options?.choices ?? []).map((c) => c.value).join('\n')
}

function commitChoices(field: CollectionField) {
  const text = choiceDrafts.value[field.id]
  if (text === undefined) return
  const choices = parseChoices(text)
  delete choiceDrafts.value[field.id]
  if (choices.length === 0) return
  // keep the colour already assigned to a value that survived the edit
  const previous = new Map(
    (field.options?.choices ?? []).map((c) => [c.value, c.color]),
  )
  patch(field, {
    options: {
      ...field.options,
      choices: choices.map((c) => ({ value: c.value, color: previous.get(c.value) })),
    },
  })
}

function setChoiceColor(field: CollectionField, value: string, color: string) {
  patch(field, {
    options: {
      ...field.options,
      choices: (field.options?.choices ?? []).map((c) =>
        c.value === value ? { ...c, color } : c,
      ),
    },
  })
}

function move(field: CollectionField, direction: -1 | 1) {
  const ids = props.fields.map((f) => f.id)
  const from = ids.indexOf(field.id)
  const to = from + direction
  if (to < 0 || to >= ids.length) return
  ids.splice(to, 0, ...ids.splice(from, 1))
  emit('reorder', ids)
}

function confirmRemove(field: CollectionField) {
  confirm.require({
    message: t('Collections.fields.deleteConfirm', { name: field.label }),
    header: t('Collections.fields.delete'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: () => emit('remove', field.id),
  })
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="$t('Collections.settings.title')"
    class="w-[640px] max-w-[94vw]"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex max-h-[64vh] flex-col gap-4 overflow-y-auto px-0.5 py-1">
      <!-- name + description of the table itself -->
      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="flex flex-1 flex-col gap-1">
          <label class="text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Collections.settings.name') }}
          </label>
          <InputText
            v-model="nameDraft"
            class="w-full"
            :placeholder="collection.pageTitle"
            @blur="commitName"
            @keydown.enter="commitName"
          />
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Collections.settings.nameHint') }}
          </span>
        </div>
        <div class="flex flex-1 flex-col gap-1">
          <label class="text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Collections.settings.description') }}
          </label>
          <InputText
            v-model="descriptionDraft"
            class="w-full"
            :placeholder="$t('Collections.descriptionPlaceholder')"
            @blur="commitDescription"
            @keydown.enter="commitDescription"
          />
        </div>
      </div>

      <div class="border-t border-surface-200 dark:border-surface-700" />

      <p class="text-sm font-medium text-surface-700 dark:text-surface-300">
        {{ $t('Collections.fields.title') }}
      </p>

      <!-- existing columns -->
      <div
        v-for="(field, index) in fields"
        :key="field.id"
        class="rounded-lg border border-surface-200 dark:border-surface-700"
        :class="{ 'opacity-60': field.hidden }"
      >
        <!-- summary row -->
        <div class="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            @click="openId = openId === field.id ? null : field.id"
          >
            <span class="truncate font-medium text-surface-900 dark:text-surface-0">
              {{ field.label }}
            </span>
            <span
              v-if="field.required"
              class="text-rose-500"
              :title="$t('Collections.fields.required')"
              >*</span
            >
            <span
              class="shrink-0 rounded-full bg-surface-100 px-2 py-0.5 text-xs text-surface-600 dark:bg-surface-700 dark:text-surface-300"
            >
              {{ $t(`Collections.types.${field.type}`) }}
            </span>
          </button>

          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="rounded p-1 text-surface-400 hover:text-primary disabled:opacity-30"
              :disabled="index === 0"
              :title="$t('Collections.fields.moveUp')"
              @click="move(field, -1)"
            >
              <IconUp class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="rounded p-1 text-surface-400 hover:text-primary disabled:opacity-30"
              :disabled="index === fields.length - 1"
              :title="$t('Collections.fields.moveDown')"
              @click="move(field, 1)"
            >
              <IconDown class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="rounded p-1 text-surface-400 hover:text-primary"
              :title="field.hidden ? $t('Collections.fields.show') : $t('Collections.fields.hide')"
              @click="patch(field, { hidden: !field.hidden })"
            >
              <IconEyeOff v-if="field.hidden" class="h-4 w-4" />
              <IconEye v-else class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="rounded p-1 text-surface-400 hover:text-rose-500"
              :title="$t('Collections.fields.delete')"
              @click="confirmRemove(field)"
            >
              <IconTrash class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- expanded editor -->
        <div
          v-if="openId === field.id"
          class="space-y-3 border-t border-surface-200 px-3 py-3 dark:border-surface-700"
        >
          <div class="flex flex-col gap-3 sm:flex-row">
            <div class="flex flex-1 flex-col gap-1">
              <label class="text-xs text-surface-500 dark:text-surface-400">
                {{ $t('Collections.fields.name') }}
              </label>
              <InputText
                :model-value="field.label"
                class="w-full"
                @change="patch(field, { label: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="flex flex-1 flex-col gap-1">
              <label class="text-xs text-surface-500 dark:text-surface-400">
                {{ $t('Collections.fields.type') }}
              </label>
              <Select
                :model-value="field.type"
                :options="typeOptions"
                option-label="label"
                option-value="value"
                class="w-full"
                @update:model-value="patch(field, { type: $event })"
              />
            </div>
          </div>

          <!-- select options, one per line -->
          <div
            v-if="field.type === 'select' || field.type === 'multiSelect'"
            class="flex flex-col gap-1"
          >
            <label class="text-xs text-surface-500 dark:text-surface-400">
              {{ $t('Collections.fields.choices') }}
            </label>
            <!-- auto-resize: a five-option list must not need its own scrollbar -->
            <Textarea
              :model-value="choiceText(field)"
              rows="4"
              auto-resize
              class="w-full font-mono text-sm"
              @update:model-value="choiceDrafts[field.id] = $event as string"
              @blur="commitChoices(field)"
            />
            <!-- colour picker per option -->
            <div
              v-if="(field.options?.choices ?? []).length"
              class="mt-1 flex flex-col gap-1.5"
            >
              <div
                v-for="choice in field.options?.choices ?? []"
                :key="choice.value"
                class="flex items-center gap-2"
              >
                <span
                  class="rounded-full px-2 py-0.5 text-xs"
                  :class="choiceClasses(choice.color)"
                >
                  {{ choice.value }}
                </span>
                <div class="flex gap-1">
                  <button
                    v-for="color in CHOICE_COLORS"
                    :key="color"
                    type="button"
                    class="h-4 w-4 rounded-full border"
                    :class="[
                      choiceClasses(color),
                      choice.color === color
                        ? 'border-surface-900 dark:border-surface-0'
                        : 'border-transparent',
                    ]"
                    :title="color"
                    @click="setChoiceColor(field, choice.value, color)"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- number formatting -->
          <div v-if="field.type === 'number'" class="flex gap-3">
            <div class="flex flex-1 flex-col gap-1">
              <label class="text-xs text-surface-500 dark:text-surface-400">
                {{ $t('Collections.fields.precision') }}
              </label>
              <InputText
                :model-value="field.options?.precision?.toString() ?? ''"
                inputmode="numeric"
                class="w-full"
                @change="
                  patch(field, {
                    options: {
                      ...field.options,
                      precision:
                        ($event.target as HTMLInputElement).value === ''
                          ? undefined
                          : Number(($event.target as HTMLInputElement).value),
                    },
                  })
                "
              />
            </div>
            <div class="flex flex-1 flex-col gap-1">
              <label class="text-xs text-surface-500 dark:text-surface-400">
                {{ $t('Collections.fields.suffix') }}
              </label>
              <InputText
                :model-value="field.options?.suffix ?? ''"
                class="w-full"
                placeholder="€"
                @change="
                  patch(field, {
                    options: {
                      ...field.options,
                      suffix: ($event.target as HTMLInputElement).value || undefined,
                    },
                  })
                "
              />
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Checkbox
              :model-value="field.required"
              binary
              :input-id="`req-${field.id}`"
              @update:model-value="patch(field, { required: $event })"
            />
            <label
              :for="`req-${field.id}`"
              class="text-sm text-surface-700 dark:text-surface-300"
            >
              {{ $t('Collections.fields.required') }}
            </label>
          </div>
        </div>
      </div>

      <!-- add a column -->
      <div
        class="rounded-lg border border-dashed border-surface-300 p-3 dark:border-surface-600"
      >
        <p class="mb-2 text-sm font-medium text-surface-700 dark:text-surface-300">
          {{ $t('Collections.fields.add') }}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <InputText
            v-model="draft.label"
            class="flex-1"
            :placeholder="$t('Collections.fields.namePlaceholder')"
            @keydown.enter="addField"
          />
          <Select
            v-model="draft.type"
            :options="typeOptions"
            option-label="label"
            option-value="value"
            class="sm:w-44"
          />
        </div>
        <Textarea
          v-if="draftNeedsChoices"
          v-model="draft.choices"
          rows="4"
          auto-resize
          class="mt-2 w-full font-mono text-sm"
          :placeholder="$t('Collections.fields.choicesPlaceholder')"
        />
        <div class="mt-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Checkbox v-model="draft.required" binary input-id="new-required" />
            <label
              for="new-required"
              class="text-sm text-surface-700 dark:text-surface-300"
            >
              {{ $t('Collections.fields.required') }}
            </label>
          </div>
          <Button
            :label="$t('Collections.fields.addButton')"
            size="small"
            :disabled="!canAdd"
            :loading="saving"
            @click="addField"
          >
            <template #icon><IconPlus /></template>
          </Button>
        </div>
      </div>

      <div class="border-t border-surface-200 dark:border-surface-700" />

      <!-- mirroring into the page text -->
      <div class="flex items-start gap-2">
        <Checkbox
          :model-value="collection.settings?.materialize ?? false"
          binary
          input-id="materialize"
          @update:model-value="toggleMaterialize"
        />
        <label for="materialize" class="text-sm">
          <span class="text-surface-800 dark:text-surface-100">
            {{ $t('Collections.settings.materialize') }}
          </span>
          <!--
            Not decoration: mirroring copies the rows into the page body, which
            is what the AI search and the public view read. For a table of
            members that is a privacy decision.
          -->
          <span class="mt-0.5 block text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Collections.settings.materializeHint') }}
          </span>
        </label>
      </div>

      <div class="border-t border-surface-200 pt-3 dark:border-surface-700">
        <Button
          :label="$t('Collections.delete')"
          severity="danger"
          outlined
          size="small"
          @click="confirmDeleteCollection"
        />
        <p class="mt-1.5 text-xs text-surface-500 dark:text-surface-400">
          {{ $t('Collections.deleteHint') }}
        </p>
      </div>
    </div>

    <template #footer>
      <Button
        :label="$t('Common.close')"
        severity="secondary"
        outlined
        size="small"
        @click="emit('update:visible', false)"
      />
    </template>
  </Dialog>
</template>
