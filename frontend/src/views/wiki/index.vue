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
    <div class="mt-2 flex flex-col items-center gap-2 sm:flex-row">
      <Button @click="createFirstPage">
        {{ $t('Wiki.emptyState.createFirst') }}
      </Button>
      <SecondaryButton
        :label="$t('Protocol.recordButton')"
        @click="protocol.openDialog()"
      >
        <template #icon><IconMicrophone class="h-4 w-4" /></template>
      </SecondaryButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconMicrophone from '~icons/mdi/microphone'

const wiki = useWiki()
const protocol = useProtocol()
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
