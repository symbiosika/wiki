import { describe, it, expect } from "bun:test";
import {
  compactImagesForSnippet,
  extractEmbeddedImageRefs,
  extractPageImages,
} from "./image-descriptions";

const REF = "/files/db/knowledge/11111111-1111-1111-1111-111111111111.png";
/** How an image is really embedded: the full API path, of which REF is the tail. */
const FULL = `/api/v1/tenant/t-1${REF}`;
const IMPORTED = "/files/db/images/22222222-2222-2222-2222-222222222222.jpg";

describe("extractPageImages", () => {
  it("returns the reference of an image without extras", () => {
    expect(extractPageImages(`![](${FULL})`)).toEqual([{ ref: REF }]);
  });

  it("pairs a description with its image across the path forms", () => {
    // the marker carries the full path, the extracted ref is the tail
    const content =
      `# Aufbau\n\n![Schaltplan](${FULL})\n` +
      `<image-description src="${FULL}">Steuerplatine mit Netzteil links</image-description>\n`;
    expect(extractPageImages(content)).toEqual([
      {
        ref: REF,
        alt: "Schaltplan",
        description: "Steuerplatine mit Netzteil links",
      },
    ]);
  });

  it("keeps the images in the order they appear on the page", () => {
    const content =
      `![a](${FULL})\n<image-description src="${REF}">Erstes</image-description>\n\n` +
      `![b](${IMPORTED})\n<image-description src="${IMPORTED}">Zweites</image-description>`;
    expect(extractPageImages(content).map((i) => i.description)).toEqual([
      "Erstes",
      "Zweites",
    ]);
  });

  it("drops an alt text that is only the uploaded file name", () => {
    expect(
      extractPageImages(`![11111111-1111-1111-1111-111111111111.png](${FULL})`)
    ).toEqual([{ ref: REF }]);
    expect(extractPageImages(`![screenshot.png](${FULL})`)).toEqual([
      { ref: REF },
    ]);
  });

  it("reads an html block's img tag too", () => {
    const content =
      `<img src="${FULL}" alt="Schaltplan der Platine">` +
      `<image-description src="${FULL}">Nahaufnahme</image-description>`;
    expect(extractPageImages(content)).toEqual([
      { ref: REF, alt: "Schaltplan der Platine", description: "Nahaufnahme" },
    ]);
  });

  it("collapses a multi-line description to one line", () => {
    const content = `![a](${REF})\n<image-description src="${REF}">Zeile eins\n  Zeile zwei</image-description>`;
    expect(extractPageImages(content)[0]?.description).toBe(
      "Zeile eins Zeile zwei"
    );
  });

  it("decodes what the marker escaped", () => {
    const content = `![a](${REF})\n<image-description src="${REF}">A &amp; B &lt;C&gt;</image-description>`;
    expect(extractPageImages(content)[0]?.description).toBe("A & B <C>");
  });

  it("is empty for a page without images", () => {
    expect(extractPageImages("# Nur Text\n\nkein Bild")).toEqual([]);
    expect(extractEmbeddedImageRefs("kein Bild")).toEqual([]);
  });

  it("ignores a file link that is not a page image", () => {
    expect(extractPageImages("![x](/files/db/chat/abc.png)")).toEqual([]);
  });
});

describe("compactImagesForSnippet", () => {
  it("replaces image + marker with one short label", () => {
    expect(
      compactImagesForSnippet(
        `Vorher ![Schaltplan](${FULL})\n<image-description src="${FULL}">Steuerplatine</image-description> nachher`
      )
    ).toBe("Vorher [image: Steuerplatine] nachher");
  });

  it("falls back to the alt text, then to a bare label", () => {
    expect(compactImagesForSnippet(`x ![Schaltplan](${FULL}) y`)).toBe(
      "x [image: Schaltplan] y"
    );
    expect(compactImagesForSnippet(`x ![](${FULL}) y`)).toBe("x [image] y");
  });

  it("keeps a marker whose image sits above the snippet", () => {
    expect(
      compactImagesForSnippet(
        `<image-description src="${REF}">Steuerplatine</image-description> und weiter`
      )
    ).toBe("[image: Steuerplatine] und weiter");
  });

  it("rescues a marker the snippet cut open", () => {
    expect(
      compactImagesForSnippet(
        `Text ![a](${FULL})\n<image-description src="${FULL}">Steuerplatine mit Netz`
      )
    ).toBe("Text [image: Steuerplatine mit Netz]");
  });

  it("rescues a marker whose opening tag was cut away", () => {
    expect(
      compactImagesForSnippet(`Steuerplatine mit Netz</image-description> danach`)
    ).toBe("[image: Steuerplatine mit Netz] danach");
  });

  it("leaves an ordinary snippet untouched", () => {
    const snippet = "Urlaub wird über das Portal beantragt.";
    expect(compactImagesForSnippet(snippet)).toBe(snippet);
    expect(compactImagesForSnippet("")).toBe("");
  });

  it("leaves an external image alone", () => {
    const snippet = "siehe ![Logo](https://example.com/logo.png) oben";
    expect(compactImagesForSnippet(snippet)).toBe(snippet);
  });

  it("is much shorter than what it replaced", () => {
    const before = `![Schaltplan](${FULL})\n<image-description src="${FULL}">Steuerplatine</image-description>`;
    expect(compactImagesForSnippet(before).length).toBeLessThan(
      before.length / 3
    );
  });
});
