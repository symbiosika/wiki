<script setup lang="ts">
/**
 * Documentation chrome: header with the organisation and the theme switch,
 * sidebar with search + published tree, content area for the routed view.
 *
 * Search lives in the sidebar rather than the header, matching the
 * authenticated wiki: results take the tree's place while a query is typed, so
 * the content area keeps showing the page you are reading.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { logoUrl } from '../api'
import { loadOrganisation, overviewState } from '../store'
import PageTree from '../components/PageTree.vue'
import SidebarSearch from '../components/SidebarSearch.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import {
  MAX_WIDTH,
  MIN_WIDTH,
  isDragging,
  nudgeSidebarWidth,
  resetSidebarWidth,
  sidebarWidth,
  startSidebarDrag,
} from '../sidebarWidth'

const route = useRoute()

const slug = computed(() => String(route.params.slug ?? ''))
const activePageId = computed(() =>
  typeof route.params.pageId === 'string' ? route.params.pageId : null,
)

const organisationName = computed(
  () => overviewState.organisation?.name ?? '',
)

const logoSrc = computed(() =>
  overviewState.organisation ? logoUrl(overviewState.organisation) : null,
)

watch(slug, (value) => value && loadOrganisation(value), { immediate: true })

// The organisation belongs in the tab title too — several open documentation
// tabs are otherwise indistinguishable.
watch(
  organisationName,
  (name) => {
    document.title = name ? `${name} — Dokumentation` : 'Dokumentation'
  },
  { immediate: true },
)

/** Tenant id for the search call; empty until the slug resolves. */
const tenantId = computed(() => overviewState.organisation?.id ?? '')

/** open on mobile, always visible from `lg` up */
const navOpen = ref(false)
watch(() => route.fullPath, () => (navOpen.value = false))
</script>

<template>
  <div class="min-h-screen" :class="isDragging ? 'select-none' : ''">
    <header
      class="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-page)]/90 backdrop-blur"
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

        <!--
          Organisation first, then the generic word: on a shared installation
          the name is what tells two documentation sites apart.

          `gap-2` supplies the spacing rather than whitespace between the two
          spans — Vue's template compiler condenses whitespace between elements
          across a newline, which silently glued the two words together.
        -->
        <RouterLink
          :to="`/${slug}`"
          class="flex min-w-0 items-center gap-2 font-semibold"
        >
          <img
            v-if="logoSrc"
            :src="logoSrc"
            :alt="organisationName"
            class="h-7 w-auto max-w-[10rem] shrink-0 object-contain"
          />
          <span v-if="organisationName" class="truncate">{{ organisationName }}</span>
          <span class="hidden font-normal text-[var(--color-ink-muted)] sm:inline">
            Dokumentation
          </span>
        </RouterLink>

        <ThemeToggle class="ml-auto" />
      </div>
    </header>

    <div class="mx-auto flex max-w-6xl px-4">
      <aside
        class="shrink-0 py-6 lg:sticky lg:top-[57px] lg:block lg:max-h-[calc(100vh-57px)]"
        :class="navOpen ? 'block' : 'hidden'"
        :style="{ width: `${sidebarWidth}px` }"
        aria-label="Seiten und Suche"
      >
        <p v-if="overviewState.loading" class="text-sm text-[var(--color-ink-muted)]">
          Wird geladen …
        </p>
        <p
          v-else-if="overviewState.notFound"
          class="text-sm text-[var(--color-ink-muted)]"
        >
          Diese Organisation gibt es nicht.
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

        <SidebarSearch v-else :slug="slug" :tenant-id="tenantId">
          <nav class="space-y-6">
            <section
              v-for="section in overviewState.overview.sections"
              :key="section.id"
            >
              <h2
                class="mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase"
              >
                {{ section.name }}
              </h2>
              <PageTree :nodes="section.pages" :slug="slug" :active-id="activePageId" />
            </section>
          </nav>
        </SidebarSearch>
      </aside>

      <!--
        Resize handle. A wide hit area with a hairline drawn inside it, so the
        grab target is comfortable without a thick visible divider. Focusable
        and arrow-key operable, because a drag-only control is unusable without
        a mouse; double-click restores the default.
      -->
      <div
        class="group hidden w-4 shrink-0 cursor-col-resize touch-none items-stretch justify-center lg:flex"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="MIN_WIDTH"
        :aria-valuemax="MAX_WIDTH"
        aria-label="Breite der Navigation"
        tabindex="0"
        @pointerdown.prevent="startSidebarDrag($event, sidebarWidth)"
        @dblclick="resetSidebarWidth()"
        @keydown.left.prevent="nudgeSidebarWidth(-16)"
        @keydown.right.prevent="nudgeSidebarWidth(16)"
      >
        <span
          class="my-6 w-px rounded-full transition-colors"
          :class="
            isDragging
              ? 'bg-[var(--color-accent)]'
              : 'bg-[var(--color-line)] group-hover:bg-[var(--color-accent)] group-focus:bg-[var(--color-accent)]'
          "
        />
      </div>

      <main class="min-w-0 flex-1 py-8 lg:pl-4">
        <RouterView />
      </main>
    </div>
  </div>
</template>
