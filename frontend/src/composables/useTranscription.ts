/**
 * Browser microphone capture + transcription.
 *
 * Records audio via MediaRecorder, then POSTs the assembled webm blob to the
 * backend transcription endpoint (Mistral/Voxtral) and returns the text. Single
 * request/response — no streaming.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProtocol } from '@/stores/protocol'

export interface UseTranscriptionOptions {
  tenantId: () => string
  onTranscriptionComplete?: (text: string) => void
  onError?: (message: string) => void
}

export function useTranscription(options: UseTranscriptionOptions) {
  const { t } = useI18n()
  const protocol = useProtocol()

  const isRecording = ref(false)
  const isTranscribing = ref(false)
  const transcription = ref('')
  const error = ref('')

  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []

  const startRecording = async () => {
    error.value = ''
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunks = []
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data)
      }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        await transcribeRecording()
      }
      mediaRecorder.start()
      isRecording.value = true
    } catch {
      error.value = t('Protocol.microphoneError')
      options.onError?.(error.value)
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && isRecording.value) {
      mediaRecorder.stop()
      isRecording.value = false
    }
  }

  const transcribeRecording = async () => {
    if (audioChunks.length === 0) return
    isTranscribing.value = true
    try {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
      const text = await protocol.transcribe(options.tenantId(), audioBlob)
      transcription.value = text
      options.onTranscriptionComplete?.(text)
    } catch {
      error.value = t('Protocol.transcriptionError')
      options.onError?.(error.value)
    } finally {
      isTranscribing.value = false
    }
  }

  const toggleRecording = () => {
    if (isRecording.value) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return {
    isRecording,
    isTranscribing,
    transcription,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
  }
}
