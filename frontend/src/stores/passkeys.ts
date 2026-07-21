import { defineStore } from 'pinia'
import {
  startRegistration,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { fetcher, FetcherError } from '@/utils/fetcher'

/** A registered passkey as returned by `GET /user/passkeys`. */
export interface Passkey {
  id: string
  credentialId: string
  nickname: string | null
  credentialDeviceType: string | null
  credentialBackedUp: boolean | null
  createdAt: string
  lastUsedAt: string | null
}

/**
 * Manage the signed-in user's WebAuthn passkeys.
 *
 * The backend gates every passkey endpoint behind
 * `isPasskeysEnabledForLocalAuth()` and returns 404 when passkeys are not
 * available (e.g. the instance uses OAuth instead of local auth, or no
 * BASE_URL is configured). We treat that 404 as "feature off" and hide the
 * whole section rather than surfacing it as an error.
 */
export const usePasskeys = defineStore('passkeys', () => {
  const passkeys = ref<Passkey[]>([])
  const loading = ref(false)
  /** Whether the browser can do WebAuthn at all. */
  const supported = ref(browserSupportsWebAuthn())
  /** null = not probed yet, false = disabled/unavailable on this instance. */
  const enabled = ref<boolean | null>(null)

  /**
   * Load the user's passkeys. Sets `enabled` as a side effect so the UI can
   * decide whether to show the section. Only genuine failures throw.
   */
  const load = async () => {
    loading.value = true
    try {
      const res = await fetcher.get<{ passkeys: Passkey[] }>(
        '/api/v1/user/passkeys',
      )
      passkeys.value = res.passkeys
      enabled.value = true
    } catch (err) {
      if (err instanceof FetcherError && err.status === 404) {
        // Passkeys are not enabled for this instance – not an error.
        enabled.value = false
        passkeys.value = []
        return
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Register a new passkey for the current user.
   *
   * Uses `@simplewebauthn/browser`, the matching client for the server's
   * `@simplewebauthn/server`. It handles all the base64url encoding of the
   * challenge and credential for us, which is the usual source of
   * "credential was not base64url-encoded" style failures. The options
   * returned by the backend are already `PublicKeyCredentialCreationOptionsJSON`
   * and are passed through verbatim.
   *
   * Any thrown error is left for the caller to translate into a message – see
   * `describePasskeyError` in the profile view.
   */
  const register = async (nickname: string) => {
    const { options, challengeToken } = await fetcher.post<{
      options: PublicKeyCredentialCreationOptionsJSON
      challengeToken: string
    }>('/api/v1/user/passkey/registration/options', {})

    const credential = await startRegistration({ optionsJSON: options })

    await fetcher.post('/api/v1/user/passkey/registration/verify', {
      challengeToken,
      credential,
      nickname: nickname.trim() || undefined,
    })

    await load()
  }

  /** Delete one passkey by its row id. */
  const remove = async (id: string) => {
    await fetcher.delete(`/api/v1/user/passkeys/${encodeURIComponent(id)}`)
    await load()
  }

  return { passkeys, loading, supported, enabled, load, register, remove }
})
