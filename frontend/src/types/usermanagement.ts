/** Types for organisation (tenant), team and invitation management. */

export interface Team {
  id: string
  name: string
}

export interface TeamMember {
  userId: string
  userEmail: string
  role: string
}

export interface TenantMember {
  id: string
  userEmail: string
  role: string
  joinedAt: string
}

export interface TenantInvitation {
  id: string
  tenantId: string
  tenantName: string
  email: string
  status: 'pending' | 'accepted' | 'rejected'
  role: string
}

export interface FoundUser {
  id: string
  email: string
  firstname: string
  surname: string
}
