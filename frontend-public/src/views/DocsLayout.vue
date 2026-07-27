<script setup lang="ts">
/**
 * Documentation chrome: header with search, sidebar with the published tree,
 * content area for the routed view.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadOverview, overviewState } from '../store'
import PageTree from '../components/PageTree.vue'

const route = useRoute()
const router = useRouter()

const tenantId = computed(() => String(route.params.tenantId ?? ''))
const activePageId = computed(() =>
  typeof route.params.pageId === 'string' ? route.params.pageId : null,
)

watch(tenantId, (id) => id && loadOverview(id), { immediate: true })

const query = ref('')
watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string') query.value = q
  },
  { immediate: true },
)

const submitSearch = () => {
  const q = query.value.trim()
  if (!q) return
  router.push({ name: 'search', params: { tenantId: tenantId.value }, query: { q } })
}

/** open on mobile, always visible from `lg` up */
const navOpen = ref(false)
watch(() => route.fullPath, () => (navOpen.value = false))
</script>

<template>
  <div class="min-h-screen">
    <header
      class="sticky top-0 z-20 border-b border-[var(--color-line)] bg-white/90 backdrop-blur"
    >
      <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <button
          type="button"
          class="rounded p-1 text-[var(--color-ink-muted)] lg:hidden"
          :aria-label="navOpen ? 'Navigation schließen' : 'Navigation öffnen'"
          :aria-expanded="navOpen"
          @click="navOpen = !navOpen"
        >
          <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M3 5h14M3 10h14M3 15h14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
            />
          </svg>
        </button>

        <RouterLink :to="`/${tenantId}`" class="font-semibold whitespace-nowrap">
          Dokumentation
        </RouterLink>

        <form class="ml-auto w-full max-w-sm" role="search" @submit.prevent="submitSearch">
          <input
            v-model="query"
            type="search"
            placeholder="Suchen …"
            aria-label="Dokumentation durchsuchen"
            class="w-full rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </form>
      </div>
    </header>

    <div class="mx-auto flex max-w-6xl gap-8 px-4">
      <aside
        class="w-64 shrink-0 py-6 lg:block"
        :class="navOpen ? 'block' : 'hidden'"
        aria-label="Seiten"
      >
        <p v-if="overviewState.loading" class="text-sm text-[var(--color-ink-muted)]">
          Wird geladen …
        </p>
        <p v-else-if="overviewState.error" class="text-sm text-[var(--color-ink-muted)]">
          {{ overviewState.error }}
        </p>
        <p
          v-else-if="!overviewState.overview?.sections.length"
          class="text-sm text-[var(--color-ink-muted)]"
        >
          Es sind noch keine Seiten veröffentlicht.
        </p>

        <nav v-else class="space-y-6">
          <section v-for="section in overviewState.overview.sections" :key="section.id">
            <h2
              class="mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase"
            >
              {{ section.name }}
            </h2>
            <PageTree
              :nodes="section.pages"
              :tenant-id="tenantId"
              :active-id="activePageId"
            />
          </section>
        </nav>
      </aside>

      <main class="min-w-0 flex-1 py-8">
        <RouterView />
      </main>
    </div>
  </div>
</template>
