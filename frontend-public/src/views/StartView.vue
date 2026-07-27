<script setup lang="ts">
/**
 * Entry screen for a visit without an organisation in the URL.
 *
 * Most installations serve exactly one organisation, so that case redirects
 * straight through and this screen is never seen. With several, it lists them;
 * with none, it says so. Nothing to type — a visitor should never have to know
 * an identifier.
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchOrganisations, type PublicOrganisation } from '../api'
import ThemeToggle from '../components/ThemeToggle.vue'

const router = useRouter()
const organisations = ref<PublicOrganisation[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const list = await fetchOrganisations()
    if (list.length === 1) {
      // replace, not push: the entry screen should not sit in the history
      await router.replace(`/${list[0]!.slug}`)
      return
    }
    organisations.value = list
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Die Übersicht ist nicht erreichbar.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
    <div class="flex items-start justify-between gap-4">
      <h1 class="text-2xl font-semibold">Dokumentation</h1>
      <ThemeToggle />
    </div>

    <p v-if="loading" class="mt-4 text-[var(--color-ink-muted)]">Wird geladen …</p>

    <p v-else-if="error" class="mt-4 text-[var(--color-ink-muted)]">{{ error }}</p>

    <p
      v-else-if="organisations.length === 0"
      class="mt-4 text-[var(--color-ink-muted)]"
    >
      Es ist noch keine Dokumentation veröffentlicht.
    </p>

    <template v-else>
      <p class="mt-2 text-[var(--color-ink-muted)]">
        Wähle eine Organisation.
      </p>
      <ul class="mt-6 space-y-2">
        <li v-for="organisation in organisations" :key="organisation.id">
          <RouterLink
            :to="`/${organisation.slug}`"
            class="block rounded-lg border border-[var(--color-line)] px-4 py-3 font-medium transition-colors hover:border-[var(--color-accent)]"
          >
            {{ organisation.name }}
          </RouterLink>
        </li>
      </ul>
    </template>
  </main>
</template>
