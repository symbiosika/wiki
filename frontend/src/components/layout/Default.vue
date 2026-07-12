<template>
  <div class="flex h-screen overflow-hidden bg-surface-0 dark:bg-surface-950">
    <WikiSidebar v-if="showSidebar" />
    <main class="min-w-0 flex-1 overflow-y-auto">
      <RouterView />
    </main>

    <!-- mounted once; opened from the sidebar or the wiki empty-state -->
    <ProtocolDialog
      v-if="showSidebar"
      v-model:visible="protocol.dialogOpen"
      :tenant-id="tenantId"
    />
  </div>
</template>

<script setup lang="ts">
import ProtocolDialog from '@/components/protocol/ProtocolDialog.vue'

const route = useRoute()
const protocol = useProtocol()

// the sidebar needs a tenant context; plain routes (redirect, 404) go without
const showSidebar = computed(() => Boolean(route.params.tenantId))
const tenantId = computed(() => String(route.params.tenantId ?? ''))
</script>
