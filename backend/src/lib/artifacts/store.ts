/**
 * Artifact versions of a wiki page: storing, listing, removing, and reading
 * single files for the sandboxed content route.
 *
 * Access follows the page: whoever can READ the page sees the artifact (and
 * gets a content URL), whoever can WRITE it may upload a new version or
 * remove the artifact. The content route itself (./serve.ts) is token-based —
 * the token is minted here, behind that read check.
 *
 * Files live in Postgres (`bytea`) like the organisation logo and page
 * downloads; the limits in ./bundle.ts keep a bundle small enough for that,
 * and only the newest MAX_KEPT_VERSIONS versions of a page are kept.
 */
import { and, desc, eq, notInArray } from "drizzle-orm";
import { zipSync } from "fflate";
import { getDb } from "@framework/lib/db/db-connection";
import {
  checkKnowledgeTextWritePermission,
  getKnowledgeTextById,
} from "@framework/lib/knowledge/knowledge-texts";
import { artifactFiles, artifactVersions } from "../../db/schema";
import type { ArtifactBundle } from "./bundle";
import { createArtifactToken } from "./token";

/** Versions kept per page; older ones are deleted on upload. */
export const MAX_KEPT_VERSIONS = 5;

/** Files per INSERT statement when storing a bundle. */
const FILE_INSERT_BATCH = 50;

/** Mount point of the content route below the API base path. */
export const ARTIFACT_CONTENT_ROUTE = "/artifact-content";

type AccessContext = { tenantId: string; userId: string };

export type ArtifactVersionSummary = {
  id: string;
  version: number;
  entryPath: string;
  fileCount: number;
  totalBytes: number;
  warnings: string[];
  sourceName: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type ArtifactInfo = {
  pageId: string;
  current: ArtifactVersionSummary;
  versions: ArtifactVersionSummary[];
  /**
   * Path (below the API base, e.g. `/api/v1`) of the current version's entry
   * page, carrying a fresh access token. Valid for a few hours.
   */
  contentPath: string;
};

const toSummary = (
  row: typeof artifactVersions.$inferSelect
): ArtifactVersionSummary => ({
  id: row.id,
  version: row.version,
  entryPath: row.entryPath,
  fileCount: row.fileCount,
  totalBytes: row.totalBytes,
  warnings: row.warnings ?? [],
  sourceName: row.sourceName ?? null,
  createdBy: row.createdBy ?? null,
  createdAt: row.createdAt,
});

/** The content path of a version's entry page (token included). */
export const artifactContentPath = (
  versionId: string,
  entryPath: string
): string =>
  `${ARTIFACT_CONTENT_ROUTE}/${createArtifactToken(versionId)}/` +
  entryPath.split("/").map(encodeURIComponent).join("/");

const listVersionRows = async (tenantId: string, pageId: string) =>
  getDb()
    .select()
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.tenantId, tenantId),
        eq(artifactVersions.pageId, pageId)
      )
    )
    .orderBy(desc(artifactVersions.version));

/**
 * The artifact of a page, or null when the page carries none. Throws "not
 * found or access denied" when the caller cannot read the page.
 */
export async function getArtifactInfo(
  pageId: string,
  context: AccessContext
): Promise<ArtifactInfo | null> {
  await getKnowledgeTextById(pageId, context);
  const rows = await listVersionRows(context.tenantId, pageId);
  if (rows.length === 0) return null;
  const versions = rows.map(toSummary);
  const current = versions[0]!;
  return {
    pageId,
    current,
    versions,
    contentPath: artifactContentPath(current.id, current.entryPath),
  };
}

/**
 * Store a bundle as the page's newest artifact version. The caller must be
 * able to read AND write the page.
 */
export async function publishArtifactVersion(
  pageId: string,
  bundle: ArtifactBundle,
  context: AccessContext & { sourceName?: string | null }
): Promise<ArtifactInfo> {
  const page = await getKnowledgeTextById(pageId, context);
  await checkKnowledgeTextWritePermission(page, context);

  const previous = await listVersionRows(context.tenantId, pageId);
  const version = (previous[0]?.version ?? 0) + 1;

  // No transaction (the PGlite dev/test database runs on a single
  // connection): if storing the files fails, the version row is removed again
  // so a page never shows a version without its files.
  const [created] = await getDb()
    .insert(artifactVersions)
    .values({
      tenantId: context.tenantId,
      pageId,
      version,
      entryPath: bundle.entryPath,
      fileCount: bundle.files.length,
      totalBytes: bundle.totalBytes,
      warnings: bundle.warnings,
      sourceName: context.sourceName ?? null,
      createdBy: context.userId,
    })
    .returning();

  try {
    for (let i = 0; i < bundle.files.length; i += FILE_INSERT_BATCH) {
      await getDb()
        .insert(artifactFiles)
        .values(
          bundle.files.slice(i, i + FILE_INSERT_BATCH).map((file) => ({
            tenantId: context.tenantId,
            versionId: created!.id,
            path: file.path,
            contentType: file.contentType,
            size: file.data.byteLength,
            data: Buffer.from(file.data),
          }))
        );
    }
  } catch (error) {
    await getDb()
      .delete(artifactVersions)
      .where(eq(artifactVersions.id, created!.id));
    throw error;
  }

  // keep the newest versions only (files cascade)
  const keep = [created!.id, ...previous.map((row) => row.id)].slice(
    0,
    MAX_KEPT_VERSIONS
  );
  await getDb()
    .delete(artifactVersions)
    .where(
      and(
        eq(artifactVersions.tenantId, context.tenantId),
        eq(artifactVersions.pageId, pageId),
        notInArray(artifactVersions.id, keep)
      )
    );

  return (await getArtifactInfo(pageId, context))!;
}

/**
 * Remove the artifact (all versions) from a page; the page stays. Returns
 * false when the page carried none.
 */
export async function deleteArtifact(
  pageId: string,
  context: AccessContext
): Promise<boolean> {
  const page = await getKnowledgeTextById(pageId, context);
  await checkKnowledgeTextWritePermission(page, context);
  const deleted = await getDb()
    .delete(artifactVersions)
    .where(
      and(
        eq(artifactVersions.tenantId, context.tenantId),
        eq(artifactVersions.pageId, pageId)
      )
    )
    .returning({ id: artifactVersions.id });
  return deleted.length > 0;
}

/**
 * The ZIP of one version (default: the current one) for download, or null
 * when the page carries no such version.
 */
export async function buildArtifactZip(
  pageId: string,
  context: AccessContext,
  versionId?: string
): Promise<{ name: string; bytes: Uint8Array } | null> {
  const page = await getKnowledgeTextById(pageId, context);
  const rows = await listVersionRows(context.tenantId, pageId);
  const row = versionId ? rows.find((r) => r.id === versionId) : rows[0];
  if (!row) return null;

  const files = await getDb()
    .select({ path: artifactFiles.path, data: artifactFiles.data })
    .from(artifactFiles)
    .where(eq(artifactFiles.versionId, row.id));
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.path] = new Uint8Array(file.data);

  const base =
    (page.title || "artifact").replace(/[^\p{L}\p{N}._ -]+/gu, "").trim() ||
    "artifact";
  return { name: `${base} v${row.version}.zip`, bytes: zipSync(entries) };
}

/**
 * One file of a version for the content route. An empty path means the entry
 * page. Null when there is no such version or file.
 */
export async function getArtifactFile(
  versionId: string,
  path: string
): Promise<{ contentType: string; data: Buffer } | null> {
  let filePath = path;
  if (!filePath) {
    const [version] = await getDb()
      .select({ entryPath: artifactVersions.entryPath })
      .from(artifactVersions)
      .where(eq(artifactVersions.id, versionId))
      .limit(1);
    if (!version) return null;
    filePath = version.entryPath;
  }
  const [file] = await getDb()
    .select({ contentType: artifactFiles.contentType, data: artifactFiles.data })
    .from(artifactFiles)
    .where(
      and(eq(artifactFiles.versionId, versionId), eq(artifactFiles.path, filePath))
    )
    .limit(1);
  return file ?? null;
}

/**
 * Which pages of a tenant carry an artifact (for the sidebar icon). Not
 * filtered by visibility: the caller intersects it with the pages it shows.
 * Artifact pages are few, so this stays cheaper than an IN list of every
 * page id of the tree.
 */
export async function getArtifactPageIds(tenantId: string): Promise<Set<string>> {
  const rows = await getDb()
    .selectDistinct({ pageId: artifactVersions.pageId })
    .from(artifactVersions)
    .where(eq(artifactVersions.tenantId, tenantId));
  return new Set(rows.map((row) => row.pageId));
}
