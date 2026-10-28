import { describe, expect, test } from "bun:test";
import {
  applyBrandingToHtml,
  DEFAULT_APP_NAME,
  iconRedirectFor,
  resolveBranding,
  withBranding,
  type Branding,
} from "./branding";

const page = (title: string) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${title}</head><body></body></html>`;

describe("resolveBranding", () => {
  test("is neutral without any configuration", () => {
    const branding = resolveBranding({});
    expect(branding.appName).toBe(DEFAULT_APP_NAME);
    expect(branding.description).toBeUndefined();
    expect(branding.iconUrl).toBeUndefined();
    // no BASE_URL: a relative image cannot be made absolute for crawlers
    expect(branding.previewImageUrl).toBeUndefined();
  });

  test("reads the env vars and resolves the preview image against BASE_URL", () => {
    const branding = resolveBranding({
      APP_NAME: "  Acme Knowledge ",
      APP_DESCRIPTION: "All we know",
      APP_ICON_URL: "/brand/icon.png",
      BASE_URL: "https://wiki.acme.test",
    });
    expect(branding).toEqual({
      appName: "Acme Knowledge",
      description: "All we know",
      iconUrl: "/brand/icon.png",
      previewImageUrl: "https://wiki.acme.test/brand/icon.png",
    });
  });

  test("defaults the preview image to the bundled favicon", () => {
    expect(
      resolveBranding({ BASE_URL: "https://wiki.acme.test" }).previewImageUrl
    ).toBe("https://wiki.acme.test/favicon.png");
  });

  test("prefers an explicit preview image over the icon", () => {
    expect(
      resolveBranding({
        APP_ICON_URL: "https://cdn.acme.test/icon.png",
        APP_PREVIEW_IMAGE_URL: "https://cdn.acme.test/preview.png",
      }).previewImageUrl
    ).toBe("https://cdn.acme.test/preview.png");
  });

  test("treats empty values as unset", () => {
    expect(resolveBranding({ APP_NAME: "  " }).appName).toBe(DEFAULT_APP_NAME);
  });
});

describe("applyBrandingToHtml", () => {
  const branding: Branding = {
    appName: "Acme Wiki",
    description: 'Says "hi" & more',
    previewImageUrl: "https://wiki.acme.test/favicon.png",
  };

  test("replaces a data-app-name title with the name", () => {
    const html = applyBrandingToHtml(page("<title data-app-name>Wiki</title>"), branding);
    expect(html).toContain("<title data-app-name>Acme Wiki</title>");
    expect(html).toContain('<meta property="og:title" content="Acme Wiki" />');
  });

  test("suffixes a page title with the name", () => {
    const html = applyBrandingToHtml(page("<title>Anmeldung</title>"), branding);
    expect(html).toContain("<title>Anmeldung · Acme Wiki</title>");
  });

  test("does not suffix twice", () => {
    const html = applyBrandingToHtml(page("<title>Acme Wiki</title>"), branding);
    expect(html).toContain("<title>Acme Wiki</title>");
  });

  test("adds the link-preview tags, escaped", () => {
    const html = applyBrandingToHtml(page("<title>Docs</title>"), branding);
    expect(html).toContain('<meta property="og:site_name" content="Acme Wiki" />');
    expect(html).toContain(
      '<meta property="og:description" content="Says &quot;hi&quot; &amp; more" />'
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://wiki.acme.test/favicon.png" />'
    );
    expect(html.indexOf("og:site_name")).toBeLessThan(html.indexOf("</head>"));
  });

  test("escapes the name in the title", () => {
    const html = applyBrandingToHtml(page("<title data-app-name>x</title>"), {
      appName: "<b>$&</b>",
    });
    expect(html).toContain("<title data-app-name>&lt;b&gt;$&amp;&lt;/b&gt;</title>");
    expect(html).not.toContain("<b>");
  });

  test("leaves documents without a head alone", () => {
    expect(applyBrandingToHtml("<p>fragment</p>", branding)).toBe("<p>fragment</p>");
  });
});

describe("iconRedirectFor", () => {
  const withIcon: Branding = {
    appName: "Acme",
    iconUrl: "https://cdn.acme.test/icon.png",
  };

  test("redirects the default icons when an icon is configured", () => {
    for (const path of ["/favicon.png", "/favicon.ico", "/static/app/favicon.png"]) {
      const response = iconRedirectFor(new Request(`https://wiki.test${path}`), withIcon);
      expect(response?.status).toBe(302);
      expect(response?.headers.get("Location")).toBe("https://cdn.acme.test/icon.png");
    }
  });

  test("does nothing without a configured icon or for other paths", () => {
    expect(
      iconRedirectFor(new Request("https://wiki.test/favicon.png"), { appName: "x" })
    ).toBeNull();
    expect(
      iconRedirectFor(new Request("https://wiki.test/images/favicon.png"), withIcon)
    ).toBeNull();
  });

  test("never redirects to itself", () => {
    expect(
      iconRedirectFor(new Request("https://wiki.test/favicon.png"), {
        appName: "x",
        iconUrl: "/static/app/favicon.png",
      })
    ).toBeNull();
  });
});

describe("withBranding", () => {
  const branding: Branding = { appName: "Acme Wiki" };

  test("brands static HTML and drops validators", async () => {
    const fetch = withBranding(
      () =>
        new Response(page("<title data-app-name>Wiki</title>"), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ETag: '"abc"',
            "Last-Modified": "Mon, 01 Jan 2024 00:00:00 GMT",
          },
        }),
      branding
    );
    const response = (await fetch(new Request("https://wiki.test/static/app/")))!;
    expect(await response.text()).toContain("<title data-app-name>Acme Wiki</title>");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Last-Modified")).toBeNull();
  });

  test("leaves API responses and non-HTML alone", async () => {
    const original = new Response(page("<title>x</title>"), {
      headers: { "Content-Type": "text/html" },
    });
    const fetch = withBranding(() => original, branding);
    expect(await fetch(new Request("https://wiki.test/api/v1/x"))).toBe(original);

    const json = Response.json({ ok: true });
    expect(await withBranding(() => json, branding)(new Request("https://wiki.test/"))).toBe(
      json
    );
  });

  test("passes a WebSocket upgrade (no response) through", async () => {
    const fetch = withBranding(() => undefined, branding);
    expect(await fetch(new Request("https://wiki.test/ws"))).toBeUndefined();
  });
});
