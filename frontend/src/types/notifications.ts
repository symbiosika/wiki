import type { WikiPage } from '@/types/wiki'
import type { StoredParserWarning } from '@/utils/parserWarnings'

/** Status of a background job (framework `jobs.status`). */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * A framework background job (`GET /tenant/:tenantId/jobs/:jobId`). Knowledge
 * ingestion (URL/PDF/file/text imports) now runs as a `knowledge:ingest` job;
 * the routes return this shape immediately instead of the finished entry.
 */
export interface Job<TResult = unknown> {
  id: string
  userId: string | null
  tenantId: string
  type: string
  status: JobStatus
  metadata: Record<string, unknown> | null
  result: TResult | null
  error: { message: string } | null
  scheduledAt: string | null
  createdAt: string
  updatedAt: string
}

/** Result payload of a `knowledge:ingest` job that imported a wiki page. */
export interface KnowledgeIngestResult {
  /** present for wiki-page imports (texts/import, texts/import-url) */
  knowledgeText?: WikiPage
  blocks?: unknown[]
  /**
   * Non-fatal notes the parsing service reported for the imported file. Each
   * carries a machine-readable `code` and the service's own `severity`, which
   * says whether content is missing (`incomplete`) or the document arrived
   * complete and merely has something to report (`note`). Plain strings are the
   * old wire format and count as `incomplete`; see `@/utils/parserWarnings`.
   */
  parserWarnings?: StoredParserWarning[]
  /** present for RAG knowledge entries (from-url, upload-and-extract, …) */
  id?: string
  ok?: boolean
}

/** Severity of a user notification (framework `message_type`). */
export type MessageType = 'info' | 'warning' | 'error' | 'success'

/**
 * Structured payload a job-completion notification carries so the UI can act
 * on it without parsing the message text.
 */
export interface NotificationMeta {
  jobId?: string
  jobType?: string
  status?: JobStatus
  error?: string
  [key: string]: unknown
}

/**
 * A user-facing message from the notification queue
 * (`GET /user/notifications`). `GET` returns only *unconfirmed* messages.
 */
export interface UserMessage {
  id: string
  userId: string
  message: string
  messageType: MessageType
  meta: NotificationMeta | null
  createdAt: string
  confirmedAt: string | null
}
