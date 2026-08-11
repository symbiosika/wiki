/**
 * An `<img src>` that also works when the session is a bearer token.
 *
 * A browser image request carries cookies but never an `Authorization` header,
 * so inside a Microsoft Teams tab — where the session cookie is cross-site and
 * not sent — every authenticated image would come back 401. There the bytes are
 * fetched through the fetcher instead and handed to the DOM as a blob URL.
 *
 * Outside Teams the URL is passed through unchanged: a blob URL would bypass the
 * browser's HTTP cache, so the logo and avatar would be re-downloaded on every
 * navigation for no gain.
 *
 * Blob URLs are revoked when the source changes and when the component unmounts;
 * without that each cache-busting `?v=` would leak one for the lifetime of the
 * document.
 */
import { authenticatedImageUrl } from '@/utils/fetcher'

export const useAuthenticatedImage = (url: () => string | null | undefined) => {
  const src = ref<string | null>(null)
  let revoke: (() => void) | null = null

  const release = () => {
    revoke?.()
    revoke = null
  }

  /** Guards against a slow load overwriting a newer one. */
  let sequence = 0

  watch(
    url,
    async (next) => {
      const run = ++sequence
      release()

      if (!next) {
        src.value = null
        return
      }

      try {
        const resolved = await authenticatedImageUrl(next)
        if (run !== sequence) {
          // A newer URL arrived while this one was loading — drop ours.
          resolved.revoke()
          return
        }
        src.value = resolved.src
        revoke = resolved.revoke
      } catch {
        // A missing or forbidden image is not an error worth surfacing — the
        // callers all render a placeholder when `src` stays empty.
        if (run === sequence) src.value = null
      }
    },
    { immediate: true },
  )

  onUnmounted(release)

  return src
}
