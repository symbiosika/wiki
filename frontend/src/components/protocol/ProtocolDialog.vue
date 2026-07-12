<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('Protocol.title')"
    class="w-[520px] max-w-[92vw]"
    @hide="reset"
  >
    <!-- Step: input -->
    <div v-if="step === 'input'" class="flex flex-col gap-4">
      <!-- mode toggle -->
      <div class="flex gap-2">
        <SecondaryButton
          size="small"
          :class="{ '!bg-primary !text-primary-contrast': mode === 'voice' }"
          :label="$t('Protocol.voice')"
          @click="mode = 'voice'"
        />
        <SecondaryButton
          size="small"
          :class="{ '!bg-primary !text-primary-contrast': mode === 'text' }"
          :label="$t('Protocol.text')"
          @click="mode = 'text'"
        />
      </div>

      <!-- voice -->
      <div v-if="mode === 'voice'" class="flex flex-col items-center gap-3 py-2">
        <ProtocolRecorder
          ref="recorderRef"
          :tenant-id="tenantId"
          :show-result="false"
          size="lg"
          @transcription-complete="onTranscribed"
          @error="onError"
        />
      </div>

      <!-- text -->
      <Textarea
        v-if="mode === 'text'"
        v-model="content"
        rows="5"
        class="w-full"
        :placeholder="$t('Protocol.textPlaceholder')"
      />

      <!-- transcript preview (voice) -->
      <Textarea
        v-if="mode === 'voice' && content"
        v-model="content"
        rows="4"
        class="w-full"
        :placeholder="$t('Protocol.textPlaceholder')"
      />

      <label class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
        <Checkbox v-model="applyToBrain" binary />
        {{ $t('Protocol.applyToBrain') }}
      </label>
    </div>

    <!-- Step: processing -->
    <div v-else-if="step === 'processing'" class="flex flex-col items-center gap-3 py-8">
      <ProgressSpinner class="h-10 w-10" />
      <span class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Protocol.processing') }}
      </span>
    </div>

    <!-- Step: done -->
    <div v-else-if="step === 'done' && result" class="flex flex-col gap-3 py-2">
      <div class="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
        <IconCheck class="h-6 w-6" />
        <span class="font-medium">{{ $t('Protocol.created') }}</span>
      </div>
      <p class="text-sm text-surface-700 dark:text-surface-200">
        {{ result.title }}
      </p>
      <Message v-if="brainResult" severity="secondary" class="text-sm">
        {{ $t('Protocol.brainApplied', { facts: brainResult.processedFacts }) }}
      </Message>
      <Message v-if="brainError" severity="warn" class="text-sm">
        {{ $t('Protocol.brainError') }}
      </Message>
    </div>

    <template #footer>
      <template v-if="step === 'input'">
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="visible = false"
        />
        <Button
          :label="$t('Protocol.submit')"
          size="small"
          :disabled="!content.trim()"
          @click="submit"
        />
      </template>
      <template v-else-if="step === 'done'">
        <SecondaryButton
          :label="$t('Common.close')"
          size="small"
          @click="visible = false"
        />
        <Button
          :label="$t('Protocol.openPage')"
          size="small"
          @click="openPage"
        />
      </template>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check-circle'
import { useProtocol } from '@/stores/protocol'
import type { CreatedProtocol, ProcessResult } from '@/stores/protocol'
import ProtocolRecorder from './ProtocolRecorder.vue'

const props = defineProps<{ tenantId: string }>()
const visible = defineModel<boolean>('visible', { required: true })

const { t } = useI18n()
const router = useRouter()
const toast = useToast()
const protocol = useProtocol()

type Step = 'input' | 'processing' | 'done'
const step = ref<Step>('input')
const mode = ref<'voice' | 'text'>('voice')
const content = ref('')
const applyToBrain = ref(true)
const result = ref<CreatedProtocol | null>(null)
const brainResult = ref<ProcessResult | null>(null)
const brainError = ref(false)

const recorderRef = ref<{ toggleRecording: () => void } | null>(null)

// One-tap: auto-start recording when the dialog opens in voice mode.
watch(visible, (open) => {
  if (open) {
    reset()
    nextTick(() => {
      setTimeout(() => {
        if (mode.value === 'voice') recorderRef.value?.toggleRecording()
      }, 300)
    })
  }
})

const onTranscribed = (text: string) => {
  content.value = text
}

const onError = (message: string) => {
  toast.add({ severity: 'error', summary: t('Common.error'), detail: message, life: 4000 })
}

const submit = async () => {
  const text = content.value.trim()
  if (!text) return
  step.value = 'processing'
  brainError.value = false
  brainResult.value = null
  try {
    result.value = await protocol.createProtocol(props.tenantId, text)
    if (applyToBrain.value) {
      try {
        brainResult.value = await protocol.processProtocol(props.tenantId, text)
      } catch {
        brainError.value = true
      }
    }
    step.value = 'done'
  } catch {
    step.value = 'input'
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Protocol.submitError'),
      life: 4000,
    })
  }
}

const openPage = () => {
  if (!result.value) return
  const pageId = result.value.entryId
  visible.value = false
  router.push({
    name: 'WikiPage',
    params: { tenantId: props.tenantId, pageId },
  })
}

const reset = () => {
  step.value = 'input'
  content.value = ''
  result.value = null
  brainResult.value = null
  brainError.value = false
}
</script>
