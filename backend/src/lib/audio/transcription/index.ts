/**
 * Live audio transcription — directly via Mistral (Voxtral).
 *
 * Per project convention, speech-to-text uses Mistral directly (NOT OpenRouter):
 * the native `@mistralai/mistralai` SDK and the `voxtral-mini-latest` model.
 * LLM / agent text calls live in ../../ai and go through OpenRouter instead.
 */
import { Mistral } from "@mistralai/mistralai";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const STT_MODEL = process.env.MISTRAL_STT_MODEL ?? "voxtral-mini-latest";

/** Dev stub: return canned text without calling Mistral. Never on in prod. */
const DEV_STUB = process.env.PROTOCOL_DEV_STUB === "true";

/** Map a recording file name / extension to a MIME type Mistral accepts. */
const mimeFromName = (fileName: string): string => {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "webm":
    default:
      return "audio/webm";
  }
};

export interface TranscriptionResult {
  text: string;
}

/**
 * Transcribe a recorded audio buffer to text.
 * @param audioBuffer raw audio bytes (e.g. a webm recording from the browser)
 * @param fileName    original file name; its extension drives the MIME type
 */
export const transcribeAudio = async (
  audioBuffer: Buffer,
  fileName: string,
): Promise<TranscriptionResult> => {
  if (DEV_STUB) {
    return {
      text:
        "Heute Kundengespräch mit der Firma Beispiel AG geführt. Sie möchten " +
        "die Bestellung um zwanzig Prozent erhöhen. Entscheidung: Wir nehmen " +
        "die neuen Konditionen an. Aufgabe: Angebot bis Freitag anpassen. " +
        "Nächstes Treffen im Februar.",
    };
  }

  if (!MISTRAL_API_KEY) {
    throw new Error(
      "MISTRAL_API_KEY is not set. It is required for live transcription " +
        "(Voxtral).",
    );
  }

  const client = new Mistral({ apiKey: MISTRAL_API_KEY });
  const file = new File([audioBuffer], fileName, {
    type: mimeFromName(fileName),
  });

  const response = await client.audio.transcriptions.complete({
    model: STT_MODEL,
    file,
  });

  return { text: response.text ?? "" };
};
