/** A tenant-managed post-processing agent (LLM document reworker). */
export interface PostProcessingAgent {
  id: string
  tenantId: string
  name: string
  description: string | null
  prompt: string
  modelId: string | null
  maxSteps: number | null
  enabled: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** Body for create/update. */
export interface PostProcessingAgentInput {
  name: string
  description?: string | null
  prompt: string
  modelId?: string | null
  maxSteps?: number | null
  enabled?: boolean
}

/** Result of a non-persisting test run. */
export interface PostProcessingAgentTestRun {
  text: string
  title?: string
  meta?: Record<string, unknown>
  summary: string
  editCount: number
  aborted: boolean
}
