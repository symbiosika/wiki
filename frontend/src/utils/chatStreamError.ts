/**
 * Parse the error text of the wiki chat stream.
 *
 * The backend (backend/src/ai/stream-errors.ts) sends `"<code>"` or
 * `"<code>: <technical detail>"`. A network failure or an older server sends
 * something else; that becomes `unknown` with the raw text as detail.
 */
export const CHAT_STREAM_ERROR_CODES = [
  'rate_limited',
  'model_unavailable',
  'auth_failed',
  'insufficient_credits',
  'provider_error',
] as const

export type ChatStreamErrorCode =
  | (typeof CHAT_STREAM_ERROR_CODES)[number]
  | 'unknown'

export interface ChatStreamError {
  code: ChatStreamErrorCode
  /** Technical detail (provider wording, model id) — may be empty. */
  detail: string
}

const isKnownCode = (value: string): value is ChatStreamError['code'] =>
  (CHAT_STREAM_ERROR_CODES as readonly string[]).includes(value)

export const parseChatStreamError = (
  message: string | undefined | null,
): ChatStreamError => {
  const text = (message ?? '').trim()
  const match = /^([a-z_]+)(?::\s*([\s\S]*))?$/.exec(text)
  if (match && isKnownCode(match[1]!)) {
    return {
      code: match[1] as ChatStreamErrorCode,
      detail: match[2]?.trim() ?? '',
    }
  }
  return { code: 'unknown', detail: text }
}
