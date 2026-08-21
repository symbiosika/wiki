import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two authentication modes of the central fetcher.
 *
 * Browser: nothing is added, the HttpOnly cookie does the work, and a 401 — and
 * only a 401 — sends the user to the login page; a 403 is a permission problem
 * and reaches the caller. Teams tab: a bearer token is attached and a 401 is
 * answered by re-authenticating and retrying once — never by navigating, which
 * inside a tab would strand the user.
 */
const getAuthToken = vi.fn(async () => 'entra-token')

vi.mock('@microsoft/teams-js', () => ({
  app: {
    initialize: vi.fn(async () => {}),
    getContext: vi.fn(async () => ({ app: { theme: 'default' } })),
    registerOnThemeChangeHandler: vi.fn(),
  },
  authentication: { getAuthToken },
}))

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/static/app/${search}`)
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const session = (token: string) =>
  jsonResponse({
    status: 'authenticated',
    token,
    expiresAt: '2026-01-01T00:00:00.000Z',
  })

const loadModules = async () => {
  vi.resetModules()
  const teams = await import('./teamsSession')
  const fetcherModule = await import('./fetcher')
  return { teams, ...fetcherModule }
}

const headersOf = (call: any[]): Record<string, string> =>
  ((call[1] as RequestInit)?.headers ?? {}) as Record<string, string>

describe('fetcher authentication', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getAuthToken.mockClear()
    getAuthToken.mockResolvedValue('entra-token')
  })

  it('sends no Authorization header outside Teams mode', async () => {
    setSearch('')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }))

    const { fetcher } = await loadModules()
    await fetcher.get('/api/v1/user')

    expect(headersOf(fetchMock.mock.calls[0]!).Authorization).toBeUndefined()
  })

  it('attaches the bearer token in Teams mode', async () => {
    setSearch('?host=teams')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(session('session-token'))
      .mockResolvedValue(jsonResponse({ ok: true }))

    const { teams, fetcher } = await loadModules()
    await teams.bootstrapTeamsSession()
    await fetcher.get('/api/v1/user')

    expect(headersOf(fetchMock.mock.calls[1]!).Authorization).toBe(
      'Bearer session-token',
    )
  })

  it('re-authenticates once on 401 and retries the request', async () => {
    setSearch('?host=teams')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // initial sign-in
      .mockResolvedValueOnce(session('stale-token'))
      // the request, with an expired session
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      // the silent re-authentication
      .mockResolvedValueOnce(session('fresh-token'))
      // the retry
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const { teams, fetcher } = await loadModules()
    await teams.bootstrapTeamsSession()

    await expect(fetcher.get('/api/v1/user')).resolves.toEqual({ ok: true })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/auth/teams/exchange',
      '/api/v1/user',
      '/api/v1/auth/teams/exchange',
      '/api/v1/user',
    ])
    // the retry uses the new token, not the one that just failed
    expect(headersOf(fetchMock.mock.calls[3]!).Authorization).toBe(
      'Bearer fresh-token',
    )
  })

  it('gives up after one failed re-authentication instead of looping', async () => {
    setSearch('?host=teams')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(session('stale-token'))
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      // re-authentication fails too
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))

    const { teams, fetcher } = await loadModules()
    await teams.bootstrapTeamsSession()

    await expect(fetcher.get('/api/v1/user')).rejects.toThrow()
    // exchange, request, exchange — and then it stops
    expect(fetchMock.mock.calls.length).toBe(3)
  })

  it('does not re-authenticate on 403, which is a permission problem', async () => {
    setSearch('?host=teams')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(session('session-token'))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const { teams, fetcher } = await loadModules()
    await teams.bootstrapTeamsSession()

    await expect(fetcher.get('/api/v1/tenant/other/wiki')).rejects.toThrow()
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('surfaces a 403 outside Teams mode instead of logging the user out', async () => {
    setSearch('')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('User is not an admin of this team', { status: 403 }),
    )

    const { fetcher, FetcherError } = await loadModules()

    const error = await fetcher
      .put('/api/v1/tenant/t1/teams/t2', { name: 'new name' })
      .catch((err) => err)

    expect(error).toBeInstanceOf(FetcherError)
    expect((error as InstanceType<typeof FetcherError>).status).toBe(403)
    // no navigation to the login page: a 403 is a permission problem, not an
    // expired session
    expect(window.location.pathname).toBe('/static/app/')
  })

  it('keeps plain image URLs outside Teams mode', async () => {
    setSearch('')
    const { authenticatedImageUrl } = await loadModules()

    const image = await authenticatedImageUrl('/api/v1/user/profile-image')
    expect(image.src).toBe('/api/v1/user/profile-image')
  })

  it('loads images as blobs in Teams mode, where an <img> cannot authenticate', async () => {
    setSearch('?host=teams')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(session('session-token'))
      .mockResolvedValueOnce(new Response(new Blob(['png-bytes'])))

    const { teams, authenticatedImageUrl } = await loadModules()
    await teams.bootstrapTeamsSession()

    const image = await authenticatedImageUrl('/api/v1/user/profile-image')
    expect(image.src.startsWith('blob:')).toBe(true)
    image.revoke()
  })
})
