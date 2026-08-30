<script setup lang="ts">
/**
 * One input, picked by column type.
 *
 * Kept as its own component because the same mapping is needed in three places
 * (the record dialog, inline cell editing, and the filter row); duplicating the
 * `v-if` ladder three times is how those three drift apart.
 */
import type { CollectionField } from '@/utils/collections'

const props = defineProps<{
  field: CollectionField
  modelValue: unknown
  /** render compactly for use inside a table cell */
  dense?: boolean
  autofocus?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [unknown] }>()

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

/** DatePicker works with Date objects; the API stores "YYYY-MM-DD". */
const dateValue = computed({
  get: () => {
    const raw = props.modelValue
    if (!raw || typeof raw !== 'string') return null
    const parsed = new Date(`${raw}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  },
  set: (date: Date | null) => {
    if (!date) return emit('update:modelValue', null)
    // build the ISO day from local parts — toISOString() would shift the day
    // for anyone east or west of UTC, which silently moves birthdays around
    const pad = (n: number) => String(n).padStart(2, '0')
    emit(
      'update:modelValue',
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    )
  },
})

/**
 * Numbers are held as text while editing so a half-typed "-" or "1," does not
 * get coerced to NaN mid-keystroke; the API accepts a numeric string.
 */
const numberText = computed({
  get: () => (props.modelValue === null || props.modelValue === undefined ? '' : String(props.modelValue)),
  set: (text: string) => emit('update:modelValue', text.trim() === '' ? null : text.replace(',', '.')),
})

const choices = computed(() =>
  (props.field.options?.choices ?? []).map((c) => ({
    label: c.value,
    value: c.value,
  })),
)

const inputClass = computed(() => (props.dense ? 'w-full' : 'w-full'))
</script>

<template>
  <Checkbox
    v-if="field.type === 'checkbox'"
    v-model="value"
    binary
    :autofocus="autofocus"
  />

  <Textarea
    v-else-if="field.type === 'longText'"
    v-model="value as string"
    :rows="dense ? 2 : 4"
    :class="inputClass"
    :autofocus="autofocus"
    auto-resize
  />

  <DatePicker
    v-else-if="field.type === 'date'"
    v-model="dateValue"
    date-format="dd.mm.yy"
    show-icon
    icon-display="input"
    show-button-bar
    :class="inputClass"
    :autofocus="autofocus"
  />

  <Select
    v-else-if="field.type === 'select'"
    v-model="value as string"
    :options="choices"
    option-label="label"
    option-value="value"
    show-clear
    :class="inputClass"
    :autofocus="autofocus"
  />

  <MultiSelect
    v-else-if="field.type === 'multiSelect'"
    v-model="value as string[]"
    :options="choices"
    option-label="label"
    option-value="value"
    display="chip"
    :class="inputClass"
    :autofocus="autofocus"
  />

  <InputText
    v-else-if="field.type === 'number'"
    v-model="numberText"
    inputmode="decimal"
    :class="inputClass"
    :autofocus="autofocus"
  />

  <InputText
    v-else
    v-model="value as string"
    :type="field.type === 'email' ? 'email' : 'text'"
    :class="inputClass"
    :autofocus="autofocus"
  />
</template>
