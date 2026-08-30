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
  /** mark the input as rejected — the form shows why underneath */
  invalid?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [unknown] }>()

/**
 * One computed per value SHAPE rather than a single `unknown` one cast at each
 * v-model site. `v-model="value as string"` compiles to
 * `(_unref(value) as string) = $event`, which is not a valid assignment target
 * — vue-tsc accepts it but the production build (rolldown) rejects it outright.
 * Typing the ref instead of the binding keeps both happy.
 */
const textValue = computed<string>({
  get: () => (props.modelValue == null ? '' : String(props.modelValue)),
  set: (v) => emit('update:modelValue', v),
})

const boolValue = computed<boolean>({
  get: () => props.modelValue === true,
  set: (v) => emit('update:modelValue', v),
})

/**
 * Select keeps null instead of '' so an empty value shows the placeholder
 * rather than an apparently-selected blank option.
 */
const selectValue = computed<string | null>({
  get: () => (props.modelValue == null || props.modelValue === '' ? null : String(props.modelValue)),
  set: (v) => emit('update:modelValue', v),
})

const listValue = computed<string[]>({
  get: () => (Array.isArray(props.modelValue) ? (props.modelValue as string[]) : []),
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
    v-model="boolValue"
    binary
    :autofocus="autofocus"
    :invalid="invalid"
  />

  <Textarea
    v-else-if="field.type === 'longText'"
    v-model="textValue"
    :rows="dense ? 2 : 4"
    :class="inputClass"
    :autofocus="autofocus"
    :invalid="invalid"
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
    :invalid="invalid"
  />

  <Select
    v-else-if="field.type === 'select'"
    v-model="selectValue"
    :options="choices"
    option-label="label"
    option-value="value"
    show-clear
    :class="inputClass"
    :autofocus="autofocus"
    :invalid="invalid"
  />

  <MultiSelect
    v-else-if="field.type === 'multiSelect'"
    v-model="listValue"
    :options="choices"
    option-label="label"
    option-value="value"
    display="chip"
    :class="inputClass"
    :autofocus="autofocus"
    :invalid="invalid"
  />

  <InputText
    v-else-if="field.type === 'number'"
    v-model="numberText"
    inputmode="decimal"
    :class="inputClass"
    :autofocus="autofocus"
    :invalid="invalid"
  />

  <InputText
    v-else
    v-model="textValue"
    :type="field.type === 'email' ? 'email' : 'text'"
    :class="inputClass"
    :autofocus="autofocus"
    :invalid="invalid"
  />
</template>
