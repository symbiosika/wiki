/**
 * Artifact routes — an uploaded HTML bundle (e.g. a Claude artifact) shown by
 * a wiki page in a sandboxed iframe.
 *
 *   GET    /tenant/:tenantId/wiki/:pageId/artifact           current version, history, content URL
 *   POST   /tenant/:tenantId/wiki/:pageId/artifact           upload a new version (ZIP / .html / JSON files)
 *   DELETE /tenant/:tenantId/wiki/:pageId/artifact           remove the artifact (the page stays)
 *   GET    /tenant/:tenantId/wiki/:pageId/artifact/download  the bundle as ZIP (?versionId=…)
 *
 * Access follows the page (read → view, write → upload/remove), enforced in
 * lib/artifacts/store.ts. The files themselves are served by the token-based
 * content route (routes/public/artifact-content), never from here.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { validateScope } from "@framework/lib/utils/validate-scope";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  ArtifactBundleError,
  MAX_ARTIFACT_TOTAL_BYTES,
  bundleFromEntries,
  bundleFromUpload,
  type ArtifactBundle,
} from "../../../../lib/artifacts/bundle";
import {
  buildArtifactZip,
  deleteArtifact,
  getArtifactInfo,
  publishArtifactVersion,
} from "../../../../lib/artifacts/store";
import { attachmentDisposition } from "../../../../lib/wiki/page-files";

const pageParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  pageId: v.pipe(v.string(), v.uuid()),
});

/** JSON upload: the files of the bundle, text or base64. */
const jsonUploadSchema = v.object({
  files: v.pipe(
    v.array(
      v.object({
        path: v.pipe(v.string(), v.minLength(1)),
        content: v.string(),
        encoding: v.optional(v.picklist(["utf8", "base64"])),
      })
    ),
    v.minLength(1)
  ),
  sourceName: v.optional(v.string()),
});

const isAccessError = (message: string) =>
  message.includes("not found") || message.includes("access denied");

/** Map a store/bundle error to the response every route here answers with. */
const errorResponse = (error: unknown, fallback: string) => {
  if (error instanceof ArtifactBundleError) {
    return { body: { success: false, error: error.message }, status: error.status };
  }
  const message = error instanceof Error ? error.message : fallback;
  if (isAccessError(message)) {
    return { body: { success: false, error: message }, status: 404 as const };
  }
  if (message.includes("no write access")) {
    return { body: { success: false, error: message }, status: 403 as const };
  }
  return { body: { success: false, error: fallback }, status: 500 as const };
};

export default function defineArtifactRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/wiki/:pageId/artifact`;

  app.get(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["artifacts"],
      summary: "Get the artifact of a wiki page (null when it carries none)",
      responses: { 200: { description: "Artifact info with a content URL" } },
    }),
    validateScope("knowledge:read"),
    validator("param", pageParam),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      const userId = c.get("usersId");
      try {
        const info = await getArtifactInfo(pageId, { tenantId, userId });
        return c.json({ success: true, data: info });
      } catch (error) {
        const { body, status } = errorResponse(error, "Failed to load the artifact");
        return c.json(body, status);
      }
    }
  );

  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["artifacts"],
      summary:
        "Upload a new artifact version: multipart `file` (ZIP or .html) or JSON `{ files: [{ path, content, encoding? }] }`",
      responses: { 200: { description: "The updated artifact info" } },
    }),
    validateScope("knowledge:write"),
    validator("param", pageParam),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      const userId = c.get("usersId");
      try {
        let bundle: ArtifactBundle;
        let sourceName: string | null = null;
        const contentType = c.req.header("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const body = v.safeParse(jsonUploadSchema, await c.req.json());
          if (!body.success) {
            return c.json(
              { success: false, error: body.issues[0]?.message ?? "Invalid body" },
              400
            );
          }
          bundle = bundleFromEntries(body.output.files);
          sourceName = body.output.sourceName ?? null;
        } else {
          const form = await c.req.formData();
          const file = form.get("file");
          if (!(file instanceof File)) {
            return c.json({ success: false, error: "Missing 'file' form field" }, 400);
          }
          // the ZIP itself may not be larger than what it may unpack to
          if (file.size > MAX_ARTIFACT_TOTAL_BYTES) {
            throw new ArtifactBundleError(
              `Upload too large (at most ${MAX_ARTIFACT_TOTAL_BYTES / (1024 * 1024)} MB)`,
              413
            );
          }
          bundle = bundleFromUpload(file.name, new Uint8Array(await file.arrayBuffer()));
          sourceName = file.name || null;
        }
        const info = await publishArtifactVersion(pageId, bundle, {
          tenantId,
          userId,
          sourceName,
        });
        return c.json({ success: true, data: info });
      } catch (error) {
        const { body, status } = errorResponse(error, "Failed to store the artifact");
        return c.json(body, status);
      }
    }
  );

  app.delete(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["artifacts"],
      summary: "Remove the artifact (all versions) from a wiki page",
      responses: { 200: { description: "Removed" } },
    }),
    validateScope("knowledge:write"),
    validator("param", pageParam),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      const userId = c.get("usersId");
      try {
        const deleted = await deleteArtifact(pageId, { tenantId, userId });
        if (!deleted) {
          return c.json({ success: false, error: "The page carries no artifact" }, 404);
        }
        return c.json({ success: true });
      } catch (error) {
        const { body, status } = errorResponse(error, "Failed to remove the artifact");
        return c.json(body, status);
      }
    }
  );

  app.get(
    `${base}/download`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["artifacts"],
      summary: "Download an artifact version as ZIP (default: current)",
      responses: { 200: { description: "application/zip" } },
    }),
    validateScope("knowledge:read"),
    validator("param", pageParam),
    validator(
      "query",
      v.object({ versionId: v.optional(v.pipe(v.string(), v.uuid())) })
    ),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      const { versionId } = c.req.valid("query");
      const userId = c.get("usersId");
      try {
        const zip = await buildArtifactZip(pageId, { tenantId, userId }, versionId);
        if (!zip) {
          return c.json({ success: false, error: "Artifact version not found" }, 404);
        }
        return new Response(zip.bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Length": zip.bytes.byteLength.toString(),
            "Content-Disposition": attachmentDisposition(zip.name),
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        const { body, status } = errorResponse(error, "Failed to build the download");
        return c.json(body, status);
      }
    }
  );
}
