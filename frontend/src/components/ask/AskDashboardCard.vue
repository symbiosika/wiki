<template>
  <section
    class="rounded-2xl border border-surface-200 bg-surface-0 p-4 sm:p-5 dark:border-surface-800 dark:bg-surface-900/40"
  >
    <h2
      class="mb-3 text-base font-semibold text-surface-900 sm:text-lg dark:text-surface-0"
    >
      {{ $t('Ask.dashboard.title') }}
    </h2>

    <form
      class="flex items-center gap-2 rounded-xl border border-surface-300 bg-surface-0 px-3 py-1.5 focus-within:border-primary dark:border-surface-700 dark:bg-surface-900"
      @submit.prevent="ask"
    >
      <input
        v-model="question"
        type="text"
        :placeholder="$t('Ask.dashboard.placeholder')"
        class="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-surface-800 outline-none placeholder:text-surface-400 dark:text-surface-100"
      />
      <button
        type="submit"
        :aria-label="$t('Ask.dashboard.ask')"
        :disabled="!question.trim()"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast transition-colors hover:bg-primary-emphasis disabled:opacity-40"
      >
        <IconSend class="h-4 w-4" />
      </button>
    </form>

    <!-- the last three conversations, so picking one up is one click -->
    <div v-if="recent.length" class="mt-3">
      <div class="mb-1.5 flex items-center justify-between">
        <span
          class="text-[11px] font-semibold tracking-wide text-surface-400 uppercase dark:text-surface-500"
        >
          {{ $t('Ask.dashboard.recent') }}
        </span>
        <button
          type="button"
          class="text-xs text-surface-400 transition-colors hover:text-primary dark:text-surface-500"
          @click="openAsk()"
        >
          {{ $t('Ask.dashboard.showAll') }}
        </button>
      </div>

      <ul class="space-y-0.5">
        <li v-for="session in recent" :key="session.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-100 dark:hover:bg-surface-800/60"
            @click="openSession(session.id)"
          >
            <IconChat
              class="h-4 w-4 shrink-0 text-surface-300 dark:text-surface-600"
            />
            <span
              class="min-w-0 flex-1 truncate text-sm text-surface-700 dark:text-surface-200"
            >
              {{ sessionLabel(session, $t('Ask.untitled')) }}
            </span>
            <span
              class="shrink-0 text-xs text-surface-400 dark:text-surface-500"
              :title="formatExact(session.updatedAt)"
            >
              {{ formatRelative(session.updatedAt) }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * The dashboard's way into the "Fragen" view: a question box and the three most
 * recent conversations. Typing a question and submitting jumps straight into
 * the chat with that question already sent — no second click to confirm.
 */
import IconSend from '~icons/mdi/send'
import IconChat from '~icons/mdi/message-text-outline'
import { sessionLabel } from '@/types/chatSession'
import { formatExactDateTime, formatRelativeIntl } from '@/utils/date'

const props = defineProps<{ tenantId: string }>()

const router = useRouter()
const chatSessions = useChatSessions()
const { locale } = useI18n()

const formatExact = (value: string) => formatExactDateTime(value, locale.value)
const formatRelative = (value: string) => formatRelativeIntl(value, locale.value)

const question = ref('')
const recent = computed(() => chatSessions.recent)

const openAsk = () =>
  router.push({ name: 'Ask', params: { tenantId: props.tenantId } })

const openSession = (sessionId: string) =>
  router.push({
    name: 'Ask',
    params: { tenantId: props.tenantId, sessionId },
  })

const ask = () => {
  const text = question.value.trim()
  if (!text) return
  router.push({
    name: 'Ask',
    params: { tenantId: props.tenantId },
    query: { q: text },
  })
  question.value = ''
}

watch(
  () => props.tenantId,
  (tenantId) => {
    if (tenantId) void chatSessions.ensureLoaded(tenantId)
  },
  { immediate: true },
)
</script>
