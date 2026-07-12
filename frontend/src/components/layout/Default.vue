<template>
  <div class="flex h-screen overflow-hidden bg-surface-0 dark:bg-surface-950">
    <WikiSidebar v-if="showSidebar" />
    <main class="min-w-0 flex-1 overflow-y-auto">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()

// the sidebar needs a tenant context; plain routes (redirect, 404) go without
const showSidebar = computed(() => Boolean(route.params.tenantId))
</script>
