<script setup lang="ts">
/**
 * Search across published pages.
 *
 * Requests are debounced and the previous one is aborted, because the backend's
 * semantic leg generates an embedding per query — every keystroke that reaches
 * it costs money.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { search, type SearchHit } from '../api'

const route = useRoute()
const tenantId = computed(() => String(route.params.tenantId ?? ''))
const query = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))

const hits = ref<SearchHit[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searched = ref(false)

let inFlight: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const run = async (tenant: string, q: string) => {
  inFlight?.abort()
  const controller = new AbortController()
  inFlight = controller

  loading.value = true
  error.value = null
  try {
    hits.value = await search(tenant, q, controller.signal)
    searched.value = true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    hits.value = []
    error.value = err instanceof Error ? err.message : 'Die Suche ist nicht verfügbar.'
  } finally {
    if (inFlight === controller) loading.value = false
  }
}

watch(
  [tenantId, query],
  ([tenant, q]) => {
    if (timer) clearTimeout(timer)
    if (!tenant || !q.trim()) {
      hits.value = []
      searched.value = false
      loading.value = false
      return
    }
    timer = setTimeout(() => run(tenant, q.trim()), 250)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  inFlight?.abort()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold">Suche</h1>
    <p v-if="query" class="mt-1 text-[var(--color-ink-muted)]">
      Ergebnisse für „{{ query }}“
    </p>

    <p v-if="loading" class="mt-6 text-[var(--color-ink-muted)]">Wird gesucht …</p>
    <p v-else-if="error" class="mt-6 text-[var(--color-ink-muted)]">{{ error }}</p>
    <p v-else-if="!query" class="mt-6 text-[var(--color-ink-muted)]">
      Gib oben einen Suchbegriff ein.
    </p>
    <p v-else-if="searched && hits.length === 0" class="mt-6 text-[var(--color-ink-muted)]">
      Keine veröffentlichte Seite passt zu dieser Suche.
    </p>

    <ol v-else class="mt-6 space-y-4">
      <li
        v-for="hit in hits"
        :key="hit.id"
        class="border-b border-[var(--color-line)] pb-4 last:border-0"
      >
        <RouterLink
          :to="`/${tenantId}/page/${hit.id}`"
          class="font-medium text-[var(--color-accent)]"
        >
          {{ hit.title }}
        </RouterLink>
        <p v-if="hit.path" class="text-xs text-[var(--color-ink-muted)]">{{ hit.path }}</p>
        <p v-if="hit.snippet" class="mt-1 text-sm">{{ hit.snippet }}</p>
        <p v-else-if="hit.summary" class="mt-1 text-sm text-[var(--color-ink-muted)]">
          {{ hit.summary }}
        </p>
      </li>
    </ol>
  </div>
</template>
