/**
 * Artifacts: uploaded HTML bundles (e.g. Claude artifacts) a wiki page shows
 * in a sandboxed iframe instead of its text. The backend serves the files with
 * a CSP `sandbox` under a short-lived token (backend lib/artifacts), so the
 * artifact never runs with the session or the API.
 */
import type { ArtifactInfo } from '@/types/wiki'
import { fetcher } from './fetcher'

/**
 * Sandbox flags of the artifact iframe. Same set as the backend's CSP
 * `sandbox` — and deliberately WITHOUT `allow-same-origin`, which would hand
 * the artifact the app origin (session cookie, API).
 */
export const ARTIFACT_IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-modals',
  'allow-downloads',
].join(' ')

/** File picker filter for an artifact upload. */
export const ARTIFACT_ACCEPT = '.zip,.html,.htm'

/** Whether a file can be uploaded as an artifact (ZIP or single HTML). */
export const isArtifactFile = (name: string): boolean =>
  /\.(zip|html?)$/i.test(name)

/** A readable page title from an upload's file name. */
export const artifactTitleFromFileName = (name: string): string =>
  name
    .replace(/\.(zip|html?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Absolute (same-origin) URL of the artifact's entry page. */
export const artifactContentUrl = (info: ArtifactInfo): string =>
  `/api/v1${info.contentPath}`

/** "1.2 MB" style size. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const artifactApi = (tenantId: string, pageId: string) =>
  `/api/v1/tenant/${tenantId}/wiki/${pageId}/artifact`

/** The page's artifact, or null when it carries none. */
export const fetchArtifact = async (
  tenantId: string,
  pageId: string,
): Promise<ArtifactInfo | null> => {
  const result = await fetcher.get<{ data: ArtifactInfo | null }>(
    artifactApi(tenantId, pageId),
  )
  return result.data
}

/** Upload a ZIP or HTML file as the page's newest artifact version. */
export const uploadArtifact = async (
  tenantId: string,
  pageId: string,
  file: File,
): Promise<ArtifactInfo> => {
  const form = new FormData()
  form.append('file', file)
  const result = await fetcher.postFormData<{ data: ArtifactInfo }>(
    artifactApi(tenantId, pageId),
    form,
  )
  return result.data
}

/** Remove the artifact (all versions); the page stays. */
export const deleteArtifact = (tenantId: string, pageId: string) =>
  fetcher.delete(artifactApi(tenantId, pageId))

/** Download a version (default: current) as ZIP. */
export const downloadArtifact = async (
  tenantId: string,
  pageId: string,
  fileName: string,
  versionId?: string,
): Promise<void> => {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
  const blob = await fetcher.getBlob(
    `${artifactApi(tenantId, pageId)}/download${query}`,
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
