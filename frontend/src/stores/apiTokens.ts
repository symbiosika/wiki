import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'

/** An API token as returned by `GET /user/api-tokens` (never includes the secret). */
export interface ApiToken {
  id: string
  name: string
  scopes: string[]
  lastUsed?: string | null
  expiresAt?: string | null
  createdAt: string
  tenantId: string
}

export interface CreateApiTokenInput {
  name: string
  scopes: string[]
  tenantId: string
  /** minutes until the token expires; omit for a token that never expires */
  expiresIn?: number
}

const BASE = '/api/v1/user/api-tokens'

/**
 * Manage the signed-in user's personal API tokens.
 *
 * A token is always scoped to one tenant and a set of permission scopes. The
 * plaintext secret is returned exactly once by `create()` and is never stored
 * or retrievable afterwards.
 */
export const useApiTokens = defineStore('apiTokens', () => {
  const tokens = ref<ApiToken[]>([])
  const availableScopes = ref<string[]>([])
  const loading = ref(false)

  const load = async () => {
    loading.value = true
    try {
      tokens.value = await fetcher.get<ApiToken[]>(BASE)
    } finally {
      loading.value = false
    }
  }

  /** Load the set of scopes this instance accepts (apps may register more). */
  const loadScopes = async () => {
    if (availableScopes.value.length > 0) return
    const res = await fetcher.get<{ all: string[] }>(`${BASE}/available-scopes`)
    availableScopes.value = res.all
  }

  /** Create a token and return its one-time plaintext secret. */
  const create = async (input: CreateApiTokenInput): Promise<string> => {
    const res = await fetcher.post<{ token: string }>(BASE, input)
    await load()
    return res.token
  }

  const revoke = async (id: string) => {
    await fetcher.delete(`${BASE}/${encodeURIComponent(id)}`)
    await load()
  }

  return { tokens, availableScopes, loading, load, loadScopes, create, revoke }
})
