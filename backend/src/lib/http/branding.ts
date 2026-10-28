/**
 * Installation branding: the name, description and icon a deployment shows to
 * the outside world.
 *
 * The wiki is open source and runs under many names, so nothing here is
 * hard-coded. Everything comes from env vars:
 *
 *   APP_NAME              display name (default "Wiki")
 *   APP_DESCRIPTION       one-line description for link previews (optional)
 *   APP_ICON_URL          favicon / logo, absolute or root-relative (optional;
 *                         default: the neutral /favicon.png in the image)
 *   APP_PREVIEW_IMAGE_URL image for link previews (optional; default: the icon)
 *
 * Link previews (WhatsApp, Slack, Teams, iMessage, …) are rendered by crawlers
 * that read the HTML and never run JavaScript, so the name has to be in the
 * document the server sends. The HTML pages are static files, though — the SPA
 * bundle, the public docs bundle and the auth pages — and the framework serves
 * them before any app route could run. So, like the image cache headers next
 * to this file, the branding is applied by a wrapper around the whole server
 * `fetch` (see ../../index.ts): HTML responses get the name in `<title>` and
 * the Open Graph tags in `<head>`, and requests for the default favicon are
 * redirected to `APP_ICON_URL` when one is configured.
 */

export const DEFAULT_APP_NAME = "Wiki";

export type Branding = {
  appName: string;
  description?: string;
  /** Configured icon, as given (absolute or root-relative). */
  iconUrl?: string;
  /** Absolute URL of the preview image, when one can be built. */
  previewImageUrl?: string;
};

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Crawlers need absolute image URLs. A root-relative value is resolved against
 * BASE_URL; without a BASE_URL it cannot be, and the tag is left out.
 */
const absoluteUrl = (
  value: string,
  baseUrl: string | undefined
): string | undefined => {
  try {
    return new URL(value).toString();
  } catch {
    if (!baseUrl) return undefined;
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return undefined;
    }
  }
};

export const resolveBranding = (
  env: Record<string, string | undefined> = process.env
): Branding => {
  const baseUrl = clean(env.BASE_URL);
  const iconUrl = clean(env.APP_ICON_URL);
  const previewSource =
    clean(env.APP_PREVIEW_IMAGE_URL) ?? iconUrl ?? "/favicon.png";
  return {
    appName: clean(env.APP_NAME) ?? DEFAULT_APP_NAME,
    description: clean(env.APP_DESCRIPTION),
    iconUrl,
    previewImageUrl: absoluteUrl(previewSource, baseUrl),
  };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const decodeHtml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const TITLE = /<title(\s[^>]*)?>([\s\S]*?)<\/title>/i;

/**
 * The page title a document should carry. A `<title data-app-name>` is a
 * placeholder for the name itself (the SPA, the start page); any other title
 * names the page and gets the app name as a suffix — the same rule the auth
 * pages apply client-side in public/app-info.js, which then sees the name is
 * already there and leaves it.
 */
const brandedTitle = (
  attributes: string | undefined,
  current: string,
  appName: string
): string => {
  const text = decodeHtml(current).trim();
  if (/\bdata-app-name\b/i.test(attributes ?? "") || !text) return appName;
  if (text.includes(appName)) return text;
  return `${text} · ${appName}`;
};

/**
 * Puts the branding into an HTML document: the title, and a block of Open
 * Graph / Twitter tags right before `</head>`. A document without `<head>` is
 * returned unchanged.
 */
export const applyBrandingToHtml = (html: string, branding: Branding): string => {
  if (!/<\/head>/i.test(html)) return html;

  const match = html.match(TITLE);
  const title = brandedTitle(match?.[1], match?.[2] ?? "", branding.appName);
  // Function replacements throughout, so `$` in a configured value stays
  // literal.
  const result = match
    ? html.replace(TITLE, () => `<title${match[1] ?? ""}>${escapeHtml(title)}</title>`)
    : html;

  const tags: string[] = [
    `<meta name="application-name" content="${escapeHtml(branding.appName)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(branding.appName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
  ];
  if (branding.description) {
    const description = escapeHtml(branding.description);
    tags.push(
      `<meta name="description" content="${description}" />`,
      `<meta property="og:description" content="${description}" />`
    );
  }
  if (branding.previewImageUrl) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(branding.previewImageUrl)}" />`
    );
  }
  tags.push(`<meta name="twitter:card" content="summary" />`);

  return result.replace(/<\/head>/i, () => `    ${tags.join("\n    ")}\n  </head>`);
};

/**
 * Where the bundles ask for the default icon: the auth pages and the docs
 * bundle use the root one, the SPA its copy under its own base path.
 */
const DEFAULT_ICON_PATH = /^\/(?:static\/app\/)?favicon\.(?:png|ico)$/;

/**
 * Redirect for a default-icon request when an icon is configured, else `null`.
 * A configured icon that *is* such a path is served as is — redirecting to it
 * would loop.
 */
export const iconRedirectFor = (
  request: Request,
  branding: Branding
): Response | null => {
  if (!branding.iconUrl) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (!DEFAULT_ICON_PATH.test(url.pathname)) return null;
  const target = new URL(branding.iconUrl, url);
  if (target.origin === url.origin && DEFAULT_ICON_PATH.test(target.pathname)) {
    return null;
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      // short: the configured icon may change with the next deployment
      "Cache-Control": "public, max-age=300",
    },
  });
};

/** HTML responses that come from the static folders, not from the API. */
const isBrandableHtml = (request: Request, response: Response): boolean => {
  if (request.method !== "GET") return false;
  if (response.status !== 200) return false;
  if (!(response.headers.get("Content-Type") ?? "").includes("text/html")) {
    return false;
  }
  const { pathname } = new URL(request.url);
  return !pathname.startsWith("/api/") && !pathname.startsWith("/mcp");
};

type FetchLike = (
  request: Request,
  ...rest: unknown[]
) => Response | undefined | Promise<Response | undefined>;

export const withBranding =
  (inner: FetchLike, branding: Branding = resolveBranding()): FetchLike =>
  async (request, ...rest) => {
    const redirect = iconRedirectFor(request, branding);
    if (redirect) return redirect;

    const response = await inner(request, ...rest);
    // no response at all: a WebSocket upgrade
    if (!response || !isBrandableHtml(request, response)) return response;

    const html = applyBrandingToHtml(await response.text(), branding);
    const headers = new Headers(response.headers);
    // The body changed: length, and any validator derived from the file on
    // disk, no longer describe it — a 304 against them would keep a stale name.
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
