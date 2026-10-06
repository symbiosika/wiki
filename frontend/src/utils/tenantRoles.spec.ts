import { describe, expect, it } from 'vitest'
import { isAdminOnlyRoute, isTenantAdminRole } from './tenantRoles'

describe('isTenantAdminRole', () => {
  it('treats owner and admin as administrators', () => {
    expect(isTenantAdminRole('owner')).toBe(true)
    expect(isTenantAdminRole('admin')).toBe(true)
  })

  it('treats members and unknown roles as non-administrators', () => {
    expect(isTenantAdminRole('member')).toBe(false)
    expect(isTenantAdminRole(undefined)).toBe(false)
    expect(isTenantAdminRole(null)).toBe(false)
    expect(isTenantAdminRole('')).toBe(false)
  })
})

describe('isAdminOnlyRoute', () => {
  it('keeps organisation configuration away from members', () => {
    for (const name of [
      'TenantDetails',
      'ChatAgent',
      'DocumentTags',
      'AgentInstructions',
      'PostProcessingAgents',
      'OAuthApps',
      'Jobs',
      'UrlImportJob',
      'AiTests',
      'AiTestSuite',
      'AiTestRun',
    ]) {
      expect(isAdminOnlyRoute(name)).toBe(true)
    }
  })

  it('leaves the member-facing routes open', () => {
    for (const name of ['Tenants', 'Teams', 'TeamDetails', 'Wiki', 'Ask']) {
      expect(isAdminOnlyRoute(name)).toBe(false)
    }
    expect(isAdminOnlyRoute(undefined)).toBe(false)
  })
})
