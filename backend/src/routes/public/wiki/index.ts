/**
 * Public wiki routes — the unauthenticated read view.
 *
 *   GET /public/wiki/:tenantId/overview                     published pages, grouped
 *   GET /public/wiki/:tenantId/search?q=...                 hybrid search
 *   GET /public/wiki/:tenantId/pages/:pageId                one page
 *   GET /public/wiki/:tenantId/pages/:pageId/images/:file   an embedded image
 *
 * Mounted through `customHonoApps` (NOT `customHonoAppsWithAuth`), so no
 * authentication middleware runs. Three properties make that safe:
 *
 *   1. Every handler delegates to ./lib/wiki/public.ts, which passes
 *      `publicOnly: true` on each framework read. A page is reachable here
 *      only if it was explicitly published (see the framework's
 *      knowledge-text-public module).
 *   2. Only GET handlers exist. There is deliberately no public write path —
 *      not even a "suggest an edit" — so this router cannot mutate anything.
 *   3. Errors are collapsed to 404 without their message. The framework
 *      already treats "not visible" and "does not exist" alike; keeping the
 *      status uniform means a probe cannot distinguish an internal page from a
 *      nonexistent one.
 *
 * The tenant is addressed by id. Published content is public by definition, so
 * an id in the URL discloses nothing — but it is not pretty, and a
 * human-facing deployment will likely want a slug in front of it. That is a
 * routing concern and can be added without touching the visibility rules.
 *
 * Cost note: the search endpoint's semantic leg generates a query embedding,
 * i.e. an anonymous request causes a paid API call. There is no rate limiting
 * in the framework, so a deployment that exposes this to the open internet
 * should put a limiter (or a cache) in front of it. `mode=fulltext` is
 * available for callers that want to avoid the embedding entirely.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import {
  buildPublicWikiOverview,
  getPublicWikiPage,
  searchPublicWiki,
  getPublicWikiPageImage,
  listPublicOrganisations,
  resolvePublicOrganisation,
} from "../../../lib/wiki/public";
import { getOrganisationLogo } from "../../../lib/organisation-logo/store";
import log from "@framework/lib/log";

/** Longest accepted search query — bounds the work an anonymous caller buys. */
const MAX_QUERY_LENGTH = 200;
/** Hard cap on hits per request, independent of what the caller asks for. */
const MAX_SEARCH_LIMIT = 25;

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });
const pageParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  pageId: v.pipe(v.string(), v.uuid()),
});

/**
 * Public reads must not leak WHY something is unavailable. Every failure
 * becomes a bare 404 and the detail goes to the log instead.
 */
const notFound = (c: { json: Function }, error: unknown, what: string) => {
  log.debug(`Public wiki: ${what} unavailable: ${error}`);
  return c.json({ error: "Not found" }, 404);
};

export default function definePublicWikiRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  const baseRoute = `${API_BASE_PATH}/public/wiki/:tenantId`;

  /**
   * GET /public/wiki/organisations
   *
   * Every organisation that has published at least one page. Lets the
   * documentation site offer an entry point without asking a visitor for a
   * tenant id.
   *
   * Registered before the `:tenantId` routes: those validate the parameter as
   * a UUID, so "organisations" could never match them, but keeping the literal
   * paths first makes that independent of validation order.
   */
  app.get(
    `${API_BASE_PATH}/public/wiki/organisations`,
    describeRoute({
      tags: ["public-wiki"],
      summary: "Organisations that have published pages",
      responses: {
        200: {
          description: "The published organisations",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    async (c) => {
      try {
        const organisations = await listPublicOrganisations();
        return c.json({ organisations }, 200, {
          "Cache-Control": "public, max-age=60",
        });
      } catch (error) {
        log.debug(`Public wiki: organisation list unavailable: ${error}`);
        return c.json({ organisations: [] }, 200);
      }
    }
  );

  /**
   * GET /public/wiki/by-slug/:slug
   *
   * Resolve a readable organisation slug to its tenant id. Slugs are derived
   * from organisation names rather than stored, so this is a search, not a
   * lookup — see lib/wiki/slug.ts.
   */
  app.get(
    `${API_BASE_PATH}/public/wiki/by-slug/:slug`,
    validator(
      "param",
      v.object({ slug: v.pipe(v.string(), v.minLength(1), v.maxLength(200)) })
    ),
    describeRoute({
      tags: ["public-wiki"],
      summary: "Resolve an organisation slug",
      responses: {
        200: {
          description: "The organisation",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
        404: { description: "No published organisation matches this slug" },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("param");
      try {
        const organisation = await resolvePublicOrganisation(slug);
        if (!organisation) return notFound(c, "no match", `slug ${slug}`);
        return c.json(organisation, 200, {
          "Cache-Control": "public, max-age=60",
        });
      } catch (error) {
        return notFound(c, error, `slug ${slug}`);
      }
    }
  );

  /**
   * GET /public/wiki/:tenantId/overview
   *
   * Every published page of the tenant, grouped into sections: one per team
   * that published something, plus one for organisation-wide pages. Groups
   * without published pages are absent entirely.
   */
  app.get(
    `${baseRoute}/overview`,
    validator("param", tenantParam),
    describeRoute({
      tags: ["public-wiki"],
      summary: "Published pages of a tenant, grouped into sections",
      responses: {
        200: {
          description: "The public wiki overview",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        const overview = await buildPublicWikiOverview(tenantId);
        return c.json(overview, 200, {
          // published content changes rarely; a short cache keeps a public
          // landing page cheap without making edits feel stale
          "Cache-Control": "public, max-age=60",
        });
      } catch (error) {
        return notFound(c, error, "overview");
      }
    }
  );

  /**
   * GET /public/wiki/:tenantId/logo
   *
   * The organisation's logo, for the documentation header.
   *
   * Gated on the organisation having published something — the same rule as
   * the lookup endpoints. Without it, a 200 here would confirm that a given
   * tenant id exists, which nothing else on the public surface does.
   */
  app.get(
    `${baseRoute}/logo`,
    validator("param", tenantParam),
    describeRoute({
      tags: ["public-wiki"],
      summary: "Logo of a publishing organisation",
      responses: {
        200: { description: "The logo image" },
        404: { description: "No logo, or the organisation publishes nothing" },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        const organisations = await listPublicOrganisations();
        if (!organisations.some((o) => o.id === tenantId)) {
          return notFound(c, "not publishing", `logo ${tenantId}`);
        }

        const { file, contentType } = await getOrganisationLogo(tenantId);
        return new Response(file, {
          headers: {
            "Content-Type": contentType || "application/octet-stream",
            // the URL carries a ?v=<updatedAt> cache buster, so this can be
            // cached hard without pinning a replaced logo
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (error) {
        return notFound(c, error, `logo ${tenantId}`);
      }
    }
  );

  /**
   * GET /public/wiki/:tenantId/search?q=...&limit=...&mode=...
   *
   * Hybrid search across published pages only. `mode=fulltext` skips the
   * semantic leg (and with it the embedding call).
   */
  app.get(
    `${baseRoute}/search`,
    validator("param", tenantParam),
    validator(
      "query",
      v.object({
        q: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_QUERY_LENGTH)),
        limit: v.optional(v.string()),
        mode: v.optional(v.picklist(["hybrid", "fulltext"])),
      })
    ),
    describeRoute({
      tags: ["public-wiki"],
      summary: "Search the published pages of a tenant",
      responses: {
        200: {
          description: "Search hits",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const { q, limit: limitStr, mode } = c.req.valid("query");

      const requested = limitStr ? parseInt(limitStr, 10) : 10;
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 1), MAX_SEARCH_LIMIT)
        : 10;

      try {
        const hits = await searchPublicWiki(tenantId, q, { limit, mode });
        return c.json({ hits, count: hits.length }, 200);
      } catch (error) {
        // a failing search is not a "not found" — but it also must not leak
        log.debug(`Public wiki: search failed: ${error}`);
        return c.json({ error: "Search unavailable" }, 503);
      }
    }
  );

  /**
   * GET /public/wiki/:tenantId/pages/:pageId
   *
   * One published page, reduced to the publishable fields (no audit columns,
   * owners, access fields or technical meta).
   */
  app.get(
    `${baseRoute}/pages/:pageId`,
    validator("param", pageParam),
    describeRoute({
      tags: ["public-wiki"],
      summary: "Read a published wiki page",
      responses: {
        200: {
          description: "The page",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
        404: { description: "Not published or does not exist" },
      },
    }),
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      try {
        const page = await getPublicWikiPage(tenantId, pageId);
        return c.json(page, 200, { "Cache-Control": "public, max-age=60" });
      } catch (error) {
        return notFound(c, error, `page ${pageId}`);
      }
    }
  );

  /**
   * GET /public/wiki/:tenantId/pages/:pageId/images/:filename
   *
   * An image embedded in a published page. Requires both that the page is
   * published and that its content references this exact file, so the route
   * cannot be used to enumerate the tenant's file bucket.
   */
  app.get(
    `${baseRoute}/pages/:pageId/images/:filename`,
    validator(
      "param",
      v.object({
        tenantId: v.pipe(v.string(), v.uuid()),
        pageId: v.pipe(v.string(), v.uuid()),
        filename: v.pipe(v.string(), v.maxLength(300)),
      })
    ),
    describeRoute({
      tags: ["public-wiki"],
      summary: "Read an image embedded in a published wiki page",
      responses: {
        200: { description: "The image" },
        404: { description: "Not published, or not referenced by the page" },
      },
    }),
    async (c) => {
      const { tenantId, pageId, filename } = c.req.valid("param");
      try {
        const file = await getPublicWikiPageImage(tenantId, pageId, filename);
        return new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            // content-addressed filenames, so this can be cached hard
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (error) {
        return notFound(c, error, `image ${filename}`);
      }
    }
  );
}
