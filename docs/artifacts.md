# Artifacts (HTML pages in the wiki)

An artifact is a static web page, typically a Claude artifact: an
`index.html` plus optional scripts, styles, data, images and fonts that it
loads by **relative** path. A wiki page that carries an artifact shows it
full-size in a sandboxed frame instead of its text. Everything else is plain
page behaviour: its place in the tree, moving, visibility (personal / team /
organisation) and deleting.

## Publishing

- **UI:** Import → *Artifact (HTML)*, pick a ZIP or `.html`, choose the
  location. A new version is uploaded from the artifact page's toolbar
  (edit mode), which also offers full screen, open in new tab, ZIP download
  and removing the artifact (the page stays).
- **MCP:** `publish_artifact` with `files: [{ path, content, encoding? }]`,
  either a new page (`title`, `parentId` / `teamId` / `organisation`) or a new
  version (`pageId`).
- **API:** `POST /api/v1/tenant/:tenantId/wiki/:pageId/artifact` with a
  multipart `file` or JSON `{ files: [...] }`; `GET` returns the current
  version, the history and a content URL; `DELETE` removes it;
  `GET …/artifact/download` returns the ZIP.

## Bundle rules (checked on upload)

- `index.html` at the root (a single root `.html` also works; a ZIP of a
  folder is unpacked without that folder). A single `.html` upload becomes
  `index.html`.
- Relative paths only. `..`, absolute paths and backslashes are refused;
  references like `src="/app.js"` are reported as warnings, they would not
  load.
- Allowed types: html, css, js/mjs, json, map, txt, md, csv, tsv, xml, svg,
  png, jpg, gif, webp, avif, ico, woff/woff2/ttf/otf, mp3/wav/ogg, mp4/webm,
  pdf, wasm. Other files are skipped with a warning.
- At most 20 MB unpacked and 500 files. The last 5 versions are kept.

## Security model

Artifacts are arbitrary HTML/JS uploaded by anyone who may write the page,
served from the wiki's own origin. They must never run with the reader's
session. `GET /api/v1/artifact-content/<token>/<path>` therefore:

- sends `Content-Security-Policy: sandbox allow-scripts allow-forms
  allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads`
  — **without** `allow-same-origin`. The document gets an opaque origin
  (`null`): no cookies, no `localStorage`, no same-origin API access, also
  when the URL is opened directly in a tab. The session cookie (`SameSite=Lax`)
  is not sent with the artifact's requests (verified in Chromium).
- limits sources to its own files, inline code and cdnjs, jsDelivr, unpkg,
  cdn.tailwindcss.com, code.jquery.com and Google Fonts (`connect-src` alike);
- may only be framed by the wiki itself (and the Teams hosts);
- answers `Access-Control-Allow-Origin: *` — the opaque-origin document loads
  its own module scripts, fonts and `fetch()` targets cross-origin;
- sets `Referrer-Policy: no-referrer`, so the token does not leak to CDNs.

Access is the signed token in the path (HMAC over version id + expiry, 8 h),
minted only for a user who can read the page — like a presigned URL. The
frontend iframe carries the same `sandbox` flags.

## Limitations

- `window.claude.*` (claude.ai storage, "ask Claude", …) does not exist here;
  such artifacts run only partially (the upload check warns).
- `localStorage` / `sessionStorage` throw inside the sandbox.
- The artifact follows the system colour scheme, not the wiki's dark-mode
  toggle.
- Not yet shown on the public documentation site.
