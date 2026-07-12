/**
 * Tests for the realtime transcription lib's dev-stub session (no Mistral key
 * needed). The prod path opens a WebSocket to Mistral and is covered by the
 * browser e2e run instead.
 */
import { test, expect } from "bun:test";

// The module reads PROTOCOL_DEV_STUB at import time — set it before importing.
process.env.PROTOCOL_DEV_STUB = "true";
const { startRealtimeTranscription } = await import("./realtime");

test("dev stub streams deltas and a final done whose text is the concatenation", () => {
  const deltas: string[] = [];
  let done = "";
  const session = startRealtimeTranscription({
    onDelta: (t) => deltas.push(t),
    onDone: (t) => (done = t),
    onError: () => {},
  });

  // finishAudio flushes every remaining word, then completes.
  session.finishAudio();

  expect(deltas.length).toBeGreaterThan(1);
  expect(deltas.join("")).toBe(done);
  expect(done).toContain("Beispiel AG");
});

test("finish is idempotent — done fires exactly once", () => {
  const deltas: string[] = [];
  let doneCount = 0;
  let done = "";
  const session = startRealtimeTranscription({
    onDelta: (t) => deltas.push(t),
    onDone: (t) => {
      done = t;
      doneCount++;
    },
    onError: () => {},
  });

  session.pushAudio(new Uint8Array([0, 0, 0, 0]));
  session.finishAudio();
  session.finishAudio();

  expect(doneCount).toBe(1);
  expect(deltas.join("")).toBe(done);
});

test("close before finish prevents completion", () => {
  let doneCount = 0;
  const session = startRealtimeTranscription({
    onDelta: () => {},
    onDone: () => doneCount++,
    onError: () => {},
  });

  session.close();
  session.finishAudio();

  expect(doneCount).toBe(0);
});
