/**
 * Fills the app name into the static auth pages.
 *
 * The name is served by the public `GET /api/v1/app-info` endpoint (backed by
 * the APP_NAME env var), so the pages never hard-code it. Every element with a
 * `data-app-name` attribute receives the name as its text content, and the
 * document title gets it as a suffix.
 *
 * Fails silently: without a name the brand element stays empty (and hidden via
 * `.brand-name:empty`), so the pages keep working.
 */
(async () => {
  try {
    const response = await fetch('/api/v1/app-info', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;

    const { appName } = await response.json();
    if (!appName || typeof appName !== 'string') return;

    document.querySelectorAll('[data-app-name]').forEach((el) => {
      el.textContent = appName;
    });

    if (document.title && !document.title.includes(appName)) {
      document.title = `${document.title} · ${appName}`;
    } else if (!document.title) {
      document.title = appName;
    }
  } catch (error) {
    /* offline or endpoint unavailable – the pages work without the name */
  }
})();
