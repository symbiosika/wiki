/**
 * Long-lived browser caching for the images embedded in wiki pages.
 *
 * A page embeds its images as `/api/v1/tenant/<t>/files/db/<bucket>/<uuid>.<ext>`
 * (see framework `lib/storage/db.ts`, `saveFileToDb`). The framework's file
 * route answers those with the bytes and nothing else: no `Cache-Control`, no
 * `ETag`, no `Last-Modified`. Without any validator a browser cannot even cache
 * the response heuristically, so every visit to a page downloads every one of
 * its images again. On a large page (hundreds of screenshots, each stored at
 * its original size) that is the whole load time: the requests queue behind
 * the browser's per-host connection limit while the server answers each one
 * quickly.
 *
 * The content behind such a path never changes — the id is a fresh UUID per
 * upload and a file is never rewritten in place — so it can be cached for as
 * long as the browser likes. `private` keeps shared caches (a proxy, a CDN)
 * out of it: the route is authenticated and the same URL is forbidden to
 * someone else. `immutable` spares the revalidation request a reload would
 * otherwise send for every image.
 *
 * Only the two buckets a page is built from are touched (the ones the wiki's
 * own image route reads, see ../wiki/images.ts): anything else served through
 * the generic file route keeps whatever caching policy it has today.
 *
 * This is a wrapper around the whole server `fetch` (see ../../index.ts) rather
 * than a Hono middleware, for the same reason as the NUL-byte guard next to it:
 * the framework registers its file route before the app's own routes, so a
 * middleware added from here would never run for those paths.
 */
/**
 * The buckets a page's images live in: uploads through the block editor
 * ("knowledge", framework `KNOWLEDGE_FILES_BUCKET`) and the pictures a parsing
 * service extracted from an imported document ("images", framework
 * `PARSED_IMAGES_BUCKET`). The same pair as `PAGE_IMAGE_BUCKETS` in
 * ../wiki/images.ts, spelled out here because that module — through the
 * framework constants — opens the database connection on import, and a
 * header decision must stay importable without one. The test next to
 * ../wiki/images.ts keeps the two lists in step.
 */
export const PAGE_IMAGE_CACHE_BUCKETS = ["knowledge", "images"] as const;

/** One year, the conventional upper bound for `max-age`. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * The header value for an image that is addressed by content-unique id and
 * gated by authentication. Exported so the wiki's page-scoped image route can
 * answer with the same policy.
 */
export const IMMUTABLE_PRIVATE_IMAGE_CACHE_CONTROL = `private, max-age=${ONE_YEAR_SECONDS}, immutable`;

/**
 * `/api/v1/tenant/<uuid>/files/db/<page image bucket>/<uuid>.<ext>` — the exact
 * shape `saveFileToDb` hands out for a page image, and nothing wider: the
 * bucket list is the guard against caching a file whose content could change.
 */
const PAGE_IMAGE_PATH = new RegExp(
  "^/api/v1/tenant/[0-9a-f-]{36}/files/db/" +
    `(?:${PAGE_IMAGE_CACHE_BUCKETS.join("|")})/` +
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{1,8}$",
  "i",
);

/**
 * The `Cache-Control` a response deserves, or `null` when it should be left
 * alone.
 *
 * Deliberately conservative: only a successful, complete answer to a read
 * request whose body is an image, on a page-image path, and only when the
 * server did not set a policy of its own — a header that is already there is a
 * decision made closer to the data, and this wrapper does not overrule it.
 */
export const imageCacheControlFor = (
  request: Request,
  response: Response,
): string | null => {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (response.status !== 200) return null;
  if (response.headers.has("Cache-Control")) return null;
  if (
    !(response.headers.get("Content-Type") ?? "")
      .toLowerCase()
      .startsWith("image/")
  ) {
    return null;
  }

  let path: string;
  try {
    path = new URL(request.url).pathname;
  } catch {
    return null;
  }
  if (!PAGE_IMAGE_PATH.test(path)) return null;

  return IMMUTABLE_PRIVATE_IMAGE_CACHE_CONTROL;
};

/** The shape of Bun's `fetch` handler, as the diagnostics wrapper sees it. */
type FetchLike = (
  request: Request,
  ...rest: unknown[]
) => Response | undefined | Promise<Response | undefined>;

/**
 * Wrap a server `fetch` so page-image responses carry the cache header above.
 *
 * The response is rebuilt rather than mutated: a `Response` whose headers are
 * immutable (one that came out of `fetch`, or one Hono has frozen) would throw
 * on `headers.set`, and the body stream is handed over untouched either way.
 * Every other response is returned as-is, so the wrapper costs nothing on the
 * requests it does not apply to.
 */
export const withImageCacheHeaders =
  (inner: FetchLike): FetchLike =>
  async (request, ...rest) => {
    const response = await inner(request, ...rest);
    if (!response) return response;

    const cacheControl = imageCacheControlFor(request, response);
    if (!cacheControl) return response;

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", cacheControl);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
