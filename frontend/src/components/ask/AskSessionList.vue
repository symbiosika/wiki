<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- new conversation -->
    <div class="shrink-0 p-3">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg border border-surface-200 px-3 py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-800"
        @click="emit('new')"
      >
        <IconPlus class="h-4 w-4 shrink-0" />
        <span class="truncate">{{ $t('Ask.newChat') }}</span>
      </button>
    </div>

    <p
      class="shrink-0 px-4 pb-1 text-[11px] font-semibold tracking-wide text-surface-400 uppercase dark:text-surface-500"
    >
      {{ $t('Ask.history') }}
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <p
        v-if="!sessions.length"
        class="px-2 py-3 text-xs text-surface-400 dark:text-surface-500"
      >
        {{ $t('Ask.noSessions') }}
      </p>

      <ul class="space-y-0.5">
        <li v-for="session in sessions" :key="session.id" class="group relative">
          <button
            type="button"
            class="flex w-full items-center rounded-lg py-2 pr-8 pl-3 text-left text-sm transition-colors"
            :class="
              session.id === activeId
                ? 'bg-surface-100 font-medium text-surface-900 dark:bg-surface-800 dark:text-surface-0'
                : 'text-surface-600 hover:bg-surface-100/70 dark:text-surface-300 dark:hover:bg-surface-800/60'
            "
            @click="emit('select', session.id)"
          >
            <span class="truncate">
              {{ sessionLabel(session, $t('Ask.untitled')) }}
            </span>
          </button>

          <button
            type="button"
            :title="$t('Ask.delete')"
            :aria-label="$t('Ask.delete')"
            class="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-surface-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-200 hover:text-surface-600 focus-visible:opacity-100 dark:hover:bg-surface-700 dark:hover:text-surface-200"
            @click.stop="emit('delete', session)"
          >
            <IconTrash class="h-3.5 w-3.5" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The conversation list of the "Fragen" view — a plain, chronological list of
 * what the user asked before, the way a consumer chat app shows it.
 */
import IconPlus from '~icons/mdi/plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import { sessionLabel, type ChatSession } from '@/types/chatSession'

defineProps<{
  sessions: ChatSession[]
  activeId: string | null
}>()

const emit = defineEmits<{
  (e: 'new'): void
  (e: 'select', sessionId: string): void
  (e: 'delete', session: ChatSession): void
}>()
</script>
