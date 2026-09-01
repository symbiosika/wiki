/**
 * Shared types for URL batch-import jobs (mirrors the backend app API).
 */

export type UrlImportRunStatus = 'running' | 'success' | 'partial' | 'error'
export type UrlImportUrlStatus = 'pending' | 'success' | 'error'

export interface UrlImportJob {
  id: string
  tenantId: string
  name: string
  /** 5-field Linux cron expression */
  cron: string
  enabled: boolean
  teamId: string | null
  tenantWide: boolean
  parentId: string | null
  createdBy: string | null
  lastRunId: string | null
  lastRunAt: string | null
  lastRunStatus: UrlImportRunStatus | null
  createdAt: string
  updatedAt: string
}

export interface UrlImportJobUrl {
  id: string
  jobId: string
  tenantId: string
  url: string
  title: string | null
  /**
   * Wiki subpath (category page titles, top→bottom) the imported page is filed
   * under, relative to the job's parent page. Empty = directly under the parent.
   */
  subPath: string[]
  sortOrder: number
  status: UrlImportUrlStatus
  lastError: string | null
  lastImportedAt: string | null
  knowledgeTextId: string | null
  createdAt: string
  updatedAt: string
}

export interface UrlImportRunResultItem {
  urlId: string
  url: string
  status: 'success' | 'error'
  error?: string
  knowledgeTextId?: string
  changed?: boolean
}

export interface UrlImportRun {
  id: string
  jobId: string
  tenantId: string
  trigger: 'manual' | 'scheduled'
  status: UrlImportRunStatus
  total: number
  succeeded: number
  failed: number
  startedBy: string | null
  results: UrlImportRunResultItem[]
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface UrlImportJobDetail {
  job: UrlImportJob
  urls: UrlImportJobUrl[]
  runs: UrlImportRun[]
}

/** Payload to create/update a job. */
export interface UrlImportJobInput {
  name: string
  cron: string
  enabled?: boolean
  teamId?: string | null
  tenantWide?: boolean
  parentId?: string | null
}
