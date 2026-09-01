/**
 * Organisation logo — org-scoped storage of a single logo image.
 *
 * The framework's `tenants` table lives in the submodule and can't be extended
 * from the app, so the logo is kept in an app-side table keyed 1:1 by the
 * organisation id (see db/schema.ts). Every read and write is scoped by
 * `tenantId`, so one tenant can never read or overwrite another's logo.
 *
 * The image is expected to be cropped to the header aspect ratio on the client
 * before upload; here we only enforce a hard size cap as a safety net.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { organisationLogos } from "../../db/schema";

/** Hard cap on the stored image (post-crop it is far smaller than this). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export interface OrganisationLogoFile {
  file: File;
  contentType: string;
  fileName: string;
}

const nowIso = () => new Date().toISOString();

/**
 * Insert or replace the logo of an organisation.
 */
export const upsertOrganisationLogo = async (
  tenantId: string,
  file: File
): Promise<void> => {
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("File is too large");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await getDb()
    .insert(organisationLogos)
    .values({
      tenantId,
      image: buffer,
      contentType: file.type,
      fileName: file.name,
    })
    .onConflictDoUpdate({
      target: organisationLogos.tenantId,
      set: {
        image: buffer,
        contentType: file.type,
        fileName: file.name,
        updatedAt: nowIso(),
      },
    });
};

/**
 * Get the logo of an organisation. Throws when none is set.
 */
export const getOrganisationLogo = async (
  tenantId: string
): Promise<OrganisationLogoFile> => {
  const rows = await getDb()
    .select()
    .from(organisationLogos)
    .where(eq(organisationLogos.tenantId, tenantId))
    .limit(1);

  const row = rows[0];
  if (!row || !row.image) {
    throw new Error("Logo not found");
  }

  const file = new File([new Uint8Array(row.image)], row.fileName, {
    type: row.contentType,
  });
  return { file, contentType: row.contentType, fileName: row.fileName };
};

/**
 * Lightweight existence + cache-busting metadata. Never returns the bytes, so
 * the frontend can cheaply decide whether to render a logo and with which
 * `?v=` cache buster.
 */
export const getOrganisationLogoInfo = async (
  tenantId: string
): Promise<{ exists: boolean; updatedAt: string | null }> => {
  const rows = await getDb()
    .select({ updatedAt: organisationLogos.updatedAt })
    .from(organisationLogos)
    .where(eq(organisationLogos.tenantId, tenantId))
    .limit(1);

  const row = rows[0];
  return { exists: !!row, updatedAt: row?.updatedAt ?? null };
};

/**
 * Remove the logo of an organisation. Returns true when a row was deleted.
 */
export const deleteOrganisationLogo = async (
  tenantId: string
): Promise<boolean> => {
  const deleted = await getDb()
    .delete(organisationLogos)
    .where(eq(organisationLogos.tenantId, tenantId))
    .returning({ tenantId: organisationLogos.tenantId });
  return deleted.length > 0;
};
