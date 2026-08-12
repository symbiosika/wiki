/**
 * Resolving image sources that need a bearer token.
 *
 * Wiki images are embedded as authenticated API paths
 * (`/api/v1/tenant/…/images/…`). A browser fetches an `<img src>` with cookies
 * but never with an `Authorization` header, so inside a Microsoft Teams tab —
 * where the session is a bearer token and the cookie is never sent — every one
 * of them comes back 401 and the page shows broken images.
 *
 * The fix is a per-image blob URL, but *only* in the rendered DOM. The document
 * model keeps the original path, which matters more than it looks: TipTap
 * serialises from its model, and a blob URL saved into page content would be
 * dead the moment the tab closes.
 *
 * Outside Teams nothing happens at all — the path is returned unchanged so the
 * browser cache keeps working.
 */
import { fetcher } from '@/utils/fetcher'
import { isTeamsHost } from '@/utils/teamsSession'

/** Blob URL per source path, so the same image is fetched once per document. */
const cache = new Map<string, Promise<string>>()

/**
 * Does this source need our credentials?
 *
 * Only app-relative paths do. `data:` and `blob:` are already inline, and an
 * absolute URL belongs to someone else — sending our token there would leak it.
 */
export const needsAuthenticatedFetch = (src: string): boolean =>
  isTeamsHost() && src.startsWith('/') && !src.startsWith('//')

/**
 * The source to put on the element: unchanged outside Teams, a blob URL inside.
 * Rejects if the image cannot be loaded, so callers can leave the original in
 * place and let the browser show its own broken-image state.
 */
export const resolveImageSrc = async (src: string): Promise<string> => {
  if (!needsAuthenticatedFetch(src)) return src

  const cached = cache.get(src)
  if (cached) return await cached

  const pending = fetcher
    .getBlob(src)
    .then((blob) => URL.createObjectURL(blob))
    .catch((error) => {
      // Do not cache a failure: a 401 that triggered a silent re-authentication
      // is worth retrying on the next render.
      cache.delete(src)
      throw error
    })

  cache.set(src, pending)
  return await pending
}

/**
 * Release every blob URL created so far.
 *
 * Called when the app tears down a document view. Blob URLs live as long as the
 * document otherwise, and a wiki page with many images would keep every one of
 * them alive across navigations.
 */
export const releaseImageSrcCache = (): void => {
  for (const pending of cache.values()) {
    void pending.then(
      (url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      },
      () => {
        /* a failed fetch has nothing to release */
      },
    )
  }
  cache.clear()
}
