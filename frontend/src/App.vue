<script setup lang="ts">
import { useApp } from '@/stores/main'
import { useTheme } from '@/stores/theme'
import { isTeamsHost, teamsState, watchTeamsTheme } from '@/utils/teamsSession'

const appStore = useApp()
const theme = useTheme()

theme.init()

/**
 * Inside a Teams tab the host's appearance wins over the stored preference —
 * and is deliberately not persisted, so it cannot overwrite what the same
 * person picked in their browser.
 */
if (isTeamsHost()) {
  void watchTeamsTheme((value) =>
    theme.setPreference(value, { persist: false }),
  )
}

/**
 * A Teams tab without a session must not mount the app: the session is
 * established before mounting, and anything short of `authenticated` means the
 * user has to act (enter an invitation code) or has hit a failure. Rendering the
 * views anyway would fire API calls that can only 401.
 */
const teamsNeedsAttention = computed(
  () => isTeamsHost() && teamsState.status !== 'authenticated',
)

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
  if (teamsNeedsAttention.value) return
  await appStore.init()
})

/**
 * When the invitation-code step succeeds, the app has a session but never ran
 * its startup — so it is initialised here, at the moment the gate clears.
 */
watch(teamsNeedsAttention, async (needsAttention) => {
  if (!needsAttention) await appStore.init()
})
</script>

<template>
  <Toast position="top-center" />
  <ConfirmDialog />
  <TeamsSessionGate v-if="teamsNeedsAttention" />
  <main
    v-else-if="!appStore.state.loading && appStore.state.initError"
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
