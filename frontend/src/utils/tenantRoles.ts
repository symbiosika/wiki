/**
 * Who may see which part of the settings ("manage") area.
 *
 * A plain organisation member only manages their own memberships: the list of
 * their organisations (select / leave / create) and the teams they belong to.
 * Everything that configures the organisation itself — its member list, the
 * chat agent, tags, agent instructions, post-processing, OAuth apps, jobs and
 * AI tests — is for admins and owners only.
 */

export type TenantRole = 'owner' | 'admin' | 'member'

/** `owner` and `admin` administrate an organisation; everyone else does not. */
export const isTenantAdminRole = (role: string | null | undefined): boolean =>
  role === 'owner' || role === 'admin'

/** Settings routes a plain member may not open (tabs are hidden, too). */
export const ADMIN_ONLY_ROUTES: readonly string[] = [
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
]

export const isAdminOnlyRoute = (routeName: unknown): boolean =>
  typeof routeName === 'string' && ADMIN_ONLY_ROUTES.includes(routeName)
