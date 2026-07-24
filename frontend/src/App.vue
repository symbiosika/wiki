<script setup lang="ts">
import { useApp } from '@/stores/main'
import { useTheme } from '@/stores/theme'

const appStore = useApp()
const theme = useTheme()

theme.init()

// Keep the browser/tab title in sync with the selected organisation, e.g.
// "Acme Wiki". Falls back to the generic title while no organisation is
// resolved yet (initial load, signed out).
const DEFAULT_TITLE = 'SYMBIOSIKA WIKI'
watch(
  () => appStore.currentTenant?.name,
  (name) => {
    document.title = name ? `${name} Wiki` : DEFAULT_TITLE
  },
  { immediate: true },
)

onMounted(async () => {
  await appStore.init()
})
</script>

<template>
  <Toast position="top-center" />
  <ConfirmDialog />
  <main
    v-if="!appStore.state.loading && appStore.state.initError"
    class="flex min-h-dvh items-center justify-center p-6"
  >
    <section class="max-w-md rounded-lg border border-red-200 p-6 text-center">
      <h1 class="mb-2 text-xl font-semibold">App could not be loaded</h1>
      <p class="text-sm text-surface-600">
        Please sign in again or try again later.
      </p>
      <a class="mt-4 inline-block underline" href="/login.html">Sign in</a>
    </section>
  </main>
  <RouterView v-else />
</template>
