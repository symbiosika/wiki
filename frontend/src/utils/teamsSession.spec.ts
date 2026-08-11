import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sign-in inside a Teams tab. The Teams SDK is replaced by a stub that hands out
 * an Entra token — everything else (the exchange call, where the session ends
 * up, what happens on a 401) runs for real.
 *
 * The module keeps its state in module scope, so each test resets the registry
 * and re-imports it.
 */
const getAuthToken = vi.fn(async () => 'entra-token')
const registerOnThemeChangeHandler = vi.fn()
const getContext = vi.fn(async () => ({ app: { theme: 'dark' } }))

vi.mock('@microsoft/teams-js', () => ({
  app: {
    initialize: vi.fn(async () => {}),
    getContext,
    registerOnThemeChangeHandler,
  },
  authentication: { getAuthToken },
}))

/** Point `window.location.search` at a Teams (or plain) URL. */
const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/static/app/${search}`)
}

const loadModule = async () => {
  vi.resetModules()
  return await import('./teamsSession')
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('teamsSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getAuthToken.mockClear()
    getAuthToken.mockResolvedValue('entra-token')
    setSearch('?host=teams')
    localStorage.clear()
    sessionStorage.clear()
  })

  it('detects Teams mode from the query string only', async () => {
    const teams = await loadModule()
    expect(teams.isTeamsHost()).toBe(true)

    setSearch('')
    const browser = await loadModule()
    expect(browser.isTeamsHost()).toBe(false)
  })

  it('exchanges the Entra token for a session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'authenticated',
        token: 'session-token',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const teams = await loadModule()
    expect(await teams.bootstrapTeamsSession()).toBe('authenticated')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/auth/teams/exchange')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      teamsToken: 'entra-token',
    })

    expect(teams.getTeamsAuthToken()).toBe('session-token')
    expect(teams.teamsAuthHeaders()).toEqual({
      Authorization: 'Bearer session-token',
    })
  })

  it('never persists the session token', async () => {
    // The whole point of the in-memory design: a reload re-authenticates
    // silently, so there is nothing on disk for a script to steal.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'authenticated',
        token: 'session-token',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const teams = await loadModule()
    await teams.bootstrapTeamsSession()

    expect(JSON.stringify(localStorage)).not.toContain('session-token')
    expect(JSON.stringify(sessionStorage)).not.toContain('session-token')
    expect(document.cookie).not.toContain('session-token')
  })

  it('reports the invitation-code step without a session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'invitation_code_required',
        pendingRegistrationToken: 'pending-token',
        email: 'newcomer@symbiosika.de',
      }),
    )

    const teams = await loadModule()
    expect(await teams.bootstrapTeamsSession()).toBe('invitation_code_required')
    expect(teams.teamsState.email).toBe('newcomer@symbiosika.de')
    expect(teams.getTeamsAuthToken()).toBeNull()
  })

  it('completes the sign-up with a code and the parked identity', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'invitation_code_required',
          pendingRegistrationToken: 'pending-token',
          email: 'newcomer@symbiosika.de',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'authenticated',
          token: 'session-token',
          expiresAt: '2026-01-01T00:00:00.000Z',
        }),
      )

    const teams = await loadModule()
    await teams.bootstrapTeamsSession()
    await teams.submitTeamsInvitationCode('code-123')

    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('/api/v1/auth/teams/complete-registration')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      // the identity comes from the server-signed token, not from the client
      pendingRegistrationToken: 'pending-token',
      invitationCode: 'code-123',
    })
    expect(teams.teamsState.status).toBe('authenticated')
    expect(teams.getTeamsAuthToken()).toBe('session-token')
  })

  it('surfaces a rejected code and keeps the step open', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'invitation_code_required',
          pendingRegistrationToken: 'pending-token',
          email: 'newcomer@symbiosika.de',
        }),
      )
      .mockResolvedValueOnce(
        new Response('Invitation code not found', { status: 400 }),
      )

    const teams = await loadModule()
    await teams.bootstrapTeamsSession()

    await expect(teams.submitTeamsInvitationCode('wrong')).rejects.toThrow()
    expect(teams.teamsState.status).toBe('invitation_code_required')
    expect(teams.getTeamsAuthToken()).toBeNull()
  })

  it('reports an error instead of throwing when the host refuses a token', async () => {
    // A tab that cannot get a token must still mount and explain itself.
    getAuthToken.mockRejectedValue(new Error('resourceDisabled'))

    const teams = await loadModule()
    expect(await teams.bootstrapTeamsSession()).toBe('error')
    expect(teams.teamsState.message).toContain('resourceDisabled')
  })

  it('re-authenticates silently on refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'authenticated',
        token: 'fresh-token',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const teams = await loadModule()
    expect(await teams.refreshTeamsSession()).toBe(true)
    expect(teams.getTeamsAuthToken()).toBe('fresh-token')
    // a new Entra token is fetched every time, no reuse of a stale one
    expect(getAuthToken).toHaveBeenCalledTimes(1)
  })

  it('does not attempt a refresh outside Teams mode', async () => {
    setSearch('')
    const teams = await loadModule()

    expect(await teams.refreshTeamsSession()).toBe(false)
    expect(getAuthToken).not.toHaveBeenCalled()
  })

  it('appends the session token to WebSocket URLs only when signed in', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'authenticated',
        token: 'session-token',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const teams = await loadModule()
    // no session yet → URL untouched
    expect(teams.withTeamsWsToken('wss://host/api/v1/x')).toBe(
      'wss://host/api/v1/x',
    )

    await teams.bootstrapTeamsSession()
    expect(teams.withTeamsWsToken('wss://host/api/v1/x')).toBe(
      'wss://host/api/v1/x?token=session-token',
    )
    // an existing query string is respected
    expect(teams.withTeamsWsToken('wss://host/api/v1/x?rate=16000')).toBe(
      'wss://host/api/v1/x?rate=16000&token=session-token',
    )
  })

  it('maps the Teams theme, treating high contrast as dark', async () => {
    const teams = await loadModule()
    const applied: string[] = []

    await teams.watchTeamsTheme((theme) => applied.push(theme))
    expect(applied).toEqual(['dark'])

    // the host also pushes changes while the tab is open
    const handler = registerOnThemeChangeHandler.mock.calls.at(-1)?.[0] as (
      theme: string,
    ) => void
    handler('contrast')
    handler('default')
    expect(applied).toEqual(['dark', 'dark', 'light'])
  })
})
