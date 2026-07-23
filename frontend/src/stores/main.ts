import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import { nanoid } from 'nanoid'
import type {
  FoundUser,
  KnowledgeAccessLevel,
  Team,
  TeamMember,
  TenantInvitation,
  TenantMember,
} from '@/types/usermanagement'
import type { WikiSearchMode } from '@/types/wiki'
import {
  applyBrandColors,
  clearBrandColors,
  type BrandColors,
} from '@/utils/brandColor'

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

/** existence + cache-busting metadata of an organisation's logo */
interface TenantLogoInfo {
  exists: boolean
  updatedAt: string | null
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
  /** the user's preferred sidebar search mode (server-persisted) */
  searchMode: WikiSearchMode
  /** per-organisation logo metadata, keyed by tenant id */
  tenantLogos: Record<string, TenantLogoInfo>
}

/** key under which the search-mode preference lives in `user_settings` */
const SEARCH_MODE_SETTING_KEY = 'wiki.searchMode'
/** key under which per-organisation branding colours live in `tenant_settings` */
const BRANDING_SETTING_KEY = 'branding'
const SEARCH_MODES: WikiSearchMode[] = ['hybrid', 'fulltext', 'semantic']
/** smart hybrid search is the default when the user has no stored choice */
const DEFAULT_SEARCH_MODE: WikiSearchMode = 'hybrid'

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
    searchMode: DEFAULT_SEARCH_MODE,
    tenantLogos: {},
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

  // ----- own profile ---------------------------------------------------------

  const updateMyProfile = async (data: {
    firstname?: string
    surname?: string
  }) => {
    const user = await fetcher.put<User>('/api/v1/user/me', data)
    state.value.user = user
    return user
  }

  const uploadProfileImage = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    await fetcher.postFormData('/api/v1/user/profile-image', formData)
    // refresh so `profileImageName` (and thus the avatar) reflects the upload
    await getMyUser()
  }

  // ----- search preference ---------------------------------------------------

  /**
   * Load the user's preferred search mode from `user_settings`. Best-effort:
   * the GET returns 404 when nothing is stored yet, in which case we keep the
   * default. Any failure leaves the (already sensible) default in place.
   */
  const loadSearchMode = async () => {
    try {
      const setting = await fetcher.get<{ key: string; value?: string }>(
        `/api/v1/user/settings/${SEARCH_MODE_SETTING_KEY}`,
      )
      if (
        setting.value &&
        SEARCH_MODES.includes(setting.value as WikiSearchMode)
      ) {
        state.value.searchMode = setting.value as WikiSearchMode
      }
    } catch {
      // no preference stored yet (404) → keep the default
    }
  }

  /**
   * Persist the preferred search mode. Applied optimistically so the UI reacts
   * instantly; rolls back and rethrows if the server rejects the change.
   */
  const setSearchMode = async (mode: WikiSearchMode) => {
    const previous = state.value.searchMode
    state.value.searchMode = mode
    try {
      await fetcher.post(`/api/v1/user/settings/${SEARCH_MODE_SETTING_KEY}`, {
        value: mode,
        description: 'Preferred wiki search mode',
      })
    } catch (error) {
      state.value.searchMode = previous
      throw error
    }
  }

  // ----- organisation branding colours ---------------------------------------

  /**
   * Load and apply the organisation's brand colours from `tenant_settings`.
   * Best-effort and readable by any tenant member: a 404 (nothing stored yet)
   * or any failure simply reverts to the default palette from `base.css`.
   */
  const getBranding = async (tenantId: string): Promise<BrandColors> => {
    try {
      const setting = await fetcher.get<{ key: string; valueJson?: BrandColors }>(
        `/api/v1/tenant/${tenantId}/settings/${BRANDING_SETTING_KEY}`,
      )
      return setting.valueJson ?? {}
    } catch {
      // no branding stored yet (404) or read failed
      return {}
    }
  }

  const loadBranding = async (tenantId: string) => {
    if (!tenantId) {
      clearBrandColors()
      return
    }
    applyBrandColors(await getBranding(tenantId))
  }

  /**
   * Persist the organisation's brand colours (tenant admins/owners only) and
   * apply them immediately. Passing null/empty for a colour clears it.
   */
  const saveBranding = async (tenantId: string, colors: BrandColors) => {
    await fetcher.post(
      `/api/v1/tenant/${tenantId}/settings/${BRANDING_SETTING_KEY}`,
      {
        valueJson: colors,
        description: 'Per-organisation branding colours',
      },
    )
    applyBrandColors(colors)
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
    // Re-theme the UI for the newly selected organisation.
    await loadBranding(tenantId)
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

  // ----- organisation logo ---------------------------------------------------

  /**
   * Load a tenant's logo metadata (best-effort). Populates `tenantLogos` so the
   * header knows whether to render a logo and which `?v=` cache buster to use.
   */
  const loadTenantLogoInfo = async (tenantId: string) => {
    if (!tenantId) return
    try {
      const info = await fetcher.get<TenantLogoInfo>(
        `/api/v1/tenant/${tenantId}/logo/info`,
      )
      state.value.tenantLogos[tenantId] = info
    } catch {
      state.value.tenantLogos[tenantId] = { exists: false, updatedAt: null }
    }
  }

  /** Cache-busting URL for a tenant's logo, or null when it has none. */
  const tenantLogoUrl = (tenantId: string): string | null => {
    const info = state.value.tenantLogos[tenantId]
    if (!info?.exists) return null
    const version = info.updatedAt ? encodeURIComponent(info.updatedAt) : '1'
    return `/api/v1/tenant/${tenantId}/logo?v=${version}`
  }

  const uploadTenantLogo = async (tenantId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    await fetcher.postFormData(`/api/v1/tenant/${tenantId}/logo`, formData)
    await loadTenantLogoInfo(tenantId)
  }

  const deleteTenantLogo = async (tenantId: string) => {
    await fetcher.delete(`/api/v1/tenant/${tenantId}/logo`)
    state.value.tenantLogos[tenantId] = { exists: false, updatedAt: null }
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

  const updateTenantMemberKnowledgeAccess = async (
    tenantId: string,
    userId: string,
    knowledgeAccess: KnowledgeAccessLevel,
  ) => {
    await fetcher.put(`/api/v1/tenant/${tenantId}/members/${userId}`, {
      knowledgeAccess,
    })
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

  const getTeam = async (teamId: string) => {
    return await fetcher.get<Team>(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}`,
    )
  }

  /**
   * Update team settings. The backend PUT endpoint validates against the full
   * team insert schema, so `name` and `tenantId` are always sent; the caller may
   * additionally update `addNewUsersByDefault`. Only team admins may edit (the
   * backend enforces this via the `isTeamAdmin` middleware).
   */
  const updateTeam = async (
    teamId: string,
    data: { name?: string; addNewUsersByDefault?: boolean },
  ) => {
    const current = state.value.teams.find((entry) => entry.id === teamId)
    const name = data.name ?? current?.name
    await fetcher.put(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}`,
      {
        name,
        tenantId: state.value.selectedTenant,
        ...(data.addNewUsersByDefault !== undefined && {
          addNewUsersByDefault: data.addNewUsersByDefault,
        }),
      },
    )
    if (current) {
      if (name) current.name = name
      if (data.addNewUsersByDefault !== undefined) {
        current.addNewUsersByDefault = data.addNewUsersByDefault
      }
    }
  }

  const updateTeamName = async (teamId: string, name: string) => {
    await updateTeam(teamId, { name })
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

  const addTeamMember = async (
    teamId: string,
    userId: string,
    role: string,
    knowledgeAccess?: KnowledgeAccessLevel,
  ) => {
    await fetcher.post(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}/members`,
      { userId, role, ...(knowledgeAccess && { knowledgeAccess }) },
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

  const updateTeamMemberKnowledgeAccess = async (
    teamId: string,
    userId: string,
    knowledgeAccess: KnowledgeAccessLevel,
  ) => {
    await fetcher.put(
      `/api/v1/tenant/${state.value.selectedTenant}/teams/${teamId}/members/${userId}`,
      { knowledgeAccess },
    )
  }

  const init = async () => {
    state.value.loading = true
    state.value.initError = null

    try {
      await getMyUser()
      await getTenants()
      // load the search preference alongside the user (best-effort, never throws)
      await loadSearchMode()

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

      // apply the selected organisation's brand colours (best-effort)
      await loadBranding(state.value.selectedTenant)
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
    updateMyProfile,
    uploadProfileImage,
    loadSearchMode,
    setSearchMode,
    getBranding,
    loadBranding,
    saveBranding,
    waitForInit,
    setSelectedTenant,
    getTenants,
    setupTenant,
    createTenant,
    updateTenantName,
    loadTenantLogoInfo,
    tenantLogoUrl,
    uploadTenantLogo,
    deleteTenantLogo,
    deleteTenant,
    leaveTenant,
    getTenantMembers,
    removeTenantMember,
    updateTenantMemberRole,
    updateTenantMemberKnowledgeAccess,
    inviteTenantMember,
    searchUserByEmail,
    searchUserInTenantByEmail,
    getTenantInvitations,
    acceptInvitation,
    declineInvitation,
    getTeams,
    getTeam,
    createTeam,
    updateTeam,
    updateTeamName,
    deleteTeam,
    leaveTeam,
    getTeamMembers,
    addTeamMember,
    removeTeamMember,
    updateTeamMemberRole,
    updateTeamMemberKnowledgeAccess,
    init,
  }
})
