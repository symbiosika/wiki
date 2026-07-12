<template>
  <div class="flex h-full items-center justify-center">
    <ProgressSpinner class="h-10 w-10" />
  </div>
</template>

<script setup lang="ts">
/**
 * Entry view: waits for the app to initialise, then forwards to the
 * wiki of the user's active organisation.
 */
const app = useApp()
const router = useRouter()

onMounted(async () => {
  await app.waitForInit()
  if (app.state.selectedTenant) {
    router.replace({
      name: 'Wiki',
      params: { tenantId: app.state.selectedTenant },
    })
  }
})
</script>
