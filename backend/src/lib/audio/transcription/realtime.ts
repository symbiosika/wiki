/**
 * Live (realtime) audio transcription — directly via Mistral (Voxtral).
 *
 * Unlike ../index.ts (which transcribes a finished recording in one request),
 * this streams PCM audio to Mistral's realtime WebSocket endpoint and surfaces
 * incremental `transcription.text.delta` events, so text appears *while* the
 * user is still speaking. Per project convention speech-to-text uses Mistral
 * directly (NOT OpenRouter).
 *
 * The relay in ../../../routes/tenant/[tenantId]/protocol feeds browser audio
 * frames in through `pushAudio` and forwards the callbacks back to the browser.
 *
 * Audio contract: raw little-endian 16-bit PCM (`pcm_s16le`), mono. The browser
 * captures at (nominally) 16 kHz but reports its actual context sample rate, so
 * the caller passes it through — Mistral is told the true rate.
 */
import {
  AudioEncoding,
  RealtimeTranscription,
} from "@mistralai/mistralai/extra/realtime";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const REALTIME_MODEL =
  process.env.MISTRAL_REALTIME_MODEL ?? "voxtral-mini-transcribe-realtime-2602";
const MISTRAL_BASE_URL =
  process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai";

/** Dev stub: emit canned deltas without calling Mistral. Never on in prod. */
const DEV_STUB = process.env.PROTOCOL_DEV_STUB === "true";

const DEFAULT_SAMPLE_RATE = 16000;

export interface RealtimeCallbacks {
  /** An incremental chunk of newly transcribed text. */
  onDelta: (text: string) => void;
  /** The stream finished cleanly; `fullText` is everything transcribed. */
  onDone: (fullText: string) => void;
  /** A fatal error occurred; the session is over. */
  onError: (message: string) => void;
}

export interface RealtimeSession {
  /** Feed one PCM frame (pcm_s16le) from the browser. */
  pushAudio: (chunk: Uint8Array) => void;
  /** Signal that the user stopped talking — no more audio will arrive. */
  finishAudio: () => void;
  /** Abort the whole session (e.g. the browser socket closed). */
  close: () => void;
}

/**
 * A backpressure-free async byte queue: producers `push`/`end` from anywhere,
 * a single consumer drains it as an `AsyncIterable<Uint8Array>` (what the
 * Mistral SDK's `transcribeStream` expects).
 */
class AsyncByteQueue implements AsyncIterable<Uint8Array> {
  private chunks: Uint8Array[] = [];
  private waiting: ((r: IteratorResult<Uint8Array>) => void)[] = [];
  private ended = false;

  push(chunk: Uint8Array): void {
    if (this.ended) return;
    const resolve = this.waiting.shift();
    if (resolve) resolve({ value: chunk, done: false });
    else this.chunks.push(chunk);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let resolve: ((r: IteratorResult<Uint8Array>) => void) | undefined;
    while ((resolve = this.waiting.shift())) {
      resolve({ value: undefined as unknown as Uint8Array, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: (): Promise<IteratorResult<Uint8Array>> => {
        const chunk = this.chunks.shift();
        if (chunk !== undefined) {
          return Promise.resolve({ value: chunk, done: false });
        }
        if (this.ended) {
          return Promise.resolve({
            value: undefined as unknown as Uint8Array,
            done: true,
          });
        }
        return new Promise((resolve) => this.waiting.push(resolve));
      },
      return: (): Promise<IteratorResult<Uint8Array>> => {
        this.end();
        return Promise.resolve({
          value: undefined as unknown as Uint8Array,
          done: true,
        });
      },
    };
  }
}

/** Canned transcript for the dev stub, streamed word-by-word. */
const STUB_TEXT =
  "Heute Kundengespräch mit der Firma Beispiel AG geführt. Sie möchten die " +
  "Bestellung um zwanzig Prozent erhöhen. Entscheidung: Wir nehmen die neuen " +
  "Konditionen an. Aufgabe: Angebot bis Freitag anpassen. Nächstes Treffen im Februar.";

/**
 * Dev stub session: ignores real audio, emits the canned transcript word by
 * word (one word per ~350 ms of incoming audio) so the browser's live-delta
 * rendering can be exercised without a Mistral key.
 */
const startStubSession = (callbacks: RealtimeCallbacks): RealtimeSession => {
  const words = STUB_TEXT.split(" ");
  let emitted = 0;
  let full = "";
  let lastEmit = 0;
  let done = false;

  const emitNext = () => {
    if (emitted >= words.length) return;
    const piece = (emitted === 0 ? "" : " ") + words[emitted];
    full += piece;
    emitted += 1;
    callbacks.onDelta(piece);
  };

  const finish = () => {
    if (done) return;
    done = true;
    // Flush any words not yet emitted, then signal completion.
    while (emitted < words.length) emitNext();
    callbacks.onDone(full);
  };

  return {
    pushAudio: () => {
      if (done) return;
      const now = Date.now();
      if (now - lastEmit >= 350) {
        lastEmit = now;
        emitNext();
      }
    },
    finishAudio: finish,
    close: () => {
      done = true;
    },
  };
};

/**
 * Start a realtime transcription session. Returns immediately; text arrives via
 * the callbacks. In prod this opens a WebSocket to Mistral; with PROTOCOL_DEV_STUB
 * it returns canned deltas instead.
 */
export const startRealtimeTranscription = (
  callbacks: RealtimeCallbacks,
  opts: { sampleRate?: number } = {},
): RealtimeSession => {
  if (DEV_STUB) {
    return startStubSession(callbacks);
  }

  if (!MISTRAL_API_KEY) {
    callbacks.onError(
      "MISTRAL_API_KEY is not set. It is required for live transcription.",
    );
    return { pushAudio: () => {}, finishAudio: () => {}, close: () => {} };
  }

  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const queue = new AsyncByteQueue();
  let full = "";
  let finished = false;

  const client = new RealtimeTranscription({
    apiKey: MISTRAL_API_KEY,
    serverURL: MISTRAL_BASE_URL,
  });

  // Drive the SDK stream in the background; dispatch its events to callbacks.
  (async () => {
    try {
      for await (const event of client.transcribeStream(queue, REALTIME_MODEL, {
        audioFormat: {
          encoding: AudioEncoding.PcmS16le,
          sampleRate,
        },
      })) {
        if (event.type === "transcription.text.delta" && "text" in event) {
          const text = event.text ?? "";
          full += text;
          callbacks.onDelta(text);
        } else if (event.type === "transcription.done") {
          finished = true;
          callbacks.onDone(full);
          break;
        } else if (event.type === "error" && "error" in event) {
          finished = true;
          const rawMessage = (event.error as { message?: unknown } | undefined)
            ?.message;
          const message =
            typeof rawMessage === "string"
              ? rawMessage
              : JSON.stringify(rawMessage ?? "Transcription error");
          callbacks.onError(message);
          break;
        }
      }
      // Stream ended without an explicit done event (e.g. audio simply stopped).
      if (!finished) {
        finished = true;
        callbacks.onDone(full);
      }
    } catch (error) {
      if (!finished) {
        finished = true;
        callbacks.onError(
          error instanceof Error ? error.message : "Transcription failed",
        );
      }
    }
  })();

  return {
    pushAudio: (chunk) => queue.push(chunk),
    finishAudio: () => queue.end(),
    close: () => queue.end(),
  };
};
