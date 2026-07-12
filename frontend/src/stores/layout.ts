import { defineStore } from 'pinia'

const COLLAPSED_KEY = 'wiki:sidebar-collapsed'

/**
 * UI layout state: the wiki sidebar is an off-canvas drawer on mobile
 * (`sidebarOpen`) and collapsible on desktop (`sidebarCollapsed`).
 */
export const useLayout = defineStore('layout', () => {
  // mobile drawer (< lg) – closed by default, never persisted
  const sidebarOpen = ref(false)

  // desktop (>= lg) – persisted so the choice survives reloads
  const sidebarCollapsed = ref(
    typeof localStorage !== 'undefined' &&
      localStorage.getItem(COLLAPSED_KEY) === '1',
  )

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

  return {
    sidebarOpen,
    sidebarCollapsed,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    toggleCollapsed,
  }
})
