import { describe, expect, test } from 'vitest'
import { floatTo16BitPCM } from './pcm'

describe('floatTo16BitPCM', () => {
  test('maps 0 to 0 and preserves length', () => {
    const out = floatTo16BitPCM(new Float32Array([0, 0, 0]))
    expect(out).toBeInstanceOf(Int16Array)
    expect(out.length).toBe(3)
    expect(Array.from(out)).toEqual([0, 0, 0])
  })

  test('maps full-scale positive and negative to Int16 extremes', () => {
    const out = floatTo16BitPCM(new Float32Array([1, -1]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
  })

  test('clamps out-of-range samples', () => {
    const out = floatTo16BitPCM(new Float32Array([2, -2]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
  })

  test('scales a mid-level sample', () => {
    const out = floatTo16BitPCM(new Float32Array([0.5]))
    // 0.5 * 32767 = 16383.5 -> truncated to 16383 by Int16Array assignment
    expect(out[0]).toBe(16383)
  })
})
