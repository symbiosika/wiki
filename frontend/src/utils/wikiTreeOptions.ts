/**
 * Helpers to turn the wiki tree into a flat, indented option list for a
 * parent-page picker — used by the URL-import job dialogs to choose the
 * "main page" imported pages are nested under.
 */
import type { WikiTree, WikiTreeNode } from '@/types/wiki'

export interface PageOption {
  label: string
  value: string
}

/** Non-breaking space so indentation survives in a <Select> option label. */
const INDENT = '  '

const flatten = (nodes: WikiTreeNode[], depth: number, out: PageOption[]) => {
  for (const node of nodes) {
    out.push({
      label: `${INDENT.repeat(depth)}${node.title?.trim() || '—'}`,
      value: node.id,
    })
    if (node.children?.length) flatten(node.children, depth + 1, out)
  }
}

/**
 * Flatten the pages of a given scope into indented options.
 * `scope` is the create-dialog value: 'organisation' | 'personal' | 'team:<id>'.
 */
export const pageOptionsForScope = (
  tree: WikiTree,
  scope: string,
): PageOption[] => {
  const out: PageOption[] = []
  if (scope === 'organisation') flatten(tree.organisation, 0, out)
  else if (scope === 'personal') flatten(tree.personal, 0, out)
  else if (scope.startsWith('team:')) {
    const teamId = scope.slice('team:'.length)
    const team = tree.teams.find((t) => t.teamId === teamId)
    if (team) flatten(team.pages, 0, out)
  }
  return out
}

/** Derive the create-dialog scope string from a job's team/tenant flags. */
export const scopeFromFlags = (flags: {
  teamId: string | null
  tenantWide: boolean
}): string =>
  flags.teamId
    ? `team:${flags.teamId}`
    : flags.tenantWide
      ? 'organisation'
      : 'personal'

/** Turn a scope string back into the team/tenant flags a job stores. */
export const flagsFromScope = (
  scope: string,
): { teamId: string | null; tenantWide: boolean } => ({
  tenantWide: scope === 'organisation',
  teamId: scope.startsWith('team:') ? scope.slice('team:'.length) : null,
})

interface ScopeLabels {
  organisation: string
  personal: string
  team: string
}

/** Build the scope <Select> options (organisation / personal / team:<id>). */
export const buildScopeOptions = (
  teams: { id: string; name: string }[],
  labels: ScopeLabels,
): PageOption[] => [
  { label: labels.organisation, value: 'organisation' },
  { label: labels.personal, value: 'personal' },
  ...teams.map((team) => ({
    label: `${labels.team}: ${team.name}`,
    value: `team:${team.id}`,
  })),
]

/** Human-readable label for a job's current scope. */
export const scopeLabel = (
  flags: { teamId: string | null; tenantWide: boolean },
  teams: { id: string; name: string }[],
  labels: ScopeLabels,
): string => {
  if (flags.teamId) {
    const team = teams.find((t) => t.id === flags.teamId)
    return `${labels.team}: ${team?.name ?? flags.teamId}`
  }
  return flags.tenantWide ? labels.organisation : labels.personal
}

/** Find a page's title anywhere in the tree by id (searches all scopes). */
export const findPageTitle = (tree: WikiTree, id: string): string | null => {
  const search = (nodes: WikiTreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.id === id) return node.title?.trim() || null
      if (node.children?.length) {
        const found = search(node.children)
        if (found !== null) return found
      }
    }
    return null
  }
  return (
    search(tree.organisation) ??
    search(tree.personal) ??
    tree.teams.reduce<string | null>(
      (acc, team) => acc ?? search(team.pages),
      null,
    )
  )
}
