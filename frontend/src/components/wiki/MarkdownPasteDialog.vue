<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('Editor.markdown.title')"
    class="w-[640px] max-w-[92vw]"
    @hide="reset"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Editor.markdown.hint') }}
      </p>

      <Textarea
        ref="textareaRef"
        v-model="source"
        rows="10"
        autoResize
        class="w-full font-mono text-sm"
        :placeholder="$t('Editor.markdown.placeholder')"
      />

      <!-- live preview so the user sees what will be inserted -->
      <div v-if="source.trim()" class="flex flex-col gap-1">
        <span
          class="text-xs font-medium text-surface-500 dark:text-surface-400"
        >
          {{ $t('Editor.markdown.preview') }}
        </span>
        <div
          class="max-h-52 overflow-y-auto rounded-md border border-surface-200 bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-900"
        >
          <MarkdownRenderer :content="source" />
        </div>
      </div>
    </div>

    <template #footer>
      <SecondaryButton
        :label="$t('Common.cancel')"
        size="small"
        @click="visible = false"
      />
      <Button
        :label="$t('Editor.markdown.insert')"
        size="small"
        :disabled="!source.trim()"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'

const visible = defineModel<boolean>('visible', { required: true })

const emit = defineEmits<{
  /** emitted with the raw markdown when the user confirms */
  insert: [markdown: string]
}>()

const source = ref('')
const textareaRef = ref<{ $el?: HTMLElement } | null>(null)

const submit = () => {
  const value = source.value.trim()
  if (!value) return
  emit('insert', value)
  visible.value = false
}

const reset = () => {
  source.value = ''
}

// focus the textarea when the dialog opens so the user can paste right away
watch(visible, async (open) => {
  if (!open) return
  reset()
  await nextTick()
  const root = textareaRef.value?.$el
  const field =
    root instanceof HTMLTextAreaElement
      ? root
      : (root?.querySelector('textarea') ?? null)
  field?.focus()
})
</script>
