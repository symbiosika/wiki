import { describe, expect, it } from 'vitest'
import { parseChatStreamError } from './chatStreamError'

describe('parseChatStreamError', () => {
  it('reads a bare code', () => {
    expect(parseChatStreamError('rate_limited')).toEqual({
      code: 'rate_limited',
      detail: '',
    })
  })

  it('splits code and multi-line detail', () => {
    expect(
      parseChatStreamError(
        'model_unavailable: 0 endpoints available\nZDR violation [model x/y]',
      ),
    ).toEqual({
      code: 'model_unavailable',
      detail: '0 endpoints available\nZDR violation [model x/y]',
    })
  })

  it('keeps anything else as unknown with the raw text', () => {
    expect(parseChatStreamError('Failed to fetch')).toEqual({
      code: 'unknown',
      detail: 'Failed to fetch',
    })
    expect(parseChatStreamError('boom: something')).toEqual({
      code: 'unknown',
      detail: 'boom: something',
    })
    expect(parseChatStreamError(undefined)).toEqual({
      code: 'unknown',
      detail: '',
    })
  })
})
