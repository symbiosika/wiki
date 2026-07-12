/**
 * Client-side login detection.
 *
 * The backend stores the session JWT in an HttpOnly cookie (`jwt`), which
 * JavaScript cannot read. Alongside it the backend sets a non-HttpOnly
 * marker cookie (`jwt_present=1`) that only signals "a session exists".
 * Checking `document.cookie` for `jwt=` therefore NEVER matches a real
 * session – always check the marker (the plain `jwt` check is kept as a
 * fallback for tooling that sets a non-HttpOnly cookie, e.g. tests).
 */
export const hasAuthCookie = (): boolean => {
  const cookies = document.cookie.split(';').map((c) => c.trim())
  return cookies.some(
    (c) => c.startsWith('jwt_present=') || c.startsWith('jwt='),
  )
}

/** Remove the readable auth marker (the HttpOnly `jwt` is cleared server-side). */
export const clearAuthMarkerCookie = (): void => {
  document.cookie =
    'jwt_present=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax'
  document.cookie =
    'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax'
}
