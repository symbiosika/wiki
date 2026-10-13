<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('Editor.download.renameTitle')"
    class="w-[480px] max-w-[92vw]"
  >
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ $t('Editor.download.title') }}</span>
        <InputText
          ref="titleRef"
          v-model="title"
          class="w-full"
          :placeholder="fileName"
        />
        <small class="text-surface-500 dark:text-surface-400">
          {{ $t('Editor.download.titleHint', { name: fileName }) }}
        </small>
      </label>
      <div class="flex justify-end gap-2">
        <SecondaryButton
          :label="$t('Common.cancel')"
          @click="visible = false"
        />
        <Button type="submit" :label="$t('Common.save')" />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
const visible = defineModel<boolean>('visible', { required: true })

const props = defineProps<{
  /** the file's own name — the default display name */
  fileName: string
  /** the current display name; empty = file name */
  initialTitle: string
}>()

const emit = defineEmits<{
  /** the new display name; empty resets it to the file name */
  save: [title: string]
}>()

const title = ref('')
const titleRef = ref<{ $el?: HTMLElement } | null>(null)

const submit = () => {
  const value = title.value.trim()
  emit('save', value === props.fileName ? '' : value)
  visible.value = false
}

watch(visible, async (open) => {
  if (!open) return
  title.value = props.initialTitle || props.fileName
  await nextTick()
  const root = titleRef.value?.$el
  const field =
    root instanceof HTMLInputElement
      ? root
      : (root?.querySelector('input') ?? null)
  field?.focus()
  field?.select()
})
</script>
