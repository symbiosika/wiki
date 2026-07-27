<script setup lang="ts">
/**
 * Light / dark / system switch.
 *
 * One button cycling three states rather than a binary toggle, so a visitor
 * can hand control back to the operating system after overriding it once. The
 * current state is in the label and the title, not only in the icon.
 */
import { computed } from 'vue'
import { cycleTheme, themePreference } from '../theme'

const label = computed(
  () =>
    ({
      system: 'Automatisch (System)',
      light: 'Helles Design',
      dark: 'Dunkles Design',
    })[themePreference.value],
)
</script>

<template>
  <button
    type="button"
    class="flex shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] p-1.5 text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
    :title="label"
    :aria-label="label"
    @click="cycleTheme()"
  >
    <!-- system: half-filled circle -->
    <svg
      v-if="themePreference === 'system'"
      class="size-4"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path d="M10 3a7 7 0 000 14z" fill="currentColor" />
    </svg>

    <!-- light: sun -->
    <svg
      v-else-if="themePreference === 'light'"
      class="size-4"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="3.6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M16 4l-1.4 1.4M5.4 14.6L4 16"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>

    <!-- dark: moon -->
    <svg v-else class="size-4" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M16 12.3A7 7 0 017.7 4a7 7 0 108.3 8.3z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>
