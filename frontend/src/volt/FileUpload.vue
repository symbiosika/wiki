<template>
  <div class="file-upload-wrapper">
    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      type="file"
      :accept="accept"
      :multiple="multiple"
      class="hidden"
      @change="handleFileSelect"
    />

    <!-- Drop zone -->
    <div
      :class="[
        'flex flex-col items-center justify-center rounded-md border-2 border-dashed p-8 transition-colors duration-200',
        'border-gray-300 dark:border-stone-600',
        'hover:border-gray-400 dark:hover:border-stone-500',
        isDragging && 'border-primary bg-primary/5 dark:border-primary dark:bg-primary/10',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      ]"
      @drop.prevent="handleDrop"
      @dragover.prevent="handleDragOver"
      @dragenter.prevent="handleDragEnter"
      @dragleave.prevent="handleDragLeave"
      @click.stop="handleClick"
    >
      <slot name="empty">
        <div class="flex flex-col items-center justify-center">
          <FluentCloudUpload class="mb-4 text-4xl text-gray-400 dark:text-gray-500" />
          <p class="text-gray-600 dark:text-gray-400 font-medium">
            {{ $t('FileUpload.dropFiles') }}
          </p>
          <p v-if="!auto" class="mt-2 text-sm text-gray-500 dark:text-gray-500">
            {{ $t('FileUpload.clickToSelect') }}
          </p>
        </div>
      </slot>
    </div>

    <!-- File list (if customUpload is false) -->
    <div v-if="!customUpload && files.length > 0" class="mt-4 space-y-2">
      <div
        v-for="(file, index) in files"
        :key="index"
        class="flex items-center justify-between rounded border bg-gray-50 p-2 dark:border-stone-700 dark:bg-white/5"
      >
        <span class="text-sm flex-1 truncate">{{ file.name }}</span>
        <Button
          v-if="showCancelButton"
          text
          rounded
          severity="danger"
          @click="removeFile(index)"
          class="ml-2 flex-shrink-0"
        >
          <FluentDelete class="size-4" />
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import FluentCloudUpload from '~icons/mdi/cloud-upload'
import FluentDelete from '~icons/mdi/delete'
import Button from './Button.vue'

interface Props {
  accept?: string
  multiple?: boolean
  disabled?: boolean
  auto?: boolean
  customUpload?: boolean
  showCancelButton?: boolean
  maxFileSize?: number
}

const props = withDefaults(defineProps<Props>(), {
  accept: '*/*',
  multiple: false,
  disabled: false,
  auto: false,
  customUpload: false,
  showCancelButton: true,
  maxFileSize: undefined,
})

export interface FileUploadUploaderEvent {
  files: File | File[]
}

const emit = defineEmits<{
  uploader: [event: FileUploadUploaderEvent]
  select: [files: File[]]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const files = ref<File[]>([])
const isDragging = ref(false)

const handleClick = () => {
  if (props.disabled) return
  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files) {
    processFiles(Array.from(target.files))
  }
}

const handleDrop = (event: DragEvent) => {
  if (props.disabled) return
  
  isDragging.value = false
  
  if (event.dataTransfer?.files) {
    processFiles(Array.from(event.dataTransfer.files))
  }
}

const handleDragOver = (event: DragEvent) => {
  if (props.disabled) return
  event.preventDefault()
  isDragging.value = true
}

const handleDragEnter = (event: DragEvent) => {
  if (props.disabled) return
  event.preventDefault()
  isDragging.value = true
}

const handleDragLeave = (event: DragEvent) => {
  if (props.disabled) return
  // Only set dragging to false if we're leaving the dropzone itself
  const target = event.target as HTMLElement
  if (!target.closest('.file-upload-dropzone')) {
    isDragging.value = false
  }
}

const processFiles = (newFiles: File[]) => {
  let validFiles = newFiles

  // Filter by accept type if specified
  if (props.accept && props.accept !== '*/*') {
    const acceptTypes = props.accept.split(',').map(type => type.trim())
    validFiles = newFiles.filter(file => {
      return acceptTypes.some(acceptType => {
        if (acceptType.startsWith('.')) {
          // File extension match
          return file.name.toLowerCase().endsWith(acceptType.toLowerCase())
        } else if (acceptType.includes('/*')) {
          // MIME type wildcard match (e.g., "image/*")
          const baseType = acceptType.split('/')[0]
          return file.type.startsWith(baseType + '/')
        } else {
          // Exact MIME type match
          return file.type === acceptType
        }
      })
    })
  }

  // Filter by max file size if specified
  const maxFileSize = props.maxFileSize
  if (maxFileSize !== undefined) {
    validFiles = validFiles.filter(file => file.size <= maxFileSize)
  }

  if (props.multiple) {
    files.value = [...files.value, ...validFiles]
  } else {
    files.value = validFiles.slice(0, 1)
  }

  // Emit events
  if (props.customUpload) {
    // Emit with File | File[] format for compatibility
    const filesToEmit = props.multiple ? files.value : (files.value[0] || files.value)
    emit('uploader', { files: filesToEmit })
    // Clear files after emitting in customUpload mode
    files.value = []
  } else {
    emit('select', files.value)
  }

  // Auto upload if enabled
  if (props.auto && files.value.length > 0) {
    const filesToEmit = props.multiple ? files.value : (files.value[0] || files.value)
    emit('uploader', { files: filesToEmit })
    files.value = []
  }

  // Reset input
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const removeFile = (index: number) => {
  files.value.splice(index, 1)
}

// Method to open file dialog (always works, regardless of auto flag)
const choose = () => {
  if (props.disabled) return
  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

// Expose methods for parent component
defineExpose({
  clear: () => {
    files.value = []
    if (fileInputRef.value) {
      fileInputRef.value.value = ''
    }
  },
  choose,
})
</script>

<style scoped>
.file-upload-wrapper {
  width: 100%;
}
</style>

