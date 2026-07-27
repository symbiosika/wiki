import { describe, test, expect } from "bun:test";
import { slugifyOrganisationName } from "./slug";

describe("slugifyOrganisationName", () => {
  test("lowercases and joins words with dashes", () => {
    expect(slugifyOrganisationName("Acme Consulting")).toBe("acme-consulting");
  });

  test("transliterates German umlauts and ß", () => {
    expect(slugifyOrganisationName("Müller & Söhne")).toBe("mueller-soehne");
    expect(slugifyOrganisationName("Straße 12")).toBe("strasse-12");
    expect(slugifyOrganisationName("ÄÖÜ")).toBe("aeoeue");
  });

  test("strips other diacritics rather than dropping the letter", () => {
    expect(slugifyOrganisationName("Café Renée")).toBe("cafe-renee");
    expect(slugifyOrganisationName("Łódź")).toContain("d");
  });

  test("collapses runs of punctuation and trims the edges", () => {
    expect(slugifyOrganisationName("  --Acme---AG!!  ")).toBe("acme-ag");
    expect(slugifyOrganisationName("A / B / C")).toBe("a-b-c");
  });

  test("is idempotent, so a slug from a URL compares against a fresh one", () => {
    const once = slugifyOrganisationName("Müller & Söhne GmbH");
    expect(slugifyOrganisationName(once)).toBe(once);
  });

  test("returns an empty string when nothing usable remains", () => {
    expect(slugifyOrganisationName("!!!")).toBe("");
    expect(slugifyOrganisationName("")).toBe("");
  });

  test("different names can collide — callers must handle it", () => {
    // documents the reason resolvePublicOrganisation needs a tie-break
    expect(slugifyOrganisationName("Acme AG")).toBe(
      slugifyOrganisationName("Acme-AG")
    );
  });
});
