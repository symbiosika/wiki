import { defineStore } from 'pinia'

const COLLAPSED_KEY = 'wiki:sidebar-collapsed'
const WIDTH_KEY = 'wiki:sidebar-width'

/** default desktop width – matches the `lg:w-72` class on the sidebar */
export const SIDEBAR_MIN_WIDTH = 288
export const SIDEBAR_MAX_WIDTH = 640

const clampWidth = (px: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)))

const readStoredWidth = () => {
  if (typeof localStorage === 'undefined') return SIDEBAR_MIN_WIDTH
  const stored = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(stored) && stored > 0
    ? clampWidth(stored)
    : SIDEBAR_MIN_WIDTH
}

/**
 * UI layout state: the wiki sidebar is an off-canvas drawer on mobile
 * (`sidebarOpen`) and collapsible on desktop (`sidebarCollapsed`), where it can
 * also be dragged wider than its minimum width (`sidebarWidth`).
 */
export const useLayout = defineStore('layout', () => {
  // mobile drawer (< lg) – closed by default, never persisted
  const sidebarOpen = ref(false)

  // desktop (>= lg) – persisted so the choice survives reloads
  const sidebarCollapsed = ref(
    typeof localStorage !== 'undefined' &&
      localStorage.getItem(COLLAPSED_KEY) === '1',
  )

  // desktop (>= lg) – dragged with the handle next to the sidebar, persisted
  const sidebarWidth = ref(readStoredWidth())

  const openSidebar = () => {
    sidebarOpen.value = true
  }

  const closeSidebar = () => {
    sidebarOpen.value = false
  }

  const toggleSidebar = () => {
    sidebarOpen.value = !sidebarOpen.value
  }

  const toggleCollapsed = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
    localStorage.setItem(COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0')
  }

  /**
   * `persist: false` is for the live drag – the pointer moves far too often to
   * hit localStorage on every frame, so the final width is written once when
   * the drag ends.
   */
  const setSidebarWidth = (px: number, persist = true) => {
    sidebarWidth.value = clampWidth(px)
    if (persist) localStorage.setItem(WIDTH_KEY, String(sidebarWidth.value))
  }

  const persistSidebarWidth = () => {
    localStorage.setItem(WIDTH_KEY, String(sidebarWidth.value))
  }

  const resetSidebarWidth = () => setSidebarWidth(SIDEBAR_MIN_WIDTH)

  return {
    sidebarOpen,
    sidebarCollapsed,
    sidebarWidth,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    toggleCollapsed,
    setSidebarWidth,
    persistSidebarWidth,
    resetSidebarWidth,
  }
})
