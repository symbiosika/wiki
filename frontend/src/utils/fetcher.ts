/**
 * A simple wrapper around fetch to make it easier to use
 * and to have a central place to add authentication and the backend url
 *
 * Only a 401 means "no valid session" and is handled here. A 403 is an
 * authenticated user who lacks a permission (e.g. editing a team they are not
 * an admin of) — it is passed through as a `FetcherError` so the caller can
 * show the real reason. Treating it as a session problem would log the user
 * out of a working session.
 *
 * Two authentication modes, decided once per document:
 *
 *  - **Browser (default):** the HttpOnly `jwt` cookie is attached by the browser
 *    on these same-origin requests. Nothing to do here, and the token stays
 *    unreadable to JavaScript.
 *  - **Teams tab:** there is no usable cookie (every request from the tab is
 *    cross-site), so the session token is sent as `Authorization: Bearer` and a
 *    401 is answered by silently re-authenticating against the Teams host
 *    instead of navigating to the login page — a navigation would strand the
 *    user on a page that cannot complete the flow inside a tab.
 */
import {
  isTeamsHost,
  refreshTeamsSession,
  teamsAuthHeaders,
} from './teamsSession'

export const API_BASE_URL = {
  path: '',
}

export class FetcherError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(body || `Request failed with status ${status}`)
    this.name = 'FetcherError'
  }
}

const redirectToLogin = () => {
  const redirect = encodeURIComponent(window.location.href)
  // Drop the readable session marker; the HttpOnly `jwt` cookie itself can
  // only be cleared by the server (POST /user/logout).
  document.cookie =
    'jwt_present=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax'
  document.cookie =
    'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; secure; samesite=strict'
  window.location.href = `/login.html?redirectUrl=${redirect}`
}

/** Headers every request carries, plus the bearer token in Teams mode. */
const authHeaders = (
  base: Record<string, string> = {},
): Record<string, string> => ({ ...base, ...teamsAuthHeaders() })

/**
 * Run a request, and on an expired session either re-authenticate (Teams) or
 * send the user to the login page (browser).
 *
 * The retry happens exactly once: `refreshTeamsSession` either produces a usable
 * token or it does not, and a second attempt with the same outcome would only
 * turn a failed request into a loop.
 */
const withAuth = async (send: () => Promise<Response>): Promise<Response> => {
  const response = await send()

  if (isTeamsHost()) {
    // Re-authenticating on a 403 would produce the same 403 and hide the real
    // reason from the caller.
    if (response.status !== 401) return response
    if (await refreshTeamsSession()) return await send()
    return response
  }

  if (response.status === 401) redirectToLogin()
  return response
}

const handleResponse = async <T>(
  response: Response,
  returnAsText = false,
): Promise<T> => {
  if (!response.ok) {
    const body = await response.text()
    throw new FetcherError(response.status, body)
  }

  if (returnAsText) {
    return response.text() as any
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export const fetcher = {
  // get
  async get<T>(url: string, returnAsText = false): Promise<T> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      }),
    )
    return handleResponse<T>(response, returnAsText)
  },

  // getBlob
  async getBlob(url: string): Promise<Blob> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, { headers: authHeaders() }),
    )
    if (!response.ok) {
      const body = await response.text()
      throw new FetcherError(response.status, body)
    }
    return response.blob()
  },

  // post
  async post<T>(url: string, body: any, returnAsText = false): Promise<T> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    )
    return handleResponse<T>(response, returnAsText)
  },

  // postFormData
  async postFormData<T>(
    url: string,
    formData: FormData,
    returnAsText = false,
  ): Promise<T> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      }),
    )
    return handleResponse<T>(response, returnAsText)
  },

  // put
  async put<T>(url: string, body: any, returnAsText = false): Promise<T> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    )
    return handleResponse<T>(response, returnAsText)
  },

  // patch
  async patch<T>(url: string, body: any, returnAsText = false): Promise<T> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    )
    return handleResponse<T>(response, returnAsText)
  },

  // delete
  async delete<T>(url: string, returnAsText = false): Promise<T> {
    const response = await withAuth(() =>
      fetch(API_BASE_URL.path + url, {
        method: 'DELETE',
        headers: authHeaders(),
      }),
    )
    return handleResponse<T>(response, returnAsText)
  },
}

/**
 * URL of an authenticated image, ready for an `<img src>`.
 *
 * A browser request for an image carries cookies but no `Authorization` header,
 * so in Teams mode the image has to be fetched through the fetcher and handed to
 * the DOM as a blob URL. Outside Teams the plain URL is returned unchanged —
 * that keeps the browser cache working, which a blob URL would defeat.
 *
 * The returned object must be released with `revoke()` once the image is gone,
 * otherwise the blob stays alive for the lifetime of the document.
 */
export const authenticatedImageUrl = async (
  url: string,
): Promise<{ src: string; revoke: () => void }> => {
  if (!isTeamsHost()) {
    return { src: API_BASE_URL.path + url, revoke: () => {} }
  }

  const blob = await fetcher.getBlob(url)
  const src = URL.createObjectURL(blob)
  return { src, revoke: () => URL.revokeObjectURL(src) }
}
