/**
 * Sandboxed artifact content.
 *
 *   GET /artifact-content/:token/*path
 *
 * Unauthenticated on purpose: the artifact runs in an opaque (sandboxed)
 * origin and loads its own files without the session cookie, so the signed
 * token in the path IS the access check (lib/artifacts/token.ts). It is only
 * minted for a user who can read the page. Every response carries the sandbox
 * CSP and the other headers from lib/artifacts/serve.ts — that is what keeps
 * the artifact's code away from the app's session and API.
 *
 * Answers are deliberately uniform: a bad token, an unknown version and a
 * missing file all give the same plain 404.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import type { Context } from "hono";
import { verifyArtifactToken } from "../../../lib/artifacts/token";
import { getArtifactFile, ARTIFACT_CONTENT_ROUTE } from "../../../lib/artifacts/store";
import { artifactResponseHeaders } from "../../../lib/artifacts/serve";

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

export default function defineArtifactContentRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  const handler = async (c: Context) => {
    const token = c.req.param("token") ?? "";
    const versionId = verifyArtifactToken(token);
    if (!versionId) return notFound();

    // everything after `/<token>/` of the RAW path, decoded segment by segment
    const rawPath = new URL(c.req.url).pathname;
    const prefix = `${ARTIFACT_CONTENT_ROUTE}/${token}/`;
    const at = rawPath.indexOf(prefix);
    if (at < 0) return notFound();
    const rest = rawPath.slice(at + prefix.length);
    let path: string;
    try {
      path = rest.split("/").map(decodeURIComponent).join("/");
    } catch {
      return notFound();
    }

    const file = await getArtifactFile(versionId, path);
    if (!file) return notFound();
    const bytes = new Uint8Array(file.data);
    return new Response(bytes, {
      status: 200,
      headers: artifactResponseHeaders(file.contentType, bytes.byteLength),
    });
  };

  // without the trailing slash the entry page's relative references would
  // resolve one level too high — redirect into the bundle root
  app.get(`${API_BASE_PATH}${ARTIFACT_CONTENT_ROUTE}/:token`, (c) =>
    verifyArtifactToken(c.req.param("token"))
      ? c.redirect(`${new URL(c.req.url).pathname}/`, 302)
      : notFound()
  );
  app.get(`${API_BASE_PATH}${ARTIFACT_CONTENT_ROUTE}/:token/*`, handler);
}
