import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { nanoid } from 'nanoid'

// Types
interface User {
  id: string
  email: string
  firstname?: string
  surname?: string
  lastTenantId?: string
  profileImageName?: string
  [key: string]: any
}

interface Tenant {
  id: string
  name: string
}

interface AppState {
  isDarkMode: boolean
  loading: boolean
  initError: string | null
  user: User | null
  selectedTenant: string
  tenants: Tenant[]
  isMobile: boolean
}

// Helper function for sending events to parent window (if in iframe)
function sendEventToParent(event: { type: string; data?: any }) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(event, '*')
  }
}

export const useApp = defineStore('app', () => {
  // Composables
  const route = useRoute()
  const router = useRouter()

  // State
  const state = ref<AppState>({
    loading: true,
    initError: null,
    user: null,
    selectedTenant: '',
    tenants: [],
    isMobile: false,
    isDarkMode: false,
  })

  const checkDarkMode = () => {
    state.value.isDarkMode = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches
  }

  const createTenant = async (tenantName: string) => {
    const tenant = await fetcher.post<{ id: string; name: string }>(
      '/api/v1/tenant',
      { name: tenantName },
    )
    state.value.tenants.push(tenant)
    return tenant
  }

  onMounted(() => {
    checkDarkMode()
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', checkDarkMode)
  })

  onUnmounted(() => {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .removeEventListener('change', checkDarkMode)
  })

  const getMyUser = async () => {
    const user = await fetcher.get<any>('/api/v1/user/me')
    state.value.user = user
    state.value.selectedTenant = user.lastTenantId
  }

  const getTenants = async () => {
    const tenants = await fetcher.get<{ tenantId: string; name: string }[]>(
      '/api/v1/user/tenants',
    )
    state.value.tenants = tenants.map(
      (tenant: { tenantId: string; name: string }) => ({
        id: tenant.tenantId,
        name: tenant.name,
      }),
    )
  }

  const setSelectedTenant = async (tenantId: string) => {
    if (
      !tenantId ||
      tenantId === state.value.selectedTenant ||
      tenantId === ''
    ) {
      return
    }
    await fetcher.put(`/api/v1/user/last-tenant`, { tenantId: tenantId })
    sendEventToParent({
      type: 'tenant-changed',
      data: {
        tenantId: tenantId,
      },
    })
    state.value.selectedTenant = tenantId
  }

  const setupTenant = async (tenantName: string) => {
    const tenant = await fetcher.post<{ id: string; name: string }>(
      '/api/v1/user/setup',
      { tenantName },
    )
    state.value.tenants = [tenant]
    state.value.selectedTenant = tenant.id
    return tenant
  }

  const init = async () => {
    state.value.loading = true
    state.value.initError = null

    try {
      await getMyUser()
      await getTenants()

      // check if there is at least one tenant
      if (state.value.tenants.length === 0) {
        await createTenant('Default ' + nanoid(5))
        await getTenants()
      }

      if (state.value.user?.lastTenantId) {
        state.value.selectedTenant = state.value.user.lastTenantId
      } else if (
        state.value.tenants.length > 0 &&
        !state.value.selectedTenant
      ) {
        state.value.selectedTenant = state.value.tenants[0]!.id
      }
    } catch (error) {
      state.value.user = null
      state.value.tenants = []
      state.value.selectedTenant = ''
      state.value.initError =
        error instanceof Error ? error.message : 'Failed to initialize app'
    } finally {
      state.value.loading = false
    }
  }

  const waitForInit = async () => {
    while (state.value.loading) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // Getters (computed properties)
  const isLoading = computed(() => state.value.loading)
  const currentUser = computed(() => state.value.user)
  const currentTenant = computed(() =>
    state.value.tenants.find((t) => t.id === state.value.selectedTenant),
  )
  const hasTenants = computed(() => state.value.tenants.length > 0)

  return {
    // State
    state,

    // Getters
    isLoading,
    currentUser,
    currentTenant,
    hasTenants,

    // Composables (for convenience)
    route,
    router,

    // Actions
    getMyUser,
    waitForInit,
    setSelectedTenant,
    getTenants,
    setupTenant,
    init,
  }
})
