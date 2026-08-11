<template>
  <div class="flex h-full min-h-0">
    <!-- conversation list: static column on desktop, drawer on mobile -->
    <aside
      class="hidden w-64 shrink-0 border-r border-surface-200 lg:block dark:border-surface-800"
    >
      <AskSessionList
        :sessions="chatSessions.sessions"
        :active-id="activeSessionId"
        @new="startNewChat"
        @select="openSession"
        @delete="confirmDelete"
      />
    </aside>

    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div
        v-if="listOpen"
        class="fixed inset-0 z-30 bg-surface-950/50 backdrop-blur-[2px] lg:hidden"
        @click="listOpen = false"
      />
    </Transition>

    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="-translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-x-full"
    >
      <aside
        v-if="listOpen"
        class="fixed inset-y-0 left-0 z-40 w-72 border-r border-surface-200 bg-surface-0 shadow-2xl lg:hidden dark:border-surface-800 dark:bg-surface-950"
      >
        <AskSessionList
          :sessions="chatSessions.sessions"
          :active-id="activeSessionId"
          @new="startNewChat"
          @select="openSession"
          @delete="confirmDelete"
        />
      </aside>
    </Transition>

    <!-- conversation -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex shrink-0 items-center gap-2 border-b border-surface-200 px-3 py-2.5 dark:border-surface-800"
      >
        <button
          type="button"
          :aria-label="$t('Ask.history')"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 lg:hidden dark:text-surface-400 dark:hover:bg-surface-800"
          @click="listOpen = true"
        >
          <IconMenu class="h-5 w-5" />
        </button>

        <h1
          class="min-w-0 flex-1 truncate text-sm font-medium text-surface-800 dark:text-surface-100"
        >
          {{ headerTitle }}
        </h1>

        <button
          type="button"
          :title="$t('Ask.newChat')"
          :aria-label="$t('Ask.newChat')"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          @click="startNewChat"
        >
          <IconPlus class="h-5 w-5" />
        </button>
      </header>

      <!-- messages -->
      <div ref="scrollRef" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          <!-- empty state: the question comes first -->
          <div
            v-if="!messages.length && !loadingSession"
            class="flex flex-col items-center gap-4 pt-10 text-center sm:pt-20"
          >
            <span
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            >
              <IconChat class="h-6 w-6" />
            </span>
            <h2
              class="text-xl font-semibold text-surface-900 sm:text-2xl dark:text-surface-0"
            >
              {{ $t('Ask.emptyTitle') }}
            </h2>
            <p class="max-w-md text-sm text-surface-500 dark:text-surface-400">
              {{ $t('Ask.emptyHint') }}
            </p>
            <div class="mt-2 flex flex-wrap justify-center gap-2">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion"
                type="button"
                class="rounded-full border border-surface-200 px-3 py-1.5 text-xs text-surface-600 transition-colors hover:border-primary/50 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800/60"
                @click="submitText(suggestion)"
              >
                {{ suggestion }}
              </button>
            </div>
          </div>

          <div
            v-else-if="loadingSession"
            class="flex justify-center pt-16 text-sm text-surface-400 dark:text-surface-500"
          >
            {{ $t('Ask.loading') }}
          </div>

          <!-- conversation -->
          <div v-else class="space-y-6">
            <div
              v-for="(message, index) in messages"
              :key="message.id ?? index"
              class="flex"
              :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <!-- the question: a compact bubble -->
              <div
                v-if="message.role === 'user'"
                class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-contrast"
              >
                {{ textOf(message) }}
              </div>

              <!-- the answer: plain text on the page, tool lines above it -->
              <div v-else class="w-full min-w-0 space-y-1.5">
                <template
                  v-for="(part, partIndex) in message.parts ?? []"
                  :key="`${message.id ?? index}-${partIndex}`"
                >
                  <div
                    v-if="part.type === 'text' && part.text"
                    class="text-sm text-surface-800 dark:text-surface-100"
                  >
                    <MarkdownRenderer :content="part.text" />
                  </div>
                  <AskToolLine
                    v-else-if="normalizeToolPart(part)"
                    :call="normalizeToolPart(part)!"
                  />
                </template>
              </div>
            </div>

            <!-- waiting for the first token of an answer -->
            <div v-if="isThinking" class="flex items-center gap-1.5">
              <span
                class="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-300 [animation-delay:-0.3s] dark:bg-surface-600"
              />
              <span
                class="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-300 [animation-delay:-0.15s] dark:bg-surface-600"
              />
              <span
                class="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-300 dark:bg-surface-600"
              />
            </div>

            <div
              v-if="chatError"
              class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              <IconAlert class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{{ $t('Ask.error') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- input -->
      <div class="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <form
          class="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-surface-300 bg-surface-0 px-3 py-2 focus-within:border-primary dark:border-surface-700 dark:bg-surface-900"
          @submit.prevent="handleSubmit"
        >
          <textarea
            ref="inputRef"
            v-model="input"
            rows="1"
            :placeholder="$t('Ask.inputPlaceholder')"
            class="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-surface-800 outline-none placeholder:text-surface-400 dark:text-surface-100"
            @keydown.enter.exact.prevent="handleSubmit"
            @input="autoGrow"
          />
          <button
            v-if="isStreaming"
            type="button"
            :aria-label="$t('Ask.stop')"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-200 text-surface-700 transition-colors hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600"
            @click="stop"
          >
            <IconStop class="h-4 w-4" />
          </button>
          <button
            v-else
            type="submit"
            :aria-label="$t('Ask.send')"
            :disabled="!input.trim()"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast transition-colors hover:bg-primary-emphasis disabled:opacity-40"
          >
            <IconSend class="h-4 w-4" />
          </button>
        </form>
        <p
          class="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-surface-400 dark:text-surface-500"
        >
          {{ $t('Ask.disclaimer') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * "Fragen" — the plain-language chat view.
 *
 * Same agent as the wiki slide-over, a different promise to the user: named
 * conversations that survive a reload (see stores/chatSessions), answers that
 * read like text on a page, and tool calls reduced to a quiet grey line
 * (AskToolLine) instead of the technical cards of the wiki panel. Read-only by
 * design — editing the wiki stays in the wiki chat, where the mode switch makes
 * the consequence visible.
 *
 * Routes:
 *   /tenant/:tenantId/ask              → a fresh conversation
 *   /tenant/:tenantId/ask/:sessionId   → an existing one
 *   ?q=…  sends that question immediately (the dashboard's question box).
 */
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import IconChat from '~icons/mdi/message-text-outline'
import IconSend from '~icons/mdi/send'
import IconStop from '~icons/mdi/stop'
import IconPlus from '~icons/mdi/plus'
import IconMenu from '~icons/mdi/menu'
import IconAlert from '~icons/mdi/alert-circle-outline'
import AskSessionList from '@/components/ask/AskSessionList.vue'
import AskToolLine from '@/components/ask/AskToolLine.vue'
import { normalizeToolPart } from '@/components/wiki/toolCall'
import { teamsAuthHeaders } from '@/utils/teamsSession'
import { sessionLabel, type ChatSession } from '@/types/chatSession'

const route = useRoute()
const router = useRouter()
const chatSessions = useChatSessions()
const confirm = useConfirm()
const toast = useToast()
const { t, tm, rt } = useI18n()

const tenantId = computed(() => String(route.params.tenantId ?? ''))

const input = ref('')
const listOpen = ref(false)
const loadingSession = ref(false)
const scrollRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

/**
 * The conversation currently on screen. Kept next to the route parameter rather
 * than derived from it: a new conversation gets its id the moment the first
 * question is sent, and the route is only rewritten afterwards — the watcher
 * below must not treat that as "open a different session".
 */
const activeSessionId = ref<string | null>(null)

// shallowRef: the Chat instance owns its own reactive refs, a deep ref would
// re-proxy them (same reasoning as in WikiAiChat).
const chat = shallowRef<InstanceType<typeof Chat> | null>(null)

const buildChat = (sessionId: string | null, initial: unknown[] = []) =>
  new Chat({
    ...(sessionId ? { id: sessionId } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: initial as any,
    transport: new DefaultChatTransport({
      api: `/api/v1/tenant/${tenantId.value}/chat`,
      // the transport fetches itself, so a Teams tab's bearer session has to be
      // attached explicitly
      headers: teamsAuthHeaders,
    }),
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages = computed<any[]>(() => chat.value?.messages ?? [])
const status = computed<string>(() => chat.value?.status ?? 'ready')
const isStreaming = computed(
  () => status.value === 'streaming' || status.value === 'submitted',
)
const chatError = computed(() => Boolean(chat.value?.error))

/** A request is in flight but nothing visible has arrived for it yet. */
const isThinking = computed(() => {
  if (!isStreaming.value) return false
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'assistant') return true
  return !(last.parts ?? []).some(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (part: any) => (part.type === 'text' && part.text) || normalizeToolPart(part),
  )
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (message: any): string =>
  (message.parts ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((part: any) => part.type === 'text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((part: any) => part.text)
    .join('')

/**
 * The header names the conversation. The stored title only exists once the
 * backend has derived it from the first question, so until then the question
 * itself stands in — the header must never read "new conversation" while an
 * answer to something is on screen.
 */
const headerTitle = computed(() => {
  const current = chatSessions.sessions.find(
    (session) => session.id === activeSessionId.value,
  )
  const stored = current
    ? (current.title?.trim() ?? current.preview?.trim() ?? '')
    : ''
  if (stored) return stored

  const firstQuestion = messages.value.find((m) => m.role === 'user')
  const asked = firstQuestion ? textOf(firstQuestion).trim() : ''
  if (asked) return asked

  return activeSessionId.value ? t('Ask.untitled') : t('Ask.newChat')
})

/**
 * Example questions from the locale file. `tm` hands back compiled message
 * objects, so every entry goes through `rt` to become a plain string; an empty
 * or missing list is fine and simply hides the chips.
 */
const suggestions = computed<string[]>(() => {
  const value = tm('Ask.suggestions') as unknown
  if (!Array.isArray(value)) return []
  return value.map((entry) =>
    typeof entry === 'string' ? entry : rt(entry as never),
  )
})

// ----- session handling -----------------------------------------------------

const loadSession = async (sessionId: string) => {
  loadingSession.value = true
  try {
    const detail = await chatSessions.getSession(tenantId.value, sessionId)
    activeSessionId.value = sessionId
    chat.value = buildChat(sessionId, detail.messages)
    await scrollToBottom()
  } catch {
    // a session that is gone (deleted elsewhere) drops the user on a fresh one
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Ask.loadError'),
      life: 3000,
    })
    activeSessionId.value = null
    chat.value = buildChat(null)
    router.replace({ name: 'Ask', params: { tenantId: tenantId.value } })
  } finally {
    loadingSession.value = false
  }
}

const startNewChat = () => {
  listOpen.value = false
  if (!activeSessionId.value && !messages.value.length) return
  activeSessionId.value = null
  chat.value = buildChat(null)
  input.value = ''
  router.push({ name: 'Ask', params: { tenantId: tenantId.value } })
  nextTick(() => inputRef.value?.focus())
}

const openSession = (sessionId: string) => {
  listOpen.value = false
  if (sessionId === activeSessionId.value) return
  router.push({
    name: 'Ask',
    params: { tenantId: tenantId.value, sessionId },
  })
}

const confirmDelete = (session: ChatSession) => {
  confirm.require({
    message: t('Ask.deleteConfirm', {
      title: sessionLabel(session, t('Ask.untitled')),
    }),
    header: t('Ask.delete'),
    acceptProps: { label: t('Ask.delete'), severity: 'danger' },
    rejectProps: { label: t('Common.cancel') },
    accept: async () => {
      try {
        await chatSessions.deleteSession(tenantId.value, session.id)
        if (session.id === activeSessionId.value) {
          activeSessionId.value = null
          chat.value = buildChat(null)
          router.replace({ name: 'Ask', params: { tenantId: tenantId.value } })
        }
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('Ask.deleteError'),
          life: 3000,
        })
      }
    },
  })
}

// ----- sending --------------------------------------------------------------

/**
 * Send one question. A conversation without a session gets one first, so the
 * backend can store the exchange while it streams; if that fails the question
 * is still sent — an unsaved answer beats no answer.
 */
const submitText = async (text: string) => {
  const question = text.trim()
  if (!question || isStreaming.value || !tenantId.value) return

  if (!chat.value) chat.value = buildChat(null)

  if (!activeSessionId.value) {
    try {
      const session = await chatSessions.createSession(tenantId.value)
      activeSessionId.value = session.id
      router.replace({
        name: 'Ask',
        params: { tenantId: tenantId.value, sessionId: session.id },
      })
    } catch {
      toast.add({
        severity: 'warn',
        summary: t('Common.error'),
        detail: t('Ask.sessionCreateError'),
        life: 3000,
      })
    }
  }

  const instance = chat.value
  if (!instance) return

  const sessionId = activeSessionId.value
  if (sessionId) chatSessions.setPreview(sessionId, question)
  instance.sendMessage(
    { text: question },
    { body: { mode: 'read', ...(sessionId ? { sessionId } : {}) } },
  )
  input.value = ''
  nextTick(autoGrow)
}

const handleSubmit = () => {
  void submitText(input.value)
}

const stop = () => {
  chat.value?.stop()
}

const autoGrow = () => {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

// ----- lifecycle ------------------------------------------------------------

const scrollToBottom = async () => {
  await nextTick()
  scrollRef.value?.scrollTo({
    top: scrollRef.value.scrollHeight,
    behavior: 'smooth',
  })
}

watch(
  () => [
    messages.value.length,
    JSON.stringify(messages.value.at(-1)?.parts ?? []),
  ],
  scrollToBottom,
)

// once an answer is complete, re-read the session so the list picks up the
// title the backend derived from the question
watch(isStreaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming && activeSessionId.value) {
    void chatSessions.refreshSession(tenantId.value, activeSessionId.value)
  }
})

// react to route changes (list click, back button, dashboard link)
watch(
  () => [tenantId.value, route.params.sessionId] as const,
  ([tenant, sessionId]) => {
    if (!tenant) return
    const id = sessionId ? String(sessionId) : null
    if (id === activeSessionId.value) return
    if (id) {
      void loadSession(id)
    } else {
      activeSessionId.value = null
      chat.value = buildChat(null)
    }
  },
  { immediate: true },
)

onMounted(async () => {
  void chatSessions.loadSessions(tenantId.value).catch(() => {
    /* the list is a convenience, not a precondition for asking */
  })

  // the dashboard's question box hands the question over in the URL: send it
  // right away and drop it from the address bar so a reload does not resend it
  const pending = route.query.q
  const question = Array.isArray(pending) ? pending[0] : pending
  if (question) {
    await router.replace({
      name: 'Ask',
      params: { tenantId: tenantId.value },
      query: {},
    })
    await submitText(String(question))
  } else {
    inputRef.value?.focus()
  }
})
</script>
