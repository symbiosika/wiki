/**
 * Wiki tree business logic.
 *
 * Builds the sidebar tree for the wiki UI from the framework's
 * knowledgeText pages. Pages are partitioned into three sections:
 * - personal:     pages owned by the current user (not team, not tenant-wide)
 * - teams:        pages assigned to a team the user is a member of (one group per team)
 * - organisation: tenant-wide pages
 *
 * Within each section the pages are nested by parentId. Pages whose
 * parent is not visible to the user appear as roots of their section.
 */
import { getKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { getTeamsByUser } from "@framework/lib/usermanagement/teams";

type KnowledgeTextListRow = Awaited<
  ReturnType<typeof getKnowledgeText>
>[number];

export interface WikiTreeNode {
  id: string;
  title: string;
  parentId: string | null;
  position: string | null;
  contentMode: "text" | "blocks";
  teamId: string | null;
  userId: string | null;
  tenantWide: boolean;
  updatedAt: string;
  children: WikiTreeNode[];
}

export interface WikiTeamSection {
  teamId: string;
  name: string;
  role: string;
  pages: WikiTreeNode[];
}

export interface WikiTree {
  personal: WikiTreeNode[];
  teams: WikiTeamSection[];
  organisation: WikiTreeNode[];
}

const toNode = (row: KnowledgeTextListRow): WikiTreeNode => ({
  id: row.id,
  title: row.title,
  parentId: row.parentId ?? null,
  position: row.position ?? null,
  contentMode: row.contentMode,
  teamId: row.teamId ?? null,
  userId: row.userId ?? null,
  tenantWide: row.tenantWide ?? false,
  updatedAt: row.updatedAt,
  children: [],
});

/**
 * Nest a flat, pre-sorted list of pages by parentId.
 * The input order (position, then title) is preserved on every level.
 * Pages referencing a parent outside the given list become roots.
 */
export const buildTreeFromRows = (
  rows: KnowledgeTextListRow[]
): WikiTreeNode[] => {
  const nodes = new Map<string, WikiTreeNode>();
  for (const row of rows) {
    nodes.set(row.id, toNode(row));
  }

  const roots: WikiTreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
};

/**
 * Build the complete wiki sidebar tree for a user within a tenant.
 */
export const buildWikiTree = async (
  tenantId: string,
  userId: string
): Promise<WikiTree> => {
  // sequential on purpose: parallel queries can interleave on
  // single-connection dev databases (PGlite wire protocol)
  const pages = await getKnowledgeText({ tenantId, userId });
  const userTeams = await getTeamsByUser(userId, tenantId);

  const personalRows: KnowledgeTextListRow[] = [];
  const organisationRows: KnowledgeTextListRow[] = [];
  const teamRows = new Map<string, KnowledgeTextListRow[]>();

  for (const page of pages) {
    if (page.teamId) {
      const rows = teamRows.get(page.teamId) ?? [];
      rows.push(page);
      teamRows.set(page.teamId, rows);
    } else if (page.tenantWide) {
      organisationRows.push(page);
    } else if (page.userId === userId) {
      personalRows.push(page);
    }
    // Anything else (e.g. hidden/system rows of other users) is not
    // part of the sidebar tree.
  }

  const teams: WikiTeamSection[] = userTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({
      teamId: team.teamId,
      name: team.name,
      role: team.role,
      pages: buildTreeFromRows(teamRows.get(team.teamId) ?? []),
    }));

  return {
    personal: buildTreeFromRows(personalRows),
    teams,
    organisation: buildTreeFromRows(organisationRows),
  };
};
