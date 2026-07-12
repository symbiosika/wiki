<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 px-6">
    <div
      class="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-100 text-3xl dark:bg-surface-800"
    >
      📖
    </div>
    <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-0">
      {{ $t('Wiki.emptyState.title') }}
    </h1>
    <p class="max-w-sm text-center text-sm text-surface-500 dark:text-surface-400">
      {{ $t('Wiki.emptyState.subtitle') }}
    </p>
    <Button class="mt-2" @click="createFirstPage">
      {{ $t('Wiki.emptyState.createFirst') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
const wiki = useWiki()
const route = useRoute()
const router = useRouter()

const tenantId = computed(() => String(route.params.tenantId))

const createFirstPage = async () => {
  const page = await wiki.createPage(tenantId.value, { kind: 'personal' })
  router.push({
    name: 'WikiPage',
    params: { tenantId: tenantId.value, pageId: page.id },
  })
}
</script>
