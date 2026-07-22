<template>
  <div
    class="mb-6 flex gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-700"
  >
    <button
      v-for="tab in tabs"
      :key="tab.routeName"
      type="button"
      class="shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:py-2"
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
  { label: t('AiTests.tabTitle'), routeName: 'AiTests' },
])

// Match the tab's route family (e.g. "Tenants" also lights up on
// "TenantDetails"). Names without a trailing plural — like "ChatAgent" — are
// compared as-is, so unrelated routes can't accidentally activate a tab.
const isActive = (routeName: string) => {
  const prefix = routeName.replace(/s$/, '')
  return String(route.name ?? '').startsWith(prefix)
}

const navigate = (routeName: string) => {
  router.push({ name: routeName, params: { tenantId: route.params.tenantId } })
}
</script>
