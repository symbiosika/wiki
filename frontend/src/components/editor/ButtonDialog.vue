<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="
      editing ? $t('Editor.button.editTitle') : $t('Editor.button.insertTitle')
    "
    class="w-[520px] max-w-[92vw]"
  >
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ $t('Editor.button.text') }}</span>
        <InputText
          ref="textRef"
          v-model="text"
          class="w-full"
          :placeholder="$t('Editor.button.textPlaceholder')"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ $t('Editor.button.url') }}</span>
        <InputText
          v-model="href"
          class="w-full"
          inputmode="url"
          :invalid="showUrlError"
          :placeholder="$t('Editor.button.urlPlaceholder')"
          @blur="touched = true"
        />
        <small v-if="showUrlError" class="text-red-600 dark:text-red-400">
          {{ $t('Editor.button.invalidUrl') }}
        </small>
      </label>

      <div class="flex flex-wrap gap-4">
        <div class="flex flex-col gap-1">
          <span class="text-sm font-medium">{{ $t('Editor.button.style') }}</span>
          <SelectButton
            v-model="variant"
            :options="variantOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm font-medium">{{ $t('Editor.button.align') }}</span>
          <SelectButton
            v-model="align"
            :options="alignOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
        </div>
      </div>

      <!-- live preview, styled by the editor stylesheet like the real block -->
      <div class="wiki-editor">
        <div
          class="rounded-md border border-dashed border-surface-200 p-3 dark:border-surface-700"
        >
          <div
            data-type="wiki-button"
            :data-variant="variant"
            :data-align="align === 'left' ? undefined : align"
          >
            <a href="#" @click.prevent>{{
              text.trim() || $t('Editor.button.textPlaceholder')
            }}</a>
          </div>
        </div>
      </div>
      <button type="submit" class="hidden" />
    </form>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <SecondaryButton
          v-if="editing"
          :label="$t('Editor.button.remove')"
          size="small"
          @click="remove"
        />
        <span class="flex-1" />
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="visible = false"
        />
        <Button
          :label="editing ? $t('Editor.button.save') : $t('Editor.button.insert')"
          size="small"
          :disabled="!canSubmit"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  BUTTON_ALIGNS,
  BUTTON_VARIANTS,
  normalizeButtonHref,
  type ButtonAlign,
  type ButtonVariant,
  type WikiButtonAttrs,
} from './wikiButton'

const visible = defineModel<boolean>('visible', { required: true })

const props = defineProps<{
  /** the button being edited; null inserts a new one */
  initial: WikiButtonAttrs | null
}>()

const emit = defineEmits<{
  save: [attrs: WikiButtonAttrs]
  remove: []
}>()

const { t } = useI18n()

const text = ref('')
const href = ref('')
const variant = ref<ButtonVariant>('primary')
const align = ref<ButtonAlign>('left')
const touched = ref(false)
const textRef = ref<{ $el?: HTMLElement } | null>(null)

const editing = computed(() => props.initial !== null)

const variantOptions = computed(() =>
  BUTTON_VARIANTS.map((value) => ({
    value,
    label: t(`Editor.button.styles.${value}`),
  })),
)
const alignOptions = computed(() =>
  BUTTON_ALIGNS.map((value) => ({
    value,
    label: t(
      `Editor.image.align${value.charAt(0).toUpperCase()}${value.slice(1)}`,
    ),
  })),
)

const normalizedHref = computed(() => normalizeButtonHref(href.value))
const showUrlError = computed(
  () => touched.value && href.value.trim() !== '' && !normalizedHref.value,
)
const canSubmit = computed(
  () => text.value.trim() !== '' && normalizedHref.value !== null,
)

const submit = () => {
  touched.value = true
  if (!canSubmit.value) return
  emit('save', {
    text: text.value.trim(),
    href: normalizedHref.value!,
    variant: variant.value,
    align: align.value,
  })
  visible.value = false
}

const remove = () => {
  emit('remove')
  visible.value = false
}

watch(visible, async (open) => {
  if (!open) return
  text.value = props.initial?.text ?? ''
  href.value = props.initial?.href ?? ''
  variant.value = props.initial?.variant ?? 'primary'
  align.value = props.initial?.align ?? 'left'
  touched.value = false
  await nextTick()
  const root = textRef.value?.$el
  const field =
    root instanceof HTMLInputElement
      ? root
      : (root?.querySelector('input') ?? null)
  field?.focus()
})
</script>
