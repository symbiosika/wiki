<script setup lang="ts">
/**
 * Entry page: the published sections and their top-level pages, as cards.
 * The sidebar carries the full tree; this is the overview a first-time
 * visitor lands on.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { overviewState } from '../store'

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const overview = computed(() => overviewState.overview)

/** The organisation names the page; "Dokumentation" alone says nothing. */
const heading = computed(() =>
  overviewState.organisation
    ? `${overviewState.organisation.name} Dokumentation`
    : 'Dokumentation',
)
</script>

<template>
  <div>
    <h1 class="text-3xl font-semibold">{{ heading }}</h1>

    <p v-if="overviewState.loading" class="mt-4 text-[var(--color-ink-muted)]">
      Wird geladen …
    </p>

    <p v-else-if="overviewState.error" class="mt-4 text-[var(--color-ink-muted)]">
      {{ overviewState.error }}
    </p>

    <p v-else-if="!overview?.sections.length" class="mt-4 text-[var(--color-ink-muted)]">
      Für diese Organisation sind noch keine Seiten veröffentlicht.
    </p>

    <template v-else>
      <p class="mt-2 text-[var(--color-ink-muted)]">
        {{ overview.pageCount }}
        {{ overview.pageCount === 1 ? 'veröffentlichte Seite' : 'veröffentlichte Seiten' }}
      </p>

      <section v-for="section in overview.sections" :key="section.id" class="mt-8">
        <h2 class="text-lg font-semibold">{{ section.name }}</h2>
        <ul class="mt-3 grid gap-3 sm:grid-cols-2">
          <li v-for="page in section.pages" :key="page.id">
            <RouterLink
              :to="`/${slug}/page/${page.id}`"
              class="block rounded-lg border border-[var(--color-line)] px-4 py-3 transition-colors hover:border-[var(--color-accent)]"
            >
              <span class="font-medium">{{ page.title }}</span>
              <span
                v-if="page.children.length"
                class="mt-1 block text-sm text-[var(--color-ink-muted)]"
              >
                {{ page.children.length }}
                {{ page.children.length === 1 ? 'Unterseite' : 'Unterseiten' }}
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
