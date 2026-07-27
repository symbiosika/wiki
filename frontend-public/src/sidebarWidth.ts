/**
 * Sidebar width, dragged and remembered.
 *
 * Documentation trees vary wildly — a flat handful of pages or deep nesting
 * with long titles — so a fixed width either wastes space or truncates
 * everything. The chosen width is stored per browser; it is a display
 * preference, not content.
 */
import { ref, readonly } from 'vue'

const STORAGE_KEY = 'wiki:docs:sidebarWidth'

export const MIN_WIDTH = 180
export const MAX_WIDTH = 520
export const DEFAULT_WIDTH = 256

const clamp = (value: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))

const width = ref(DEFAULT_WIDTH)
const dragging = ref(false)

export const sidebarWidth = readonly(width)
export const isDragging = readonly(dragging)

export const loadSidebarWidth = () => {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(stored) && stored > 0) width.value = clamp(stored)
  } catch {
    // private mode: keep the default rather than fail
  }
}

const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, String(width.value))
  } catch {
    // non-persistent is still better than not resizing at all
  }
}

export const setSidebarWidth = (value: number) => {
  width.value = clamp(value)
}

export const resetSidebarWidth = () => {
  width.value = DEFAULT_WIDTH
  persist()
}

/**
 * Begin a drag from a pointer event on the handle.
 *
 * Uses pointer capture so the drag survives the cursor leaving the handle —
 * without it a quick movement drops the drag halfway. Returns nothing; the
 * listeners remove themselves when the pointer is released.
 */
export const startSidebarDrag = (event: PointerEvent, startWidth: number) => {
  const startX = event.clientX
  const target = event.currentTarget as HTMLElement | null
  target?.setPointerCapture?.(event.pointerId)
  dragging.value = true

  const onMove = (move: PointerEvent) => {
    setSidebarWidth(startWidth + (move.clientX - startX))
  }

  const onUp = () => {
    dragging.value = false
    persist()
    target?.releasePointerCapture?.(event.pointerId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

/** Keyboard resizing, so the handle is not mouse-only. */
export const nudgeSidebarWidth = (delta: number) => {
  setSidebarWidth(width.value + delta)
  persist()
}
