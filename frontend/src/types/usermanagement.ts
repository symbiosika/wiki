/** Types for organisation (tenant), team and invitation management. */

/**
 * A member's access level to the knowledge (wiki pages) of a scope
 * (team or organisation):
 * - "write": full read/write access (the default)
 * - "read":  read-only; the member can see the knowledge but not create,
 *            change, move or delete it
 */
export type KnowledgeAccessLevel = 'read' | 'write'

export interface Team {
  id: string
  name: string
  /**
   * When true, every user that newly joins the tenant is automatically
   * added to this team as a "member". Only editable by team admins.
   */
  addNewUsersByDefault?: boolean
}

export interface TeamMember {
  userId: string
  userEmail: string
  role: string
  /** Read/write vs. read-only access to this team's knowledge. */
  knowledgeAccess: KnowledgeAccessLevel
}

export interface TenantMember {
  id: string
  userEmail: string
  role: string
  /** Read/write vs. read-only access to this organisation's knowledge. */
  knowledgeAccess: KnowledgeAccessLevel
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

/**
 * An invitation as seen by an organisation admin (GET
 * /api/v1/tenant/:tenantId/invitations). Unlike `TenantInvitation` this is
 * the raw row: it carries no tenant name, but the timestamps an admin needs
 * to judge how long an invitation has been open.
 */
export interface TenantInvitationAdminView {
  id: string
  tenantId: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'declined'
  createdAt: string
  updatedAt: string
}

export interface FoundUser {
  id: string
  email: string
  firstname: string
  surname: string
}
