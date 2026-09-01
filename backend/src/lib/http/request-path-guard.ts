/**
 * Drop requests whose path contains a NUL byte, before anything looks at it.
 *
 * These are not our bugs and not a user's mistake: they are vulnerability
 * scanners walking the usual path-traversal list, e.g.
 *
 *   GET /file%3a///////etc/passwd%00
 *   GET /file%3a///////etc%2fpasswd%00.jpg
 *
 * The public static mount hands the (percent-decoded) path to Bun.file(), and
 * Bun — like Node — refuses a path containing a NUL byte by throwing
 * `TypeError: The argument 'path' must be a string, Uint8Array, or URL without
 * null bytes`. Thrown from inside the static handler, that reaches the global
 * error boundary, which logs it at ERROR with a stack trace and answers 500.
 *
 * So every scanner hit costs a stack trace in the logs and a 500 on the wire.
 * Both are wrong: nothing is broken, and a 500 tells the scanner it found
 * something interesting. The trailing `%00` is precisely the trick meant to
 * make a naive server truncate the name — a request carrying one is malformed
 * and cannot be satisfied by any file, so it is refused here rather than
 * turned into an exception four layers down.
 *
 * The check sits in front of the whole app (see ../../index.ts) instead of
 * being a Hono middleware, so it also covers the static mounts, which are
 * registered inside the framework and cannot be reached from here.
 */

/**
 * Is this request path unserveable — i.e. does it carry a NUL byte, literally
 * or percent-encoded?
 *
 * Only the path is considered. A NUL in the query string never reaches the
 * filesystem, and rejecting it would be a different (and unrequested) policy.
 * `%2500` is not a match: it decodes to the four characters `%00`, which is a
 * legal, if silly, filename — the static handler decodes exactly once, so this
 * check does too.
 */
export const hasNulByteInPath = (url: string): boolean => {
  const path = pathOf(url);
  if (path.includes("\0")) return true;

  // A hex escape has no case variants for "00", but the "%" may be part of a
  // longer malformed sequence, so decode and look at the result as well.
  if (path.includes("%00")) return true;

  try {
    return decodeURIComponent(path).includes("\0");
  } catch {
    // Undecodable escapes are somebody else's problem: an unserveable path is
    // what this function reports, and a malformed escape is not one.
    return false;
  }
};

/**
 * The path portion of a raw request URL, without parsing it.
 *
 * `new URL()` would percent-decode nothing but does throw on some of the very
 * inputs this guard exists for, so the string is cut by hand: everything after
 * the authority, up to the first `?` or `#`.
 */
const pathOf = (url: string): string => {
  const schemeEnd = url.indexOf("://");
  const pathStart =
    schemeEnd === -1 ? 0 : url.indexOf("/", schemeEnd + "://".length);
  if (pathStart === -1) return "";

  const path = url.slice(pathStart);
  const queryStart = path.search(/[?#]/);
  return queryStart === -1 ? path : path.slice(0, queryStart);
};
