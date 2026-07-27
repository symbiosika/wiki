/**
 * Public (unauthenticated) wiki reads.
 *
 * Everything in here answers requests that carry no user at all, so it never
 * takes a `userId`. Access is decided solely by the framework's published flag
 * (`knowledgeText.publicEffective`, resolved from `publicMode` inheritance —
 * see @framework/lib/knowledge/knowledge-text-public), which every call below
 * requests via `publicOnly: true`.
 *
 * Two rules hold for every function in this module:
 *   1. reads only — there is no public write path anywhere in the app, and
 *   2. `publicOnly: true` is passed on every framework call. Omitting it does
 *      NOT narrow to nothing; a context of just `{ tenantId }` is the
 *      framework's internal/service shape and returns the whole tenant.
 */
import { getKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { getKnowledgeTextById } from "@framework/lib/knowledge/knowledge-texts";
import { searchKnowledgeTexts } from "@framework/lib/knowledge/knowledge-text-search";
import type { KnowledgeTextSearchResult } from "@framework/lib/knowledge/knowledge-text-search";
import { getTeamsByOrganisation } from "@framework/lib/usermanagement/teams";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { tenants } from "@framework/lib/db/schema/users";
import { tenantSettings } from "@framework/lib/db/schema/tenant-settings";
import { organisationLogos } from "../../db/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { buildTreeFromRows, type WikiTreeNode } from "./tree";
import { slugifyOrganisationName } from "./slug";

/** An organisation as an anonymous visitor sees it. */
export interface PublicOrganisation {
  id: string
  name: string
  slug: string
  /**
   * Whether a logo exists, and when it last changed — the documentation site
   * turns this into `…/logo?v=<updatedAt>` so a replaced logo is not served
   * from a stale cache. The bytes come from the separate logo route.
   */
  hasLogo: boolean
  logoUpdatedAt: string | null
  /**
   * Primary brand colour as `#rrggbb`, or null. The same `branding` tenant
   * setting the authenticated app themes itself with, so a published site
   * matches the wiki it came from.
   */
  brandColor: string | null
}

/** Tenant setting the authenticated app stores its brand colours under. */
const BRANDING_SETTING_KEY = 'branding'

const HEX = /^#?[0-9a-fA-F]{6}$/

type Branding = {
  brandColor: string | null
  hasLogo: boolean
  logoUpdatedAt: string | null
}

/**
 * Brand colour and logo metadata for a set of organisations — two queries in
 * total rather than two per organisation.
 *
 * The colour is validated rather than trusted: it ends up in a CSS custom
 * property on a public page, and it is written through a generic key-value
 * settings endpoint that has no idea what a colour is.
 */
const loadBranding = async (
  organisationIds: string[]
): Promise<Map<string, Branding>> => {
  const result = new Map<string, Branding>()
  if (organisationIds.length === 0) return result

  for (const id of organisationIds) {
    result.set(id, { brandColor: null, hasLogo: false, logoUpdatedAt: null })
  }

  const settings = await getDb()
    .select({
      tenantId: tenantSettings.tenantId,
      valueJson: tenantSettings.valueJson,
    })
    .from(tenantSettings)
    .where(
      and(
        inArray(tenantSettings.tenantId, organisationIds),
        eq(tenantSettings.key, BRANDING_SETTING_KEY)
      )
    )

  for (const setting of settings) {
    const primary = (setting.valueJson as { primary?: unknown } | null)?.primary
    if (typeof primary === 'string' && HEX.test(primary.trim())) {
      const hex = primary.trim()
      const entry = result.get(setting.tenantId)
      if (entry) entry.brandColor = hex.startsWith('#') ? hex : `#${hex}`
    }
  }

  const logos = await getDb()
    .select({
      organisationId: organisationLogos.organisationId,
      updatedAt: organisationLogos.updatedAt,
    })
    .from(organisationLogos)
    .where(inArray(organisationLogos.organisationId, organisationIds))

  for (const logo of logos) {
    const entry = result.get(logo.organisationId)
    if (entry) {
      entry.hasLogo = true
      entry.logoUpdatedAt = logo.updatedAt
    }
  }

  return result
}

/**
 * Every organisation that has published at least one page.
 *
 * The "at least one page" condition is the access rule, not an optimisation:
 * without it this would enumerate every tenant on the installation. An
 * organisation appears here only after it has deliberately published something,
 * at which point its name is public by its own choice — the same trade-off the
 * overview already makes for team names.
 */
export const listPublicOrganisations = async (): Promise<
  PublicOrganisation[]
> => {
  const rows = await getDb()
    .selectDistinct({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .innerJoin(knowledgeText, eq(knowledgeText.tenantId, tenants.id))
    .where(
      and(
        eq(knowledgeText.publicEffective, true),
        eq(knowledgeText.hidden, false),
        isNull(knowledgeText.deletedAt)
      )
    );

  const branding = await loadBranding(rows.map((row) => row.id));

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: slugifyOrganisationName(row.name),
      ...(branding.get(row.id) ?? {
        hasLogo: false,
        logoUpdatedAt: null,
        brandColor: null,
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Resolve a URL slug to a published organisation, or null.
 *
 * Slugs are derived from names rather than stored, so two names can produce the
 * same slug ("Acme AG" and "Acme-AG"). When that happens the oldest match wins
 * — an arbitrary but stable rule, so a link does not start pointing somewhere
 * else the moment a similarly named organisation publishes.
 */
export const resolvePublicOrganisation = async (
  slug: string
): Promise<PublicOrganisation | null> => {
  const wanted = slugifyOrganisationName(slug);
  if (!wanted) return null;

  const candidates = (await listPublicOrganisations()).filter(
    (organisation) => organisation.slug === wanted
  );
  if (candidates.length <= 1) return candidates[0] ?? null;

  const oldest = await getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      inArray(
        tenants.id,
        candidates.map((organisation) => organisation.id)
      )
    )
    .orderBy(tenants.createdAt)
    .limit(1);

  return (
    candidates.find((organisation) => organisation.id === oldest[0]?.id) ??
    candidates[0]!
  );
};

/** A group of published pages, presented like a space in the wiki UI. */
export interface PublicWikiSection {
  /**
   * Stable id of the group. The team id for a team space, or the literal
   * "organisation" for tenant-wide pages, which belong to no team.
   */
  id: string;
  /** Display name of the group. */
  name: string;
  pages: WikiTreeNode[];
}

export interface PublicWikiOverview {
  /**
   * The organisation this documentation belongs to, so a reader (and the
   * document title) can name it without a second request. Null when the tenant
   * row cannot be read.
   */
  organisation: PublicOrganisation | null;
  /** Groups that contain at least one published page. Never empty groups. */
  sections: PublicWikiSection[];
  /** Total number of published pages across all groups. */
  pageCount: number;
}

/** Group id used for tenant-wide pages, which have no team. */
export const ORGANISATION_SECTION_ID = "organisation";

/**
 * Overview of everything a tenant has published, grouped into sections that
 * mirror the wiki's own structure: one per team that has published something,
 * plus one for tenant-wide pages.
 *
 * Only teams that actually contain a published page are listed. A team whose
 * pages are all internal is not mentioned at all, so this endpoint cannot be
 * used to enumerate a tenant's team structure.
 *
 * Note this does expose the NAME of a team that has published pages. That is
 * intentional (the names are what makes the public view navigable) but it does
 * mean a team name is published together with its first public page.
 */
export const buildPublicWikiOverview = async (
  tenantId: string,
  options: { organisationLabel?: string } = {}
): Promise<PublicWikiOverview> => {
  const pages = await getKnowledgeText({ tenantId, publicOnly: true });

  const organisationRows: typeof pages = [];
  const byTeam = new Map<string, typeof pages>();

  for (const page of pages) {
    if (page.teamId) {
      const rows = byTeam.get(page.teamId);
      if (rows) rows.push(page);
      else byTeam.set(page.teamId, [page]);
    } else {
      // tenant-wide pages and (defensively) anything without a team land in
      // the organisation group — a page must never fall out of the overview
      organisationRows.push(page);
    }
  }

  // Resolve display names only for the teams that actually appear.
  const sections: PublicWikiSection[] = [];
  if (byTeam.size > 0) {
    const teams = await getTeamsByOrganisation(tenantId);
    const nameById = new Map(teams.map((team) => [team.id, team.name]));
    for (const [teamId, rows] of byTeam) {
      sections.push({
        id: teamId,
        name: nameById.get(teamId) ?? "Team",
        pages: buildTreeFromRows(rows),
      });
    }
    sections.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (organisationRows.length > 0) {
    sections.unshift({
      id: ORGANISATION_SECTION_ID,
      name: options.organisationLabel ?? "Organisation",
      pages: buildTreeFromRows(organisationRows),
    });
  }

  const tenant = await getDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  let organisation: PublicOrganisation | null = null;
  if (tenant[0]) {
    const branding = (await loadBranding([tenant[0].id])).get(tenant[0].id);
    organisation = {
      id: tenant[0].id,
      name: tenant[0].name,
      slug: slugifyOrganisationName(tenant[0].name),
      hasLogo: branding?.hasLogo ?? false,
      logoUpdatedAt: branding?.logoUpdatedAt ?? null,
      brandColor: branding?.brandColor ?? null,
    };
  }

  return { organisation, sections, pageCount: pages.length };
};

/** Fields of a published page that are safe to hand to an anonymous reader. */
export interface PublicWikiPage {
  id: string;
  title: string;
  text: string;
  summary: string | null;
  pageType: string | null;
  status: string | null;
  updatedAt: string;
  parentId: string | null;
}

/**
 * A single published page.
 *
 * Throws when the page is not published — the framework's read path already
 * treats "not visible" and "does not exist" identically, so this leaks no
 * information about internal pages.
 *
 * The response is an explicit allow-list rather than the whole row: the page
 * record also carries audit columns (createdBy/updatedBy/verifiedBy), owner
 * references, access fields and technical `meta`, none of which belong in a
 * public response.
 */
export const getPublicWikiPage = async (
  tenantId: string,
  pageId: string
): Promise<PublicWikiPage> => {
  const page = await getKnowledgeTextById(pageId, {
    tenantId,
    publicOnly: true,
  });

  return {
    id: page.id,
    title: page.title,
    text: page.text,
    summary: page.summary ?? null,
    pageType: page.pageType ?? null,
    status: page.status ?? null,
    updatedAt: page.updatedAt,
    // Only meaningful when the parent is published too; the tree in the
    // overview is the authoritative navigation.
    parentId: page.parentId ?? null,
  };
};

/** A search hit, reduced to the fields that are safe to publish. */
export interface PublicWikiSearchHit {
  id: string;
  title: string;
  /** Breadcrumb, already trimmed at the first internal ancestor. */
  path: string;
  snippet: string;
  summary: string | null;
  pageType: string | null;
  status: string | null;
  updatedAt: string;
  score: number;
}

const toPublicHit = (hit: KnowledgeTextSearchResult): PublicWikiSearchHit => ({
  id: hit.id,
  title: hit.title,
  path: hit.path,
  snippet: hit.snippet,
  summary: hit.summary,
  pageType: hit.pageType,
  status: hit.status,
  updatedAt: hit.updatedAt,
  score: hit.score,
});

/**
 * Hybrid (full-text + semantic) search across a tenant's published pages.
 *
 * This is the framework's own search with `publicOnly`, not a reimplementation:
 * the filter is applied inside both retrieval legs, so the ranking is computed
 * over the published set. Filtering a ranked result set afterwards would let
 * internal pages crowd published ones out of the top-N.
 *
 * `supersededAlternatives` and the chunk-provenance fields are dropped: the
 * former can point at pages that are not published, the latter is only useful
 * to an authenticated editor deep-linking into a block.
 */
export const searchPublicWiki = async (
  tenantId: string,
  query: string,
  options: { limit?: number; mode?: "hybrid" | "fulltext" } = {}
): Promise<PublicWikiSearchHit[]> => {
  const results = await searchKnowledgeTexts(
    query,
    { tenantId, publicOnly: true },
    { mode: options.mode ?? "hybrid", limit: options.limit ?? 10 }
  );
  return results.map(toPublicHit);
};

// The public image read lives next to its authenticated twin in ./images, so
// the filename and reference checks that guard both exist exactly once.
export { getPublicWikiPageImage } from "./images";
