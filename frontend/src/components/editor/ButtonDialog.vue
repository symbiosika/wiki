<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="
      editing ? $t('Editor.button.editTitle') : $t('Editor.button.insertTitle')
    "
    class="w-[640px] max-w-[92vw]"
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

      <!-- optional preview image: turns the button into a link card -->
      <div v-if="uploadImage" class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ $t('Editor.button.image') }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <SecondaryButton
            :label="
              image ? $t('Editor.button.imageReplace') : $t('Editor.button.imageAdd')
            "
            size="small"
            :loading="uploading"
            @click="imageInputRef?.click()"
          />
          <SecondaryButton
            v-if="image"
            :label="$t('Editor.button.imageRemove')"
            size="small"
            @click="image = null"
          />
        </div>
        <small class="text-surface-500 dark:text-surface-400">
          {{ $t('Editor.button.imageHint') }}
        </small>
        <small v-if="uploadFailed" class="text-red-600 dark:text-red-400">
          {{ $t('Editor.imageUploadError') }}
        </small>
        <input
          ref="imageInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onImagePicked"
        />
      </div>

      <!-- live preview, styled by the editor stylesheet like the real block -->
      <div class="wiki-editor">
        <div
          class="rounded-md border border-dashed border-surface-200 p-3 dark:border-surface-700"
        >
          <div v-if="image" ref="cardPreviewRef" class="pointer-events-none" />
          <div
            v-else
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
import { computed, nextTick, ref, watch, watchEffect } from 'vue'
import {
  BUTTON_ALIGNS,
  BUTTON_VARIANTS,
  buildButtonCard,
  normalizeButtonHref,
  type ButtonAlign,
  type ButtonVariant,
  type WikiButtonAttrs,
} from './wikiButton'

const visible = defineModel<boolean>('visible', { required: true })

const props = defineProps<{
  /** the button being edited; null inserts a new one */
  initial: WikiButtonAttrs | null
  /** uploads a preview image and returns its path; absent = no image option */
  uploadImage?: (file: File) => Promise<string>
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
const image = ref<string | null>(null)
const uploading = ref(false)
const uploadFailed = ref(false)
const imageInputRef = ref<HTMLInputElement | null>(null)
const cardPreviewRef = ref<HTMLElement | null>(null)

const onImagePicked = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.uploadImage) return
  uploading.value = true
  uploadFailed.value = false
  try {
    image.value = await props.uploadImage(file)
  } catch {
    uploadFailed.value = true
  } finally {
    uploading.value = false
  }
}

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
    image: image.value,
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
  image.value = props.initial?.image ?? null
  uploadFailed.value = false
  touched.value = false
  await nextTick()
  const root = textRef.value?.$el
  const field =
    root instanceof HTMLInputElement
      ? root
      : (root?.querySelector('input') ?? null)
  field?.focus()
})

/** The card preview is the real card, built by the same code as the block. */
watchEffect(() => {
  const host = cardPreviewRef.value
  if (!host || !image.value) return
  host.replaceChildren(
    buildButtonCard(
      {
        text: text.value.trim() || t('Editor.button.textPlaceholder'),
        href: normalizedHref.value ?? href.value,
        variant: variant.value,
        align: align.value,
        image: image.value,
      },
      {
        open: t('Editor.button.open'),
        copy: t('Editor.button.copyUrl'),
        copied: t('Editor.button.copied'),
      },
    ),
  )
})
</script>
