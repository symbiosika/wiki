import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { useApp } from '@/stores/main'
import { useWiki } from '@/stores/wiki'
import type { UserMessage } from '@/types/notifications'

/**
 * User notification queue (`GET /user/notifications`).
 *
 * The framework can push a success/error message into this queue when a
 * background job finishes (opt-in `notifyOnCompletion`). Knowledge imports
 * (URL/PDF/file/text) now run as `knowledge:ingest` jobs and opt in, so their
 * completion shows up here instead of blocking the import request.
 *
 * The store polls the queue while the app is open and exposes an unread count
 * for the sidebar chip. Messages are user-scoped (not tenant-scoped), so no
 * tenantId is needed to read them.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  /** Unconfirmed messages, newest first (as returned by the API). */
  const messages = ref<UserMessage[]>([])
  const loading = ref(false)

  let timer: ReturnType<typeof setInterval> | null = null
  // Ids we have already observed, so we only react to genuinely new arrivals
  // (and don't reload the wiki tree on the very first poll).
  const seenIds = new Set<string>()
  let primed = false

  /** Number of messages waiting to be checked off — drives the sidebar chip. */
  const unreadCount = computed(() => messages.value.length)

  /** True for a message that reports a finished knowledge import. */
  const isImportSuccess = (m: UserMessage) =>
    m.messageType === 'success' && m.meta?.jobType === 'knowledge:ingest'

  const load = async () => {
    loading.value = true
    try {
      const next = await fetcher.get<UserMessage[]>(
        '/api/v1/user/notifications',
      )

      // A freshly-completed import means a new page exists — refresh the tree
      // so it appears without a manual reload. Skip on the first poll (those
      // aren't "new", they were already waiting).
      const hasNewImport = next.some(
        (m) => !seenIds.has(m.id) && isImportSuccess(m),
      )
      next.forEach((m) => seenIds.add(m.id))
      messages.value = next

      if (primed && hasNewImport) {
        const app = useApp()
        if (app.state.selectedTenant) {
          useWiki()
            .loadTree(app.state.selectedTenant)
            .catch(() => {})
        }
      }
      primed = true
    } finally {
      loading.value = false
    }
  }

  /** Mark a single message as read ("abhaken") and drop it from the list. */
  const confirm = async (id: string) => {
    await fetcher.patch(`/api/v1/user/notifications/${id}/confirm`, {})
    messages.value = messages.value.filter((m) => m.id !== id)
  }

  /** Mark every message as read. */
  const confirmAll = async () => {
    await fetcher.patch('/api/v1/user/notifications/confirm-all', {})
    messages.value = []
  }

  const startPolling = (intervalMs = 20000) => {
    if (timer) return
    load().catch(() => {})
    timer = setInterval(() => load().catch(() => {}), intervalMs)
  }

  const stopPolling = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    messages,
    loading,
    unreadCount,
    load,
    confirm,
    confirmAll,
    startPolling,
    stopPolling,
  }
})
