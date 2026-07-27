/**
 * Organisation slugs for public URLs.
 *
 * The public documentation site addresses an organisation by a readable slug
 * (`/docs/#/acme-gmbh`) rather than its tenant UUID. There is no slug column —
 * the tenants table belongs to the framework — so the slug is derived from the
 * organisation name and resolved by matching, not by lookup.
 *
 * That means slugs move when an organisation is renamed. Acceptable here: the
 * canonical identifier stays the tenant id, and the slug is only an entry
 * point. If stable slugs are ever needed, they become a stored column.
 */

/** German umlauts and ß, transliterated before the generic diacritic strip. */
const GERMAN: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
};

/**
 * Turn an organisation name into a URL slug.
 *
 * "Müller & Söhne GmbH" -> "mueller-soehne-gmbh"
 *
 * Deterministic and idempotent: slugify(slugify(x)) === slugify(x), so a slug
 * taken from a URL can be compared against a freshly derived one without
 * special-casing.
 */
export const slugifyOrganisationName = (name: string): string =>
  name
    .replace(/[äöüÄÖÜß]/g, (c) => GERMAN[c] ?? c)
    // split accented characters into base + combining mark, then drop the mark
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
