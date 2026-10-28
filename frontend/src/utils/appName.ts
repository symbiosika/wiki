/**
 * Display name of this installation (APP_NAME on the server).
 *
 * The server writes it into the `<title>` of index.html before the bundle
 * runs (backend/src/lib/http/branding.ts), so it is read from there once at
 * load — before App.vue starts replacing the title with the organisation's.
 * Falls back to a neutral "Wiki", e.g. on the Vite dev server.
 */
export const DEFAULT_APP_NAME = 'Wiki'

export const appNameFromTitle = (title: string | undefined | null): string =>
  title?.trim() || DEFAULT_APP_NAME

export const APP_NAME = appNameFromTitle(
  typeof document === 'undefined' ? undefined : document.title,
)
