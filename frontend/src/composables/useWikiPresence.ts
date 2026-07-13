/**
 * Wiki page editing presence & lock (client side).
 *
 * Opens a WebSocket to the backend presence relay (`/wiki/:pageId/presence`)
 * while a page is open and keeps the reactive lock state in sync. Together with
 * the global read-only mode this guarantees only one person edits a page at a
 * time — a second person opening the same page sees it read-only with a note of
 * who is currently editing.
 *
 * Wiring (see wiki/page.vue):
 *   - `wantsEdit` mirrors "global read-only mode is OFF". When true and the
 *     socket is connected, we request the edit lock; when false we release it.
 *   - `canEdit` is the final gate the editor binds to: you want to edit AND you
 *     actually hold the lock.
 *   - `lockedByOther` / `lockHolderName` drive the "being edited by X" banner.
 */
import { ref, computed, watch, onBeforeUnmount, type Ref } from 'vue'

interface PresenceState {
  locked: boolean
  lockedBy: { userId: string; name: string } | null
  youHoldLock: boolean
}

const PING_INTERVAL_MS = 30_000
const RECONNECT_DELAY_MS = 2_000

export function useWikiPresence(
  tenantId: Ref<string>,
  pageId: Ref<string>,
  wantsEdit: Ref<boolean>,
) {
  const connected = ref(false)
  const state = ref<PresenceState>({
    locked: false,
    lockedBy: null,
    youHoldLock: false,
  })

  let ws: WebSocket | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // guards against a lingering close handler from an old socket reconnecting
  let disposed = false

  const send = (payload: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload))
      } catch {
        /* noop */
      }
    }
  }

  const clearTimers = () => {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const buildUrl = (): string => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return (
      `${proto}//${window.location.host}` +
      `/api/v1/tenant/${tenantId.value}/wiki/${pageId.value}/presence`
    )
  }

  const disconnect = () => {
    clearTimers()
    if (ws) {
      const socket = ws
      ws = null
      try {
        socket.close()
      } catch {
        /* noop */
      }
    }
    connected.value = false
    state.value = { locked: false, lockedBy: null, youHoldLock: false }
  }

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer || !tenantId.value || !pageId.value) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, RECONNECT_DELAY_MS)
  }

  const connect = () => {
    if (disposed || !tenantId.value || !pageId.value) return
    // tear down any previous socket first
    if (ws) {
      const old = ws
      ws = null
      try {
        old.close()
      } catch {
        /* noop */
      }
    }
    clearTimers()

    const socket = new WebSocket(buildUrl())
    ws = socket

    socket.onopen = () => {
      if (ws !== socket) return
      connected.value = true
      // if editing is already desired, grab the lock straight away
      if (wantsEdit.value) send({ type: 'acquire' })
      pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS)
    }

    socket.onmessage = (event) => {
      if (ws !== socket) return
      let msg: Partial<PresenceState> & { type?: string }
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (msg.type === 'state') {
        state.value = {
          locked: !!msg.locked,
          lockedBy: msg.lockedBy ?? null,
          youHoldLock: !!msg.youHoldLock,
        }
      }
    }

    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      connected.value = false
      state.value = { locked: false, lockedBy: null, youHoldLock: false }
      clearTimers()
      scheduleReconnect()
    }

    socket.onerror = () => {
      // onclose follows and handles the reconnect
    }
  }

  // (re)connect whenever the page or tenant changes
  watch(
    [tenantId, pageId],
    ([tid, pid]) => {
      disconnect()
      if (tid && pid) connect()
    },
    { immediate: true },
  )

  // acquire / release the lock as the desire to edit flips
  watch(wantsEdit, (want) => {
    if (!connected.value) return
    send({ type: want ? 'acquire' : 'release' })
  })

  onBeforeUnmount(() => {
    disposed = true
    disconnect()
  })

  const lockedByOther = computed(
    () => state.value.locked && !state.value.youHoldLock,
  )
  const lockHolderName = computed(() => state.value.lockedBy?.name ?? '')
  const youHoldLock = computed(() => state.value.youHoldLock)
  const canEdit = computed(() => wantsEdit.value && state.value.youHoldLock)

  return {
    connected,
    canEdit,
    youHoldLock,
    lockedByOther,
    lockHolderName,
  }
}
