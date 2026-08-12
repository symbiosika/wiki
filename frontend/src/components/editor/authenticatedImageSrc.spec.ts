import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Resolving wiki image sources when the session is a bearer token.
 *
 * The rule that matters: only app-relative paths are fetched with our
 * credentials, and only inside a Teams tab. Everything else is passed through —
 * sending the token to a foreign host would leak it, and rewriting a plain
 * browser session's images would defeat the HTTP cache for no gain.
 */
vi.mock('@microsoft/teams-js', () => ({
  app: {
    initialize: vi.fn(async () => {}),
    getContext: vi.fn(async () => ({ app: { theme: 'default' } })),
    registerOnThemeChangeHandler: vi.fn(),
  },
  authentication: { getAuthToken: vi.fn(async () => 'entra-token') },
}))

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/static/app/${search}`)
}

const loadModule = async () => {
  vi.resetModules()
  const teams = await import('@/utils/teamsSession')
  const module = await import('./authenticatedImageSrc')
  return { teams, ...module }
}

/** A session so the fetcher attaches a bearer token. */
const signIn = async (teams: typeof import('@/utils/teamsSession')) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        status: 'authenticated',
        token: 'session-token',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )
  await teams.bootstrapTeamsSession()
}

describe('authenticatedImageSrc', () => {
  const createdUrls: string[] = []
  const revokedUrls: string[] = []

  beforeEach(() => {
    vi.restoreAllMocks()
    createdUrls.length = 0
    revokedUrls.length = 0

    let counter = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:mock-${++counter}`
        createdUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn((url: string) => revokedUrls.push(url)),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes sources through outside a Teams tab', async () => {
    setSearch('')
    const { needsAuthenticatedFetch, resolveImageSrc } = await loadModule()

    expect(needsAuthenticatedFetch('/api/v1/tenant/x/images/1.png')).toBe(false)
    expect(await resolveImageSrc('/api/v1/tenant/x/images/1.png')).toBe(
      '/api/v1/tenant/x/images/1.png',
    )
    expect(createdUrls).toEqual([])
  })

  it('fetches app-relative images as blobs inside a Teams tab', async () => {
    setSearch('?host=teams')
    const { teams, resolveImageSrc } = await loadModule()
    await signIn(teams)

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['png'])))

    const resolved = await resolveImageSrc('/api/v1/tenant/x/images/1.png')

    expect(resolved).toBe('blob:mock-1')
    // …through the fetcher, i.e. with the bearer token attached
    const [, init] = fetchMock.mock.calls[0]!
    expect(
      ((init as RequestInit).headers as Record<string, string>).Authorization,
    ).toBe('Bearer session-token')
  })

  it('never sends credentials to another host', async () => {
    setSearch('?host=teams')
    const { needsAuthenticatedFetch, resolveImageSrc } = await loadModule()

    for (const src of [
      'https://example.com/logo.png',
      '//example.com/logo.png',
      'data:image/png;base64,AAA',
      'blob:already-resolved',
    ]) {
      expect(needsAuthenticatedFetch(src)).toBe(false)
      expect(await resolveImageSrc(src)).toBe(src)
    }
    expect(createdUrls).toEqual([])
  })

  it('fetches the same image once', async () => {
    setSearch('?host=teams')
    const { teams, resolveImageSrc } = await loadModule()
    await signIn(teams)

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['png'])))

    const first = await resolveImageSrc('/api/v1/tenant/x/images/1.png')
    const second = await resolveImageSrc('/api/v1/tenant/x/images/1.png')

    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure instead of caching it', async () => {
    // A 401 that triggered a silent re-authentication must not leave the image
    // permanently broken.
    setSearch('?host=teams')
    const { teams, resolveImageSrc } = await loadModule()
    await signIn(teams)

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(new Response(new Blob(['png'])))

    await expect(
      resolveImageSrc('/api/v1/tenant/x/images/1.png'),
    ).rejects.toThrow()
    expect(await resolveImageSrc('/api/v1/tenant/x/images/1.png')).toBe(
      'blob:mock-1',
    )
  })

  it('releases the blob URLs it created', async () => {
    setSearch('?host=teams')
    const { teams, resolveImageSrc, releaseImageSrcCache } = await loadModule()
    await signIn(teams)

    // A fresh Response per call: a body can only be read once.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(new Blob(['png'])),
    )

    await resolveImageSrc('/api/v1/tenant/x/images/1.png')
    await resolveImageSrc('/api/v1/tenant/x/images/2.png')

    releaseImageSrcCache()
    // give the release promises a turn
    await Promise.resolve()
    await Promise.resolve()

    expect(revokedUrls.sort()).toEqual(['blob:mock-1', 'blob:mock-2'])
    // and the cache is empty afterwards: the next render fetches again
    await resolveImageSrc('/api/v1/tenant/x/images/1.png')
    expect(createdUrls.length).toBe(3)
  })
})
