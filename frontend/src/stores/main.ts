import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { nanoid } from 'nanoid'
import type {
  FoundUser,
  Team,
  TeamMember,
  TenantInvitation,
  TenantMember,
} from '@/types/usermanagement'

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
  teams: Team[]
  tenantInvitations: TenantInvitation[]
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
    teams: [],
    tenantInvitations: [],
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

  // ----- organisation (tenant) management -----------------------------------

  const updateTenantName = async (tenantId: string, name: string) => {
    await fetcher.put(`/api/v1/tenant/${tenantId}`, { name })
    const tenant = state.value.tenants.find((org) => org.id === tenantId)
    if (tenant) tenant.name = name
  }

  const deleteTenant = async (tenantId: string) => {
    await fetcher.delete(`/api/v1/tenant/${tenantId}`)
    state.value.tenants = state.value.tenants.filter(
      (org) => org.id !== tenantId,
    )
    if (state.value.selectedTenant === tenantId) {
      state.value.selectedTenant = state.value.tenants[0]?.id || ''
    }
  }

  const leaveTenant = async (tenantId: string) => {
    await fetcher.delete(`/api/v1/user/tenant/${tenantId}/membership`)
    state.value.tenants = state.value.tenants.filter(
      (org) => org.id !== tenantId,
    )
    if (state.value.selectedTenant === tenantId) {
      state.value.selectedTenant = state.value.tenants[0]?.id || ''
    }
  }

  const getTenantMembers = async (tenantId: string) => {
    return await fetcher.get<TenantMember[]>(
      `/api/v1/tenant/${tenantId}/members`,
    )
  }

  const removeTenantMember = async (tenantId: string, userId: string) => {
    await fetcher.delete(`/api/v1/tenant/${tenantId}/members/${userId}`)
  }

  const updateTenantMemberRole = async (
    tenantId: string,
    userId: string,
    role: string,
  ) => {
    await fetcher.put(`/api/v1/tenant/${tenantId}/members/${userId}`, { role })
  }

  const inviteTenantMember = async (
    tenantId: string,
    email: string,
    role: string,
  ) => {
    await fetcher.post(`/api/v1/tenant/${tenantId}/invitations`, {
      email,
      role,
      tenantId,
    })
  }

  const searchUserByEmail = async (email: string) => {
    return await fetcher.get<FoundUser>(
      `/api/v1/user/search?email=${encodeURIComponent(email)}`,
    )
  }

  const searchUserInTenantByEmail = async (email: string) => {
    return await fetcher.get<FoundUser>(
      `/api/v1/tenant/${state.value.selectedTenant}/search/user?email=${encodeURIComponent(email)}`,
    )
  }

  // ----- invitations ---------------------------------------------------------

  const getTenantInvitations = async () => {
    const invitations = await fetcher.get<TenantInvitation[]>(
      '/api/v1/user/tenants/invitations',
    )
    state.value.tenantInvitations = invitations
    return invitations
  }

  const acceptInvitation = async (tenantId: string, invitationId: string) => {
    await fetcher.post(
      `/api/v1/tenant/${tenantId}/invitations/${invitationId}/accept`,
      {},
    )
    await getTenants()
    await getTenantInvitations()
  }

  const declineInvitation = async (tenantId: string, invitationId: string) => {
    await fetcher.post(
      `/api/v1/tenant/${tenantId}/invitations/${invitationId}/decline`,
      {},
    )
    await getTenantInvitations()
  }

  // ----- teams ---------------------------------------------------------------

  const getTeams = async () => {
    if (!state.value.selectedTenant) return
    const teams = await fetcher.get<{ teamId: string; name: string }[]>(
      `/api/v1/user/tenant/${state.value.selectedTenant}/teams`,
    )
    state.value.teams = teams.map((team) => ({
      id: team.teamId,
      name: team.name,
    }))
  }

  const createTeam = async (teamName: string) => {
    const team = await fetcher.post<{ id: string; name: string }>(
      `/api/v1/tenant/${state.value.selectedTenant}/teams`,
      { name: teamName, tenantId: state.value.selectedTenant },
    )
    state.value.teams.push(team)
    return team
  }

  const updateTeamName = async (teamId: string, name: string) => {
    await fetcher.put(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}`,
      { name, tenantId: state.value.selectedTenant },
    )
    const team = state.value.teams.find((entry) => entry.id === teamId)
    if (team) team.name = name
  }

  const deleteTeam = async (teamId: string) => {
    await fetcher.delete(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}`,
    )
    state.value.teams = state.value.teams.filter((team) => team.id !== teamId)
  }

  const leaveTeam = async (teamId: string) => {
    await fetcher.delete(
      `/api/v1/user/tenant/${state.value.selectedTenant}/teams/${teamId}/membership`,
    )
    state.value.teams = state.value.teams.filter((team) => team.id !== teamId)
  }

  const getTeamMembers = async (teamId: string) => {
    return await fetcher.get<TeamMember[]>(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}/members`,
    )
  }

  const addTeamMember = async (teamId: string, userId: string, role: string) => {
    await fetcher.post(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}/members`,
      { userId, role },
    )
  }

  const removeTeamMember = async (teamId: string, userId: string) => {
    await fetcher.delete(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}/members/${userId}`,
    )
  }

  const updateTeamMemberRole = async (
    teamId: string,
    userId: string,
    role: string,
  ) => {
    await fetcher.put(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}/members/${userId}`,
      { role },
    )
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
    createTenant,
    updateTenantName,
    deleteTenant,
    leaveTenant,
    getTenantMembers,
    removeTenantMember,
    updateTenantMemberRole,
    inviteTenantMember,
    searchUserByEmail,
    searchUserInTenantByEmail,
    getTenantInvitations,
    acceptInvitation,
    declineInvitation,
    getTeams,
    createTeam,
    updateTeamName,
    deleteTeam,
    leaveTeam,
    getTeamMembers,
    addTeamMember,
    removeTeamMember,
    updateTeamMemberRole,
    init,
  }
})
