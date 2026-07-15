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

  // Presence relies on a WebSocket to `/api/v1/.../presence`. Some deployments
  // sit behind a reverse proxy that does not forward WS upgrades, so the socket
  // never connects (it just reconnect-loops). Without a fallback the edit lock
  // is never granted and the whole app is stuck read-only with no visible error.
  // We therefore detect a persistently unreachable presence socket and switch to
  // a degraded mode where editing is allowed WITHOUT the cross-user lock — the
  // lock is a concurrency nicety, not a correctness requirement, and a usable
  // app beats a silently-locked one. Strict locking resumes the moment a socket
  // successfully connects again.
  const FAILURES_UNTIL_DEGRADED = 2
  let consecutiveFailures = 0
  const presenceUnavailable = ref(false)

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
    // whether this particular socket ever received a state frame; used to tell
    // a genuinely working presence channel from one that only appears to open
    // (e.g. a proxy that accepts the upgrade then drops it) before deciding the
    // channel is unavailable.
    let gotState = false

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
        // presence is genuinely working — leave any degraded fallback and
        // resume strict locking.
        gotState = true
        consecutiveFailures = 0
        presenceUnavailable.value = false
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
      // a socket that closed without ever delivering state never really worked;
      // after a couple of such attempts assume presence is unreachable in this
      // deployment and fall back to lock-free editing so the app stays usable.
      if (!gotState && !presenceUnavailable.value) {
        consecutiveFailures += 1
        if (consecutiveFailures >= FAILURES_UNTIL_DEGRADED) {
          presenceUnavailable.value = true
          console.warn(
            '[wiki] presence WebSocket unreachable; editing without the ' +
              'cross-user lock. Ensure the reverse proxy forwards WebSocket ' +
              'upgrades on /api/v1.',
          )
        }
      }
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
  // Editable when you want to edit AND you hold the lock — or presence is
  // unavailable, in which case we fall back to lock-free editing so a broken
  // WebSocket channel does not leave the app permanently read-only.
  const canEdit = computed(
    () =>
      wantsEdit.value &&
      (state.value.youHoldLock || presenceUnavailable.value),
  )

  return {
    connected,
    canEdit,
    youHoldLock,
    lockedByOther,
    lockHolderName,
    presenceUnavailable,
  }
}
