/**
 * Serving artifact files — the security boundary of the whole feature.
 *
 * An artifact is arbitrary HTML and JavaScript, uploaded by any user who may
 * write a page. Served from the app's own origin without precautions it would
 * run with the reader's session cookie and could call the API in their name.
 * Every response from the content route therefore carries:
 *
 *   - `Content-Security-Policy: sandbox …` WITHOUT `allow-same-origin`. The
 *     browser puts the document into an opaque origin — no cookies, no
 *     storage of the app origin, no same-origin API access — and does so even
 *     when the URL is opened directly in a tab, not only inside the wiki's
 *     `<iframe sandbox>`. Scripts, forms, popups and modals stay allowed: an
 *     artifact is an interactive page.
 *   - a source allowlist: own files, inline code, and the CDNs claude.ai
 *     artifacts are built against (cdnjs, jsDelivr, unpkg, Tailwind, jQuery,
 *     Google Fonts). Network calls (`connect-src`) are limited the same way.
 *   - `frame-ancestors`: only the wiki itself (also as a Teams tab) may embed it.
 *   - `Referrer-Policy: no-referrer`: the access token in the URL does not
 *     travel to the CDNs.
 *   - `nosniff`, and the content type from the bundle's allowlist.
 *   - `Access-Control-Allow-Origin: *`, because the opaque-origin document
 *     loads its own files cross-origin (see below).
 */

/** Hosts claude.ai artifacts load scripts/styles/fonts from. */
export const ARTIFACT_CDN_HOSTS = [
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdn.tailwindcss.com",
  "https://code.jquery.com",
];

/**
 * Who may embed an artifact: the wiki itself — and, because frame-ancestors
 * checks EVERY ancestor, the Microsoft Teams hosts the wiki runs in as a tab
 * (see docs/teams-app.md).
 */
const FRAME_ANCESTORS = [
  "'self'",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
  "https://teams.cloud.microsoft",
  "https://*.cloud.microsoft",
  "https://*.skype.com",
];

const GOOGLE_FONTS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

/** Sandbox flags — keep in sync with the iframe in the frontend's ArtifactView. */
export const ARTIFACT_SANDBOX_FLAGS = [
  "allow-scripts",
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-modals",
  "allow-downloads",
];

const cdn = ARTIFACT_CDN_HOSTS.join(" ");

export const ARTIFACT_CSP = [
  `sandbox ${ARTIFACT_SANDBOX_FLAGS.join(" ")}`,
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${cdn}`,
  `style-src 'self' 'unsafe-inline' ${cdn} ${GOOGLE_FONTS[0]}`,
  `font-src 'self' data: ${cdn} ${GOOGLE_FONTS[1]}`,
  `img-src 'self' data: blob: ${cdn}`,
  `media-src 'self' data: blob:`,
  `connect-src 'self' ${cdn}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`,
].join("; ");

/** Response headers of every artifact file. */
export const artifactResponseHeaders = (
  contentType: string,
  byteLength: number
): Record<string, string> => ({
  "Content-Type": contentType,
  "Content-Length": byteLength.toString(),
  "Content-Security-Policy": ARTIFACT_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // The sandboxed document has an opaque origin ("null"), so its own module
  // scripts, fonts and fetch() calls are CROSS-origin requests to this route.
  // They carry no credentials and the token already is the access check, so
  // any origin may read the file.
  "Access-Control-Allow-Origin": "*",
  // a version never changes and the token expires — cache within that window
  "Cache-Control": "private, max-age=3600",
});
