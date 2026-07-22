/**
 * Normalise the many shapes an AI-SDK message part can take for a tool call
 * into one flat object the UI can render.
 *
 * AI SDK v6 emits static tool parts as `{ type: 'tool-<name>', state, input,
 * output, errorText }` and dynamic ones as `{ type: 'dynamic-tool', toolName,
 * … }`. We also tolerate the legacy `tool-invocation` shape just in case.
 */

export interface NormalizedToolCall {
  toolName: string
  input: unknown
  output: unknown
  /** input-streaming | input-available | output-available | output-error | … */
  state: string
  isError: boolean
  errorText?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeToolPart(part: any): NormalizedToolCall | null {
  if (!part || typeof part.type !== 'string') return null

  // AI SDK v6 static tool: type === "tool-<name>"
  if (part.type.startsWith('tool-')) {
    return {
      toolName: part.type.slice('tool-'.length),
      input: part.input ?? null,
      output: part.output ?? null,
      state: part.state ?? 'input-available',
      isError: part.state === 'output-error',
      errorText: part.errorText,
    }
  }

  // AI SDK v6 dynamic tool
  if (part.type === 'dynamic-tool') {
    return {
      toolName: part.toolName ?? 'tool',
      input: part.input ?? null,
      output: part.output ?? null,
      state: part.state ?? 'input-available',
      isError: part.state === 'output-error',
      errorText: part.errorText,
    }
  }

  // legacy shape
  if (part.type === 'tool-invocation' && part.toolInvocation) {
    const ti = part.toolInvocation
    return {
      toolName: ti.toolName ?? 'tool',
      input: ti.args ?? ti.input ?? null,
      output: ti.result ?? ti.output ?? null,
      state: ti.state ?? 'result',
      isError: ti.state === 'error',
    }
  }

  return null
}

export function isToolRunning(call: NormalizedToolCall): boolean {
  return call.state !== 'output-available' && call.state !== 'output-error'
}
