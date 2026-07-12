<template>
  <div class="mb-6">
    <button
      v-if="backRouteName"
      type="button"
      class="mb-2 flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
      @click="goBack"
    >
      <IconArrowLeft class="h-4 w-4" />
      {{ backTitle }}
    </button>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1
        class="flex items-center text-2xl font-bold text-surface-900 dark:text-surface-0"
      >
        <slot name="header">{{ title }}</slot>
      </h1>
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconArrowLeft from '~icons/mdi/arrow-left'

const props = defineProps<{
  title?: string
  backTitle?: string
  backRouteName?: string
}>()

const route = useRoute()
const router = useRouter()

const goBack = () => {
  if (!props.backRouteName) return
  router.push({
    name: props.backRouteName,
    params: { tenantId: route.params.tenantId },
  })
}
</script>
