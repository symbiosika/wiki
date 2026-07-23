<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="title ?? $t('ImageCropper.title')"
    class="w-[420px] max-w-[94vw]"
    @hide="onHide"
  >
    <div class="flex flex-col items-center gap-4">
      <p class="self-start text-sm text-surface-500 dark:text-surface-400">
        {{ $t('ImageCropper.hint') }}
      </p>

      <!--
        The stage shows the whole image faded; the crop frame punches a bright
        "hole" through a translucent mask (a big spread box-shadow), so whatever
        falls outside the crop is dimmed/see-through. Drag to pan, use the
        slider (or wheel) to zoom.
      -->
      <div
        ref="stageRef"
        class="relative touch-none overflow-hidden rounded-lg bg-surface-100 select-none dark:bg-surface-800"
        :style="{ width: `${stageW}px`, height: `${stageH}px` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
      >
        <img
          v-if="objectUrl"
          ref="imgRef"
          :src="objectUrl"
          alt=""
          draggable="false"
          class="pointer-events-none absolute max-w-none origin-top-left"
          :style="{
            left: `${tx}px`,
            top: `${ty}px`,
            width: `${imgW}px`,
            height: `${imgH}px`,
          }"
          @load="onImageLoad"
        />

        <!-- crop frame + surrounding mask -->
        <div
          class="pointer-events-none absolute box-border border-2 border-white/90"
          :class="round ? 'rounded-full' : 'rounded-sm'"
          :style="{
            left: `${frameLeft}px`,
            top: `${frameTop}px`,
            width: `${frameW}px`,
            height: `${frameH}px`,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }"
        />
      </div>

      <!-- zoom -->
      <div class="flex w-full items-center gap-3">
        <IconMinus class="h-4 w-4 shrink-0 text-surface-400" />
        <input
          v-model.number="zoom"
          type="range"
          min="1"
          max="4"
          step="0.01"
          class="h-1 w-full cursor-pointer accent-primary"
          @input="onZoomInput"
        />
        <IconPlus class="h-4 w-4 shrink-0 text-surface-400" />
      </div>
    </div>

    <template #footer>
      <SecondaryButton
        :label="$t('Common.cancel')"
        size="small"
        :disabled="working"
        @click="isVisible = false"
      />
      <Button
        :label="$t('ImageCropper.apply')"
        size="small"
        :loading="working"
        :disabled="!ready"
        @click="apply"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import IconPlus from '~icons/mdi/plus'
import IconMinus from '~icons/mdi/minus'

const props = withDefaults(
  defineProps<{
    visible: boolean
    file: File | null
    /** crop aspect ratio as width / height (e.g. 1 = square, 3 = wide banner) */
    aspectRatio?: number
    /** cap on the longer edge of the exported image, in pixels */
    maxOutput?: number
    /** round crop mask (visual only — output is still a rectangle) */
    round?: boolean
    title?: string
  }>(),
  {
    aspectRatio: 1,
    maxOutput: 512,
    round: false,
    title: undefined,
  },
)

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'cropped', file: File): void
}>()

const isVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})

// ----- stage / frame geometry ----------------------------------------------

// The crop frame is fit into a fixed box; the stage adds a margin around it so
// the panned-away parts of the image stay visible (dimmed) instead of clipped.
const MAX_FRAME = 300
const MARGIN = 44

const frameW = computed(() => {
  const a = props.aspectRatio || 1
  return a >= 1 ? MAX_FRAME : Math.round(MAX_FRAME * a)
})
const frameH = computed(() => {
  const a = props.aspectRatio || 1
  return a >= 1 ? Math.round(MAX_FRAME / a) : MAX_FRAME
})
const stageW = computed(() => frameW.value + MARGIN * 2)
const stageH = computed(() => frameH.value + MARGIN * 2)
const frameLeft = computed(() => (stageW.value - frameW.value) / 2)
const frameTop = computed(() => (stageH.value - frameH.value) / 2)

// ----- image state ----------------------------------------------------------

const imgRef = ref<HTMLImageElement | null>(null)
const objectUrl = ref<string | null>(null)
const naturalW = ref(0)
const naturalH = ref(0)
const scale = ref(1) // px per natural px
const minScale = ref(1)
const zoom = ref(1) // slider: multiple of minScale (1..4)
const tx = ref(0)
const ty = ref(0)
const ready = ref(false)
const working = ref(false)

const imgW = computed(() => naturalW.value * scale.value)
const imgH = computed(() => naturalH.value * scale.value)

const revokeUrl = () => {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = null
  }
}

const loadFile = (file: File | null) => {
  revokeUrl()
  ready.value = false
  naturalW.value = 0
  naturalH.value = 0
  if (file) objectUrl.value = URL.createObjectURL(file)
}

watch(
  () => props.file,
  (file) => {
    if (props.visible) loadFile(file)
  },
)

watch(
  () => props.visible,
  (open) => {
    if (open) loadFile(props.file)
    else revokeUrl()
  },
)

const onImageLoad = (event: Event) => {
  const img = event.target as HTMLImageElement
  naturalW.value = img.naturalWidth
  naturalH.value = img.naturalHeight
  // smallest scale that still fully covers the frame
  minScale.value = Math.max(
    frameW.value / naturalW.value,
    frameH.value / naturalH.value,
  )
  scale.value = minScale.value
  zoom.value = 1
  // centre the image in the frame
  tx.value = frameLeft.value + (frameW.value - imgW.value) / 2
  ty.value = frameTop.value + (frameH.value - imgH.value) / 2
  ready.value = true
}

/** Keep the image covering the frame at all times (no empty gaps). */
const clamp = () => {
  const txMax = frameLeft.value
  const txMin = frameLeft.value + frameW.value - imgW.value
  const tyMax = frameTop.value
  const tyMin = frameTop.value + frameH.value - imgH.value
  tx.value = Math.min(txMax, Math.max(txMin, tx.value))
  ty.value = Math.min(tyMax, Math.max(tyMin, ty.value))
}

// ----- zoom ------------------------------------------------------------------

const applyZoom = () => {
  if (!naturalW.value) return
  // keep the frame centre anchored while zooming
  const cx = frameLeft.value + frameW.value / 2
  const cy = frameTop.value + frameH.value / 2
  const imgCx = (cx - tx.value) / scale.value
  const imgCy = (cy - ty.value) / scale.value
  scale.value = minScale.value * zoom.value
  tx.value = cx - imgCx * scale.value
  ty.value = cy - imgCy * scale.value
  clamp()
}

const onZoomInput = () => applyZoom()

const onWheel = (event: WheelEvent) => {
  if (!ready.value) return
  const next = zoom.value * (event.deltaY < 0 ? 1.08 : 1 / 1.08)
  zoom.value = Math.min(4, Math.max(1, next))
  applyZoom()
}

// ----- panning ---------------------------------------------------------------

const dragging = ref(false)
let startX = 0
let startY = 0
let startTx = 0
let startTy = 0

const onPointerDown = (event: PointerEvent) => {
  if (!ready.value) return
  dragging.value = true
  startX = event.clientX
  startY = event.clientY
  startTx = tx.value
  startTy = ty.value
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (!dragging.value) return
  tx.value = startTx + (event.clientX - startX)
  ty.value = startTy + (event.clientY - startY)
  clamp()
}

const onPointerUp = (event: PointerEvent) => {
  if (!dragging.value) return
  dragging.value = false
  try {
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  } catch {
    /* pointer may already be released */
  }
}

// ----- export ----------------------------------------------------------------

const apply = async () => {
  const img = imgRef.value
  if (!ready.value || !img || working.value) return
  working.value = true
  try {
    // crop region in natural (source) pixels
    const srcX = (frameLeft.value - tx.value) / scale.value
    const srcY = (frameTop.value - ty.value) / scale.value
    const srcW = frameW.value / scale.value
    const srcH = frameH.value / scale.value

    // output size preserves the crop aspect, capped at maxOutput on the long edge
    const aspect = frameW.value / frameH.value
    let outW: number
    let outH: number
    if (aspect >= 1) {
      outW = Math.min(props.maxOutput, Math.round(srcW))
      outH = Math.round(outW / aspect)
    } else {
      outH = Math.min(props.maxOutput, Math.round(srcH))
      outW = Math.round(outH * aspect)
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, outW)
    canvas.height = Math.max(1, outH)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      img,
      srcX,
      srcY,
      srcW,
      srcH,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    // PNG keeps any source transparency (logos) intact
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('toBlob failed')

    const base = (props.file?.name ?? 'image').replace(/\.[^.]+$/, '')
    const file = new File([blob], `${base}.png`, { type: 'image/png' })
    emit('cropped', file)
    isVisible.value = false
  } finally {
    working.value = false
  }
}

const onHide = () => {
  revokeUrl()
  ready.value = false
}

onUnmounted(revokeUrl)
</script>
