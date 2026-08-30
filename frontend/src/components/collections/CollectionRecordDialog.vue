<script setup lang="ts">
/**
 * Create / edit one record as a form — the Airtable "expand row" view.
 *
 * Inline cell editing in the table handles quick corrections; this is for
 * adding a row and for editing long text, where a table cell is the wrong
 * shape. Only the fields the user actually changed are sent, so two people
 * editing different columns of the same row do not overwrite each other.
 */
import type { CollectionField, CollectionRecord } from '@/utils/collections'
import { emptyRecordData } from '@/utils/collections'

const props = defineProps<{
  visible: boolean
  fields: CollectionField[]
  /** null = create a new record */
  record: CollectionRecord | null
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  save: [Record<string, unknown>]
}>()

const { t } = useI18n()

const form = ref<Record<string, unknown>>({})

const isEdit = computed(() => props.record !== null)

/** Reset the form whenever the dialog opens. */
watch(
  () => [props.visible, props.record?.id] as const,
  ([visible]) => {
    if (!visible) return
    form.value = props.record
      ? { ...emptyRecordData(props.fields), ...props.record.data }
      : emptyRecordData(props.fields)
  },
  { immediate: true },
)

function close() {
  emit('update:visible', false)
}

function submit() {
  emit('save', { ...form.value })
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
        />
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
        :loading="saving"
        :disabled="fields.length === 0"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
