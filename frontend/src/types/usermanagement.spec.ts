import { describe, it, expect } from 'vitest'
import {
  newUserKnowledgeAccessOf,
  tenantMemberAccessState,
  type TenantMember,
} from './usermanagement'

const member = (patch: Partial<TenantMember> = {}) => ({
  id: 'u-other',
  role: 'member',
  knowledgeAccess: 'write' as const,
  ...patch,
})

const ownerViewer = { userId: 'u-owner', isAdmin: true }

describe('tenantMemberAccessState', () => {
  it('shows the owner as read/write and locks the switch', () => {
    expect(
      tenantMemberAccessState(
        member({ id: 'u-owner', role: 'owner', knowledgeAccess: 'read' }),
        ownerViewer,
      ),
    ).toEqual({ value: 'write', editable: false, ownerFixed: true })
  })

  it('locks another owner for an admin as well', () => {
    expect(
      tenantMemberAccessState(member({ role: 'owner' }), {
        userId: 'u-admin',
        isAdmin: true,
      }).editable,
    ).toBe(false)
  })

  it('lets an admin or owner change other members', () => {
    expect(
      tenantMemberAccessState(member({ knowledgeAccess: 'read' }), ownerViewer),
    ).toEqual({ value: 'read', editable: true, ownerFixed: false })
  })

  it('does not let an admin edit their own row', () => {
    expect(
      tenantMemberAccessState(member({ id: 'u-admin', role: 'admin' }), {
        userId: 'u-admin',
        isAdmin: true,
      }).editable,
    ).toBe(false)
  })

  it('makes every switch read-only for a plain member', () => {
    expect(
      tenantMemberAccessState(member(), { userId: 'u-me', isAdmin: false })
        .editable,
    ).toBe(false)
  })
})

describe('newUserKnowledgeAccessOf', () => {
  it('defaults to read when the team has no setting', () => {
    expect(newUserKnowledgeAccessOf(undefined)).toBe('read')
    expect(newUserKnowledgeAccessOf(null)).toBe('read')
    expect(newUserKnowledgeAccessOf({})).toBe('read')
  })

  it('returns the stored level', () => {
    expect(newUserKnowledgeAccessOf({ newUserKnowledgeAccess: 'read' })).toBe(
      'read',
    )
    expect(newUserKnowledgeAccessOf({ newUserKnowledgeAccess: 'write' })).toBe(
      'write',
    )
  })

  it('treats unknown values as read', () => {
    expect(
      newUserKnowledgeAccessOf({ newUserKnowledgeAccess: 'admin' as never }),
    ).toBe('read')
  })
})
