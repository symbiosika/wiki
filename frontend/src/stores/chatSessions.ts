import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  ChatSession,
  ChatSessionDetail,
} from '@/types/chatSession'

/**
 * The user's saved conversations for the "Fragen" view.
 *
 * Sessions are private per user and organisation; the backend scopes every
 * call, so the store simply keeps the current organisation's list around. It is
 * shared between the chat view and the dashboard teaser (which shows the three
 * most recent conversations), which is why the list lives in a store instead of
 * in the view.
 */
const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/chat/sessions`

export const useChatSessions = defineStore('chat-sessions', () => {
  const sessions = ref<ChatSession[]>([])
  const loading = ref(false)
  /** organisation the cached list belongs to */
  const loadedTenantId = ref<string | null>(null)
  /**
   * Sessions started while a list request was still in flight. The server
   * response was assembled before they existed, so overwriting the list with it
   * would drop the conversation the user is looking at — a real race, because
   * the view loads the list and sends the first question in the same tick.
   */
  let createdDuringLoad: ChatSession[] = []

  /** The three most recent conversations — the dashboard teaser. */
  const recent = computed(() => sessions.value.slice(0, 3))

  const loadSessions = async (tenantId: string, limit = 30) => {
    if (!tenantId) return
    loading.value = true
    createdDuringLoad = []
    try {
      const fetched = await fetcher.get<ChatSession[]>(
        `${api(tenantId)}?limit=${limit}`,
      )
      const known = new Set(fetched.map((session) => session.id))
      sessions.value = [
        ...createdDuringLoad.filter((session) => !known.has(session.id)),
        ...fetched,
      ]
      loadedTenantId.value = tenantId
    } finally {
      createdDuringLoad = []
      loading.value = false
    }
  }

  /** Load once per organisation; the dashboard calls this on every visit. */
  const ensureLoaded = async (tenantId: string) => {
    if (loadedTenantId.value === tenantId || loading.value) return
    await loadSessions(tenantId).catch(() => {
      // a failing teaser must never break the page it sits on
    })
  }

  const createSession = async (
    tenantId: string,
    title?: string,
  ): Promise<ChatSession> => {
    const session = await fetcher.post<ChatSession>(api(tenantId), {
      ...(title ? { title } : {}),
    })
    sessions.value = [session, ...sessions.value]
    if (loading.value) createdDuringLoad = [session, ...createdDuringLoad]
    return session
  }

  const getSession = (tenantId: string, sessionId: string) =>
    fetcher.get<ChatSessionDetail>(`${api(tenantId)}/${sessionId}`)

  const renameSession = async (
    tenantId: string,
    sessionId: string,
    title: string,
  ): Promise<ChatSession> => {
    const updated = await fetcher.put<ChatSession>(
      `${api(tenantId)}/${sessionId}`,
      { title },
    )
    patch(updated)
    return updated
  }

  const deleteSession = async (tenantId: string, sessionId: string) => {
    await fetcher.delete(`${api(tenantId)}/${sessionId}`)
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
  }

  /** Replace one cached session in place, keeping the list order intact. */
  const patch = (session: ChatSession) => {
    sessions.value = sessions.value.map((s) =>
      s.id === session.id ? session : s,
    )
  }

  /**
   * Show the question in the list the moment it is asked, instead of waiting
   * for the backend to derive the title once the answer is done.
   */
  const setPreview = (sessionId: string, preview: string) => {
    sessions.value = sessions.value.map((s) =>
      s.id === sessionId && !s.title && !s.preview ? { ...s, preview } : s,
    )
  }

  /**
   * Move a session to the top of the list after it was used.
   *
   * The title and preview are written by the backend while the answer streams,
   * so a freshly used session is re-read instead of guessed at. Failures are
   * swallowed: the list is a convenience, never the conversation itself.
   */
  const refreshSession = async (tenantId: string, sessionId: string) => {
    try {
      const { session } = await getSession(tenantId, sessionId)
      const rest = sessions.value.filter((s) => s.id !== sessionId)
      sessions.value = [session, ...rest]
    } catch {
      /* keep the cached list as it is */
    }
  }

  return {
    sessions,
    recent,
    loading,
    loadSessions,
    ensureLoaded,
    createSession,
    setPreview,
    getSession,
    renameSession,
    deleteSession,
    refreshSession,
  }
})
