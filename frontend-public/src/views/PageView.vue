<script setup lang="ts">
/**
 * A single published page.
 *
 * A 404 from the API means "not published or does not exist" — the backend
 * refuses to distinguish the two, so this shows one neutral message for both.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchPage, type WikiPage } from '../api'
import { renderMarkdown } from '../markdown'
import { resolvePageByTitle } from '../store'

const route = useRoute()
const tenantId = computed(() => String(route.params.tenantId ?? ''))
const pageId = computed(() => String(route.params.pageId ?? ''))

const page = ref<WikiPage | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

let inFlight: AbortController | null = null

watch(
  [tenantId, pageId],
  async ([tenant, id]) => {
    if (!tenant || !id) return
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller

    loading.value = true
    error.value = null
    try {
      page.value = await fetchPage(tenant, id, controller.signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      page.value = null
      error.value = err instanceof Error ? err.message : 'Seite nicht verfügbar.'
    } finally {
      if (inFlight === controller) loading.value = false
    }
  },
  { immediate: true },
)

const html = computed(() =>
  page.value
    ? renderMarkdown(page.value.text, {
        tenantId: tenantId.value,
        pageId: page.value.id,
        resolveLink: resolvePageByTitle,
      })
    : '',
)

const updated = computed(() => {
  if (!page.value?.updatedAt) return null
  const date = new Date(page.value.updatedAt)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })
})

// Keep the document title in sync — this is a docs site, tabs and bookmarks
// should be recognisable.
watch(
  page,
  (value) => {
    document.title = value?.title ? `${value.title} — Dokumentation` : 'Dokumentation'
  },
  { immediate: true },
)
</script>

<template>
  <article>
    <p v-if="loading" class="text-[var(--color-ink-muted)]">Wird geladen …</p>

    <div v-else-if="error">
      <h1 class="text-2xl font-semibold">Nicht verfügbar</h1>
      <p class="mt-2 text-[var(--color-ink-muted)]">{{ error }}</p>
      <RouterLink :to="`/${tenantId}`" class="mt-4 inline-block text-[var(--color-accent)]">
        Zur Übersicht
      </RouterLink>
    </div>

    <template v-else-if="page">
      <header class="border-b border-[var(--color-line)] pb-4">
        <h1 class="text-3xl font-semibold">{{ page.title }}</h1>
        <p v-if="page.summary" class="mt-2 text-[var(--color-ink-muted)]">
          {{ page.summary }}
        </p>
        <p
          v-if="updated || page.pageType"
          class="mt-3 flex flex-wrap gap-x-4 text-xs text-[var(--color-ink-muted)]"
        >
          <span v-if="page.pageType">{{ page.pageType }}</span>
          <span v-if="updated">Aktualisiert am {{ updated }}</span>
        </p>
      </header>

      <!-- Sanitized in markdown.ts before it reaches the DOM. -->
      <div class="prose-doc mt-6" v-html="html" />
    </template>
  </article>
</template>
