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
      />
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
  </div>
</template>

<script setup lang="ts">
import IconPanelLeft from '~icons/mdi/dock-left'
import ProtocolDialog from '@/components/protocol/ProtocolDialog.vue'
import WikiImportDialog from '@/components/wiki/WikiImportDialog.vue'

const route = useRoute()
const protocol = useProtocol()
const wiki = useWiki()
const layout = useLayout()
const notifications = useNotificationsStore()

// the sidebar needs a tenant context; plain routes (redirect, 404) go without
const showSidebar = computed(() => Boolean(route.params.tenantId))
const tenantId = computed(() => String(route.params.tenantId ?? ''))

// navigating (tapping a page in the tree, opening a search result, …)
// closes the mobile drawer
watch(
  () => route.fullPath,
  () => layout.closeSidebar(),
)

// Poll the user notification queue while the app is open, so job completions
// (e.g. finished imports) surface in the inbox and the sidebar chip.
onMounted(() => notifications.startPolling())
onUnmounted(() => notifications.stopPolling())
</script>
