<template>
  <div
    class="mb-6 flex gap-1 border-b border-surface-200 dark:border-surface-700"
  >
    <button
      v-for="tab in tabs"
      :key="tab.routeName"
      type="button"
      class="border-b-2 px-4 py-2 text-sm font-medium transition-colors"
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
])

const isActive = (routeName: string) =>
  String(route.name ?? '').startsWith(routeName.replace(/s$/, ''))

const navigate = (routeName: string) => {
  router.push({ name: routeName, params: { tenantId: route.params.tenantId } })
}
</script>
