<template>
  <div class="flex h-dvh overflow-hidden bg-surface-0 dark:bg-surface-950">
    <template v-if="showSidebar">
      <!-- mobile backdrop -->
      <Transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-200"
        leave-to-class="opacity-0"
      >
        <div
          v-if="layout.sidebarOpen"
          class="fixed inset-0 z-30 bg-surface-950/50 backdrop-blur-[2px] lg:hidden"
          :aria-label="$t('Wiki.closeMenu')"
          @click="layout.closeSidebar()"
        />
      </Transition>

      <!-- off-canvas drawer on mobile, static column on desktop -->
      <WikiSidebar
        class="fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out"
        :class="[
          layout.sidebarOpen
            ? 'translate-x-0 shadow-2xl'
            : '-translate-x-full shadow-none',
          layout.sidebarCollapsed
            ? 'lg:hidden'
            : 'lg:static lg:z-auto lg:translate-x-0 lg:shadow-none',
        ]"
        :style="sidebarStyle"
      />

      <!--
        desktop: drag the sidebar wider than its minimum width. The 4px strip
        sits on top of the sidebar border and carries a wider invisible hit
        area; double-click snaps back to the default width.
      -->
      <div
        v-if="!layout.sidebarCollapsed"
        class="relative -ml-px hidden w-1 shrink-0 cursor-col-resize lg:block"
        :class="
          resizing
            ? 'bg-primary'
            : 'bg-transparent transition-colors hover:bg-primary/50'
        "
        role="separator"
        aria-orientation="vertical"
        :aria-label="$t('Wiki.resizeSidebar')"
        :aria-valuenow="layout.sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN_WIDTH"
        :aria-valuemax="SIDEBAR_MAX_WIDTH"
        tabindex="0"
        @pointerdown="startResize"
        @dblclick="layout.resetSidebarWidth()"
        @keydown.left.prevent="nudgeWidth(-16)"
        @keydown.right.prevent="nudgeWidth(16)"
      >
        <span class="absolute inset-y-0 -left-1 -right-1" />
      </div>
    </template>

    <div class="relative flex min-w-0 flex-1 flex-col">
      <!-- mobile top bar: menu + organisation -->
      <AppTopBar v-if="showSidebar" class="lg:hidden" />

      <!-- desktop: re-open a collapsed sidebar -->
      <button
        v-if="showSidebar && layout.sidebarCollapsed"
        type="button"
        :title="$t('Wiki.expandSidebar')"
        class="absolute top-3 left-3 z-20 hidden h-9 w-9 items-center justify-center rounded-lg border border-surface-200 bg-surface-0/90 text-surface-500 backdrop-blur transition-colors hover:bg-surface-100 hover:text-surface-700 lg:flex dark:border-surface-700 dark:bg-surface-900/90 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200"
        @click="layout.toggleCollapsed()"
      >
        <IconPanelLeft class="h-5 w-5" />
      </button>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>

    <!-- mounted once; opened from the sidebar or the wiki empty-state -->
    <ProtocolDialog
      v-if="showSidebar"
      v-model:visible="protocol.dialogOpen"
      :tenant-id="tenantId"
    />

    <!-- mounted once; opened from the sidebar import button -->
    <WikiImportDialog
      v-if="showSidebar"
      v-model:visible="wiki.state.importDialogOpen"
      :tenant-id="tenantId"
    />

    <!-- mounted once; opened from the "Chat with AI" button above the search -->
    <WikiAiChat v-if="showSidebar" />
  </div>
</template>

<script setup lang="ts">
import IconPanelLeft from '~icons/mdi/dock-left'
import ProtocolDialog from '@/components/protocol/ProtocolDialog.vue'
import WikiImportDialog from '@/components/wiki/WikiImportDialog.vue'
import WikiAiChat from '@/components/wiki/WikiAiChat.vue'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@/stores/layout'

const route = useRoute()
const protocol = useProtocol()
const wiki = useWiki()
const layout = useLayout()
const notifications = useNotificationsStore()

// the sidebar needs a tenant context; plain routes (redirect, 404) go without
const showSidebar = computed(() => Boolean(route.params.tenantId))
const tenantId = computed(() => String(route.params.tenantId ?? ''))

// the sidebar keeps its drawer width on mobile; only the static desktop column
// takes the dragged width
const isDesktop = ref(false)
let media: MediaQueryList | undefined
const syncDesktop = (e: MediaQueryListEvent | MediaQueryList) => {
  isDesktop.value = e.matches
}

const sidebarStyle = computed(() =>
  isDesktop.value && !layout.sidebarCollapsed
    ? { width: `${layout.sidebarWidth}px` }
    : undefined,
)

const resizing = ref(false)
let startX = 0
let startWidth = 0

const onResizeMove = (e: PointerEvent) =>
  layout.setSidebarWidth(startWidth + e.clientX - startX, false)

const stopResize = () => {
  if (!resizing.value) return
  resizing.value = false
  layout.persistSidebarWidth()
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

const startResize = (e: PointerEvent) => {
  if (e.button !== 0) return
  e.preventDefault()
  startX = e.clientX
  startWidth = layout.sidebarWidth
  resizing.value = true
  // keep the resize cursor and stop the tree from selecting text while dragging
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
}

const nudgeWidth = (delta: number) =>
  layout.setSidebarWidth(layout.sidebarWidth + delta)

// navigating (tapping a page in the tree, opening a search result, …)
// closes the mobile drawer
watch(
  () => route.fullPath,
  () => layout.closeSidebar(),
)

// Poll the user notification queue while the app is open, so job completions
// (e.g. finished imports) surface in the inbox and the sidebar chip.
onMounted(() => {
  notifications.startPolling()
  media = window.matchMedia('(min-width: 1024px)')
  syncDesktop(media)
  media.addEventListener('change', syncDesktop)
})

onUnmounted(() => {
  notifications.stopPolling()
  media?.removeEventListener('change', syncDesktop)
  stopResize()
})
</script>
