<template>
  <header
    class="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-2 border-b border-surface-200 bg-surface-0/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-surface-800 dark:bg-surface-950/90"
  >
    <!-- menu -->
    <button
      type="button"
      :aria-label="$t('Wiki.openMenu')"
      class="flex h-12 w-12 items-center justify-center rounded-lg text-surface-600 transition-colors active:bg-surface-100 dark:text-surface-300 dark:active:bg-surface-800"
      @click="layout.openSidebar()"
    >
      <IconMenu class="h-6 w-6" />
    </button>

    <!-- organisation (top right) → start page -->
    <button
      type="button"
      :title="$t('Wiki.goHome')"
      class="flex h-12 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors active:bg-surface-100 dark:active:bg-surface-800"
      @click="goHome"
    >
      <span
        class="min-w-0 truncate text-sm font-semibold text-surface-900 dark:text-surface-0"
      >
        {{ app.currentTenant?.name ?? $t('Wiki.appName') }}
      </span>
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-contrast"
      >
        {{ tenantInitial }}
      </span>
    </button>
  </header>
</template>

<script setup lang="ts">
import IconMenu from '~icons/mdi/menu'

const app = useApp()
const layout = useLayout()
const route = useRoute()
const router = useRouter()

const tenantInitial = computed(
  () => app.currentTenant?.name?.trim()?.[0]?.toUpperCase() ?? 'W',
)

const goHome = () => {
  const tenantId = String(route.params.tenantId ?? app.state.selectedTenant)
  if (!tenantId) return
  router.push({ name: 'Wiki', params: { tenantId } })
}
</script>
