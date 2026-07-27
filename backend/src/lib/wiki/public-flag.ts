/**
 * Operator switch for the whole public documentation surface.
 *
 * Publishing is already opt-in per page (`knowledgeText.publicMode` defaults to
 * inheriting, and nothing inherits "public" until someone sets it), so a fresh
 * installation exposes nothing. This flag sits above that: it lets an operator
 * guarantee that no page can become publicly readable on this instance, no
 * matter what anyone clicks in the admin UI.
 *
 * Switching it off does two things, and both are needed:
 *
 *   - the unauthenticated API routes are never registered, so the data is
 *     unreachable — this is the part that matters;
 *   - the documentation bundle is withheld from the public static folder, so
 *     there is no dead page left on the internet.
 *
 * Doing only the second would be theatre: the bundle is just a client, and
 * `curl` against the API does not need it.
 */

/**
 * Directory of the documentation bundle inside the public static folder. The
 * build writes it there (frontend-public/vite.config.ts), and the folder name
 * is also the URL prefix — `public/` is the serving root, not part of the URL.
 */
export const PUBLIC_WIKI_STATIC_DIR = "docs";

const TRUE_VALUES = new Set(["true", "1", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off", "disabled"]);

/**
 * Is the public documentation surface enabled? Defaults to on, because the
 * per-page opt-in already means nothing is published by accident.
 *
 * An unrecognised value is a hard error rather than a fallback. The fallback
 * would be "on", so a typo in the one variable an operator sets to keep pages
 * private would silently do the opposite of what they intended.
 */
export const isPublicWikiEnabled = (
  env: Record<string, string | undefined> = process.env
): boolean => {
  const raw = env.PUBLIC_WIKI_ENABLED;
  if (raw === undefined || raw === "") return true;

  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;

  throw new Error(
    `PUBLIC_WIKI_ENABLED must be one of ${[...TRUE_VALUES, ...FALSE_VALUES].join(
      ", "
    )} — got "${raw}". Refusing to guess: guessing wrong would publish pages ` +
      `that were meant to stay private.`
  );
};

/**
 * Subtrees to withhold from the public static folder, for the framework's
 * `staticPublicExclude`. Empty while the feature is on.
 */
export const publicWikiStaticExclusions = (
  env?: Record<string, string | undefined>
): string[] => (isPublicWikiEnabled(env) ? [] : [PUBLIC_WIKI_STATIC_DIR]);
