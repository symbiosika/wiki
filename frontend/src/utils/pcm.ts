/**
 * PCM audio helpers for live transcription.
 *
 * Mistral's realtime endpoint expects little-endian 16-bit signed PCM
 * (`pcm_s16le`), mono. The Web Audio API gives us Float32 samples in [-1, 1];
 * this converts them to Int16 with clamping. Kept pure (no Web Audio types) so
 * it is unit-testable outside the browser.
 */

/** Convert Float32 samples in [-1, 1] to clamped little-endian Int16 PCM. */
export const floatTo16BitPCM = (input: Float32Array): Int16Array => {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0))
    // Asymmetric scaling: negative range maps to -32768, positive to 32767.
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return output
}
