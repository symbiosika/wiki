<script setup lang="ts">
/**
 * Create / edit one record as a form — the Airtable "expand row" view.
 *
 * Inline cell editing in the table handles quick corrections; this is for
 * adding a row and for editing long text, where a table cell is the wrong
 * shape. Only the fields the user actually changed are sent, so two people
 * editing different columns of the same row do not overwrite each other.
 *
 * The dialog owns the outcome of its own save: it stays open until the save
 * actually succeeded. A rejected value (a required column left empty, a date
 * that is not a date) is shown *in the form*, next to the input that caused it,
 * with everything the user typed still there to correct. Closing on submit and
 * announcing the failure in a toast afterwards would throw the input away and
 * leave nothing to fix.
 */
import type { CollectionField, CollectionRecord, ValueProblem } from '@/utils/collections'
import { checkRecordData, emptyRecordData } from '@/utils/collections'

const props = defineProps<{
  visible: boolean
  fields: CollectionField[]
  /** null = create a new record */
  record: CollectionRecord | null
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  /**
   * `done` reports the outcome back: `null` on success (the dialog closes),
   * a message on failure (the dialog stays open and shows it).
   */
  save: [{ data: Record<string, unknown>; done: (error: string | null) => void }]
}>()

const { t } = useI18n()

const form = ref<Record<string, unknown>>({})
/** snapshot of the form as it was opened, to diff against on save */
const initial = ref<Record<string, unknown>>({})
/** per-column complaints, keyed by field key */
const fieldErrors = ref<Record<string, string>>({})
/** whatever the server said, when it is not tied to one column */
const formError = ref<string | null>(null)
const submitting = ref(false)

const isEdit = computed(() => props.record !== null)
const busy = computed(() => submitting.value || props.saving === true)

/** Reset the form whenever the dialog opens. */
watch(
  () => [props.visible, props.record?.id] as const,
  ([visible]) => {
    if (!visible) return
    form.value = props.record
      ? { ...emptyRecordData(props.fields), ...props.record.data }
      : emptyRecordData(props.fields)
    initial.value = JSON.parse(JSON.stringify(form.value))
    fieldErrors.value = {}
    formError.value = null
    submitting.value = false
  },
  { immediate: true },
)

/** Typing in a flagged field clears its complaint — the error is stale then. */
function onFieldInput(key: string) {
  if (fieldErrors.value[key]) {
    const { [key]: _dropped, ...rest } = fieldErrors.value
    fieldErrors.value = rest
  }
  formError.value = null
}

/** The complaint to show under a column, in the user's language. */
function messageFor(key: string, problem: ValueProblem): string {
  if (problem !== 'required') return t(`Collections.validation.${problem}`)
  const field = props.fields.find((f) => f.key === key)
  // "please fill this in" is nonsense under a checkbox
  return field?.type === 'checkbox'
    ? t('Collections.validation.requiredCheck')
    : t('Collections.validation.required')
}

function close() {
  emit('update:visible', false)
}

/** The values to send: everything on create, only the changed keys on edit. */
function payload(): Record<string, unknown> {
  if (!isEdit.value) return { ...form.value }
  // the server patches per key, so a concurrent edit of another column must
  // not be overwritten with our stale copy
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(form.value)) {
    if (JSON.stringify(value ?? null) !== JSON.stringify(initial.value[key] ?? null)) {
      patch[key] = value
    }
  }
  return patch
}

function submit() {
  if (busy.value) return
  const data = payload()

  const problems = checkRecordData(props.fields, data, isEdit.value ? 'patch' : 'create')
  if (Object.keys(problems).length > 0) {
    fieldErrors.value = Object.fromEntries(
      Object.entries(problems).map(([key, problem]) => [key, messageFor(key, problem)]),
    )
    formError.value = null
    return
  }

  // nothing changed — no point asking the server
  if (isEdit.value && Object.keys(data).length === 0) {
    close()
    return
  }

  fieldErrors.value = {}
  formError.value = null
  submitting.value = true
  emit('save', {
    data,
    done: (error: string | null) => {
      submitting.value = false
      if (error === null) close()
      else formError.value = error
    },
  })
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="isEdit ? t('Collections.record.editTitle') : t('Collections.record.createTitle')"
    class="w-[560px] max-w-[94vw]"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-0.5 py-1">
      <Message v-if="formError" severity="error" class="text-sm">
        {{ formError }}
      </Message>

      <div
        v-for="(field, index) in fields"
        :key="field.id"
        class="flex flex-col gap-1.5"
      >
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300">
          {{ field.label }}
          <span v-if="field.required" class="text-rose-500">*</span>
        </label>
        <CollectionValueInput
          v-model="form[field.key]"
          :field="field"
          :autofocus="index === 0"
          :invalid="Boolean(fieldErrors[field.key])"
          @update:model-value="onFieldInput(field.key)"
        />
        <small v-if="fieldErrors[field.key]" class="text-rose-500">
          {{ fieldErrors[field.key] }}
        </small>
      </div>

      <p
        v-if="fields.length === 0"
        class="text-sm text-surface-500 dark:text-surface-400"
      >
        {{ $t('Collections.record.noColumns') }}
      </p>
    </div>

    <template #footer>
      <Button
        :label="$t('Common.cancel')"
        severity="secondary"
        outlined
        size="small"
        @click="close"
      />
      <Button
        :label="isEdit ? $t('Common.save') : $t('Collections.record.add')"
        size="small"
        :loading="busy"
        :disabled="fields.length === 0"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
