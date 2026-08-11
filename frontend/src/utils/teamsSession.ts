/**
 * Signing in when the app runs as a Microsoft Teams tab.
 *
 * Teams loads the app in an iframe under teams.microsoft.com. Two consequences
 * shape everything here:
 *
 *  1. **No cookie.** Every request from that iframe is cross-site, so the
 *     `SameSite=Lax` session cookie is never sent — and on iPadOS a cross-site
 *     cookie is not an option at all. The session token therefore lives in this
 *     module and rides along as `Authorization: Bearer` (see utils/fetcher).
 *  2. **No login page.** Redirecting to `/login.html` inside a tab is a dead
 *     end. Instead the Teams host is asked for an Entra ID token, which the
 *     backend exchanges for a session (`/auth/teams/exchange`).
 *
 * The token is deliberately kept **in memory only** — not in localStorage, not
 * in sessionStorage. After a reload the Teams host hands us a fresh Entra token
 * without any user interaction, so there is nothing to persist and nothing for
 * a script on the page to steal. That is what makes the bearer mode roughly as
 * hard as the HttpOnly cookie it replaces.
 */
import { reactive } from 'vue'

/** Query flag that switches the app into Teams mode (set in the manifest). */
const HOST_PARAM = 'host'
const HOST_VALUE = 'teams'

export type TeamsStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'invitation_code_required'
  | 'error'

export const teamsState = reactive<{
  status: TeamsStatus
  /** Address the Entra token was issued for; shown on the invitation-code step. */
  email: string
  /**
   * Raw failure reason for `error` — a Teams SDK error code or the server's
   * response body. Kept for diagnosis (console, bug reports); the gate shows a
   * translated message instead, because these strings are not user-facing.
   */
  message: string
}>({
  status: 'idle',
  email: '',
  message: '',
})

/**
 * The session token, module-scoped on purpose. Not exported as a binding so it
 * cannot be captured elsewhere and outlive a sign-out.
 */
let sessionToken: string | null = null

/** Pending registration awaiting an invitation code (signed, short-lived). */
let pendingRegistrationToken: string | null = null

/**
 * Whether this document runs as a Teams tab.
 *
 * Read from the top-level query string, which the hash router leaves intact, so
 * it survives every in-app navigation. Cached because it cannot change for the
 * lifetime of the document.
 */
let teamsHost: boolean | null = null

export const isTeamsHost = (): boolean => {
  if (teamsHost === null) {
    try {
      teamsHost =
        new URLSearchParams(window.location.search).get(HOST_PARAM) ===
        HOST_VALUE
    } catch {
      teamsHost = false
    }
  }
  return teamsHost
}

/** The bearer token for API calls, or null outside Teams mode. */
export const getTeamsAuthToken = (): string | null => sessionToken

/**
 * Authorization header for anything that does not go through the fetcher — the
 * AI chat transport, a WebSocket's query fallback, an image loaded as a blob.
 * Empty outside Teams mode, where the cookie does the job.
 */
export const teamsAuthHeaders = (): Record<string, string> =>
  sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}

/**
 * Add the session token to a WebSocket URL.
 *
 * `new WebSocket(url)` accepts no headers, so a bearer session has no other way
 * to authenticate a handshake. The backend accepts `?token=` **only** on an
 * upgrade request for exactly this reason. Outside Teams the URL is returned
 * unchanged and the cookie authenticates the handshake as before.
 */
export const withTeamsWsToken = (url: string): string => {
  if (!sessionToken) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(sessionToken)}`
}

/* ── Teams SDK ───────────────────────────────────────────────────────────── */

/**
 * The SDK is imported lazily so the ~100 kB never loads for browser users, who
 * are the vast majority.
 */
let sdk: typeof import('@microsoft/teams-js') | null = null
let sdkInitialized = false

const getSdk = async () => {
  if (!sdk) sdk = await import('@microsoft/teams-js')
  if (!sdkInitialized) {
    await sdk.app.initialize()
    sdkInitialized = true
  }
  return sdk
}

/**
 * Ask the Teams host for an Entra ID token for this application.
 *
 * This is the only trustworthy statement about who is using the tab — the
 * context object's `userObjectId` is a client-supplied value and is never used
 * for authentication.
 */
const getEntraToken = async (): Promise<string> => {
  const teams = await getSdk()
  return await teams.authentication.getAuthToken()
}

/* ── Exchange ────────────────────────────────────────────────────────────── */

type ExchangeResult =
  | { status: 'authenticated'; token: string; expiresAt: string }
  | {
      status: 'invitation_code_required'
      pendingRegistrationToken: string
      email: string
    }

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    )
  }
  return (await response.json()) as T
}

const applyResult = (result: ExchangeResult): void => {
  if (result.status === 'authenticated') {
    sessionToken = result.token
    pendingRegistrationToken = null
    teamsState.status = 'authenticated'
    teamsState.message = ''
    return
  }

  // Verified identity, but this instance gates sign-ups: keep the (signed,
  // 15-minute) pending registration so the code can be posted without going
  // through the Teams round-trip again.
  pendingRegistrationToken = result.pendingRegistrationToken
  teamsState.email = result.email
  teamsState.status = 'invitation_code_required'
}

/**
 * Sign in, or find out that an invitation code is needed.
 *
 * Never throws: the caller mounts the app either way and the state object says
 * what to render. A failure here means "no session", which the UI has to show
 * rather than crash on.
 */
export const bootstrapTeamsSession = async (): Promise<TeamsStatus> => {
  teamsState.status = 'authenticating'

  try {
    const teamsToken = await getEntraToken()
    applyResult(
      await postJson<ExchangeResult>('/api/v1/auth/teams/exchange', {
        teamsToken,
      }),
    )
  } catch (error) {
    teamsState.status = 'error'
    teamsState.message = error instanceof Error ? error.message : String(error)
  }

  return teamsState.status
}

/**
 * Second attempt with an invitation code. Throws on a rejected code so the form
 * can show it inline and let the user try again.
 */
export const submitTeamsInvitationCode = async (
  invitationCode: string,
): Promise<void> => {
  if (!pendingRegistrationToken) {
    throw new Error('No pending registration')
  }

  applyResult(
    await postJson<ExchangeResult>('/api/v1/auth/teams/complete-registration', {
      pendingRegistrationToken,
      invitationCode,
    }),
  )
}

/**
 * Silently get a new session after the old one expired or was revoked.
 *
 * Called from the fetcher on a 401 instead of the browser's redirect-to-login,
 * which cannot work inside a tab. Returns whether a usable token is available
 * afterwards; the caller retries its request once on `true`.
 */
export const refreshTeamsSession = async (): Promise<boolean> => {
  if (!isTeamsHost()) return false

  sessionToken = null
  const status = await bootstrapTeamsSession()
  return status === 'authenticated'
}

/* ── Theme ───────────────────────────────────────────────────────────────── */

export type TeamsTheme = 'light' | 'dark'

/**
 * Follow the host's appearance.
 *
 * Teams reports `default` | `dark` | `contrast`; the high-contrast theme is
 * mapped to dark, which is the closer of the two palettes we have. The callback
 * also fires when the user switches theme with the tab open.
 */
export const watchTeamsTheme = async (
  apply: (theme: TeamsTheme) => void,
): Promise<void> => {
  const toTheme = (value: string | undefined): TeamsTheme =>
    value === 'dark' || value === 'contrast' ? 'dark' : 'light'

  try {
    const teams = await getSdk()
    const context = await teams.app.getContext()
    apply(toTheme(context.app.theme))
    teams.app.registerOnThemeChangeHandler((theme) => apply(toTheme(theme)))
  } catch {
    // A missing theme is cosmetic — never a reason to fail the sign-in.
  }
}
