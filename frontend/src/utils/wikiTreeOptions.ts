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
