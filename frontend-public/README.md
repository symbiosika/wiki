# frontend-public — public documentation site

Read-only secondary view of the wiki for published pages. No login, no
editor, no write paths — a documentation site, not a second app UI.

## Why a separate app

The main frontend is served under `/static/app/`, and in the backend `/static/*`
goes through `authOrRedirectToLogin`. Everything there is behind the login by
definition. This app therefore builds to `dist/public/docs/` and ends up in
`backend/public/`, which is served without authentication — the only
difference in how it is served, but a fundamental one.

The stack is correspondingly lean: Vue 3, Vue Router, Tailwind, `marked`.
No TipTap, no PrimeVue, no Pinia, no i18n.

## Visibility

The app decides **nothing** about visibility. It calls only
`/api/v1/public/wiki/:tenantId/…`; there the backend serves only pages
that have been released via `knowledgeText.publicMode` (inherited by
child pages, `"excluded"` as an escape hatch). A 404 means "not published
or does not exist" — the backend deliberately does not distinguish between the two cases,
and consequently neither does this app.

## Routing

Hash routes (`#/<slug>/page/<pageId>`), as in the main frontend. Reason:
the bundles are served as static files without an SPA fallback, so a
history-mode deep link would return 404 on reload.

The organisation appears in the URL as a readable slug (`#/acme-gmbh/…`). Slugs
are derived server-side from the organisation name, not stored —
resolving one is therefore a lookup (`GET …/public/wiki/by-slug/:slug`), and
a slug moves when an organisation is renamed. The tenant ID remains
canonical; the slug is only the entry point.

Pages keep their ID: titles are neither unique nor stable, and a
title-based page slug would break links on every rename.

Without an organisation in the URL, the entry page shows the publishing
organisations; if there is exactly one (the normal case), it redirects
directly. Nobody has to enter an ID.

## Appearance

Light/dark follows the operating system by default and can be pinned to light
or dark via the toggle in the header. Implemented via the
`.app-dark` class on `<html>` and the same localStorage key as the
main frontend (`wiki:theme`) — both apps run on the same origin, so the
choice applies to both.

**Branding.** Logo and primary colour come from the same source as in the
main frontend (the logo table and `tenant_settings` key `branding`, respectively), so that a
published page looks like the wiki it comes from. The colour is
not taken over raw: `src/brand.ts` derives a readable variant for each
appearance — a brand colour chosen for white would otherwise be unreadable on the dark
background, and vice versa. Invalid values fall back to the
default palette.

**Navigation width.** The tree can be resized via a handle between the sidebar and the
content (keyboard: left/right arrow; double-click resets). The
width is remembered per browser.

**Search.** Sits in the sidebar above the tree, as in the main frontend: while
something is entered, the results take the place of the tree, and the
content area keeps showing the page being read. There is therefore no
separate search page. Requests are debounced and the previous one is aborted — the
semantic part of the search generates an embedding per request.

## Content

`src/markdown.ts` does three things beyond plain Markdown:

1. **Sanitizing.** The content lands in the DOM via `v-html`; scripts,
   event handlers and dangerous URL schemes are removed beforehand.
2. **Rewriting images.** Pages embed images as
   `/files/db/knowledge/<uuid>.<ext>` — a path that requires `files:read`.
   Public readers have no scopes, so the images point to
   the page-scoped public endpoint.
3. **Wiki links.** `[[Title]]` becomes a real link **if** the target
   is published. Otherwise plain text: a dead link would reveal that
   an internal page exists.

## Development

```bash
bun install
bun run dev          # http://localhost:5174/docs/  (API proxy → :3000)
bun run test         # Vitest
bun run type-check
bun run build        # -> dist/public/docs/
```

`VITE_DEV_API_URL` overrides the proxy target (default `http://localhost:3000`).
