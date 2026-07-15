import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  OAuthClient,
  OAuthClientCreated,
  OAuthClientInput,
} from '@/types/oauthClients'

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/oauth/clients`

export const useOAuthClients = defineStore('oauthClients', () => {
  const clients = ref<OAuthClient[]>([])
  const loading = ref(false)

  const loadClients = async (tenantId: string) => {
    loading.value = true
    try {
      const res = await fetcher.get<{ clients: OAuthClient[] }>(api(tenantId))
      clients.value = res.clients
    } finally {
      loading.value = false
    }
  }

  const createClient = async (
    tenantId: string,
    input: OAuthClientInput,
  ): Promise<OAuthClientCreated> => {
    const created = await fetcher.post<OAuthClientCreated>(api(tenantId), input)
    await loadClients(tenantId)
    return created
  }

  const updateClient = async (
    tenantId: string,
    id: string,
    patch: Partial<Omit<OAuthClientInput, 'clientType'>> & {
      disabled?: boolean
    },
  ) => {
    await fetcher.patch(`${api(tenantId)}/${id}`, patch)
    await loadClients(tenantId)
  }

  const rotateSecret = async (
    tenantId: string,
    id: string,
  ): Promise<string> => {
    const res = await fetcher.post<{ clientSecret: string }>(
      `${api(tenantId)}/${id}/rotate-secret`,
      {},
    )
    return res.clientSecret
  }

  const deleteClient = async (tenantId: string, id: string) => {
    await fetcher.delete(`${api(tenantId)}/${id}`)
    await loadClients(tenantId)
  }

  return {
    clients,
    loading,
    loadClients,
    createClient,
    updateClient,
    rotateSecret,
    deleteClient,
  }
})
