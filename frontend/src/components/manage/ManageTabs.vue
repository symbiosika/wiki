<template>
  <div
    class="mb-6 flex flex-wrap gap-x-1 gap-y-0.5 border-b border-surface-200 dark:border-surface-700"
  >
    <button
      v-for="tab in tabs"
      :key="tab.routeName"
      type="button"
      class="-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:py-2"
      :class="
        isActive(tab.routeName)
          ? 'border-primary text-primary'
          : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
      "
      @click="navigate(tab.routeName)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const tabs = computed(() => [
  { label: t('UserTenants.tabTitle'), routeName: 'Tenants' },
  { label: t('UserTeams.tabTitle'), routeName: 'Teams' },
  { label: t('Chat.config.tabTitle'), routeName: 'ChatAgent' },
  { label: t('UserTenants.metadata.tabTitle'), routeName: 'DocumentTags' },
  {
    label: t('PostProcessingAgents.tabTitle'),
    routeName: 'PostProcessingAgents',
  },
  { label: t('OAuthApps.tabTitle'), routeName: 'OAuthApps' },
  { label: t('Jobs.tabTitle'), routeName: 'Jobs' },
  { label: t('AiTests.tabTitle'), routeName: 'AiTests' },
])

// Route families that belong to a tab but don't share its name prefix, so the
// tab still lights up on nested detail routes (e.g. the URL-import job editor).
const extraActiveRoutes: Record<string, string[]> = {
  Jobs: ['UrlImportJob'],
}

// Match the tab's route family (e.g. "Tenants" also lights up on
// "TenantDetails"). Names without a trailing plural — like "ChatAgent" — are
// compared as-is, so unrelated routes can't accidentally activate a tab.
const isActive = (routeName: string) => {
  const current = String(route.name ?? '')
  const prefix = routeName.replace(/s$/, '')
  if (current.startsWith(prefix)) return true
  return (extraActiveRoutes[routeName] ?? []).includes(current)
}

const navigate = (routeName: string) => {
  router.push({ name: routeName, params: { tenantId: route.params.tenantId } })
}
</script>
