<script setup lang="ts">
/**
 * Landing screen for a visit without a tenant in the URL.
 *
 * The public API is addressed per organisation, so there is nothing sensible
 * to show without one. Rather than guessing or 404-ing, this asks for the id
 * and routes onwards — a deployment that serves a single organisation would
 * link straight to `#/<tenantId>` and never see this screen.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const tenantId = ref('')

const open = () => {
  const id = tenantId.value.trim()
  if (id) router.push(`/${id}`)
}
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
    <h1 class="text-2xl font-semibold">Dokumentation</h1>
    <p class="mt-2 text-[var(--color-ink-muted)]">
      Öffne die Dokumentation einer Organisation, indem du ihre ID angibst.
    </p>

    <form class="mt-6 flex gap-2" @submit.prevent="open">
      <input
        v-model="tenantId"
        type="text"
        autocomplete="off"
        placeholder="Organisations-ID"
        class="min-w-0 flex-1 rounded-md border border-[var(--color-line)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="submit"
        class="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-40"
        :disabled="!tenantId.trim()"
      >
        Öffnen
      </button>
    </form>
  </main>
</template>
