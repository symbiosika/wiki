<script setup lang="ts">
/**
 * Search inside the sidebar, mirroring the authenticated wiki: the field sits
 * above the tree, and while something is typed the results take the tree's
 * place in the same panel. No separate results page — the content area keeps
 * showing the page you are reading until you pick a hit.
 *
 * The tree is passed in as the default slot so this component owns the whole
 * "results or tree" decision rather than splitting it across two files.
 *
 * Requests are debounced and the previous one is aborted: the backend's
 * semantic leg generates an embedding per query, so every keystroke that
 * reaches it costs money.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { search, type SearchHit } from '../api'

const props = defineProps<{
  slug: string
  /** Resolved asynchronously from the slug; empty until it arrives. */
  tenantId: string
}>()

const router = useRouter()

const query = ref('')
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
  [() => props.tenantId, query],
  ([tenant, q]) => {
    if (timer) clearTimeout(timer)
    const trimmed = q.trim()
    if (!tenant || !trimmed) {
      hits.value = []
      searched.value = false
      loading.value = false
      return
    }
    timer = setTimeout(() => run(tenant, trimmed), 250)
  },
  { immediate: true },
)

// A new organisation means the old results are meaningless.
watch(
  () => props.slug,
  () => {
    query.value = ''
  },
)

const open = (hit: SearchHit) => {
  query.value = ''
  router.push(`/${props.slug}/page/${hit.id}`)
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  inFlight?.abort()
})
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="relative mb-4">
      <svg
        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--color-ink-muted)]"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <circle
          cx="9"
          cy="9"
          r="5.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        />
        <path
          d="M13.5 13.5L17 17"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
      <input
        v-model="query"
        type="search"
        placeholder="Suchen …"
        aria-label="Dokumentation durchsuchen"
        class="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-page)] py-1.5 pr-2 pl-8 text-sm outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-accent)]"
      />
    </div>

    <!-- results replace the tree while a query is present -->
    <div v-if="query.trim()" class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="loading" class="px-1 text-sm text-[var(--color-ink-muted)]">
        Wird gesucht …
      </p>
      <p v-else-if="error" class="px-1 text-sm text-[var(--color-ink-muted)]">
        {{ error }}
      </p>
      <p
        v-else-if="searched && hits.length === 0"
        class="px-1 text-sm text-[var(--color-ink-muted)]"
      >
        Keine veröffentlichte Seite passt dazu.
      </p>

      <ul v-else class="space-y-0.5">
        <li v-for="hit in hits" :key="hit.id">
          <button
            type="button"
            class="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-hover)]"
            @click="open(hit)"
          >
            <span class="block truncate text-sm text-[var(--color-ink)]">
              {{ hit.title }}
            </span>
            <span
              v-if="hit.path"
              class="block truncate text-xs text-[var(--color-ink-muted)]"
            >
              {{ hit.path }}
            </span>
            <span
              v-else-if="hit.snippet"
              class="block truncate text-xs text-[var(--color-ink-muted)]"
            >
              {{ hit.snippet }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </div>
  </div>
</template>
