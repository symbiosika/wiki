/**
 * Live (realtime) microphone transcription.
 *
 * Captures microphone audio as 16-bit PCM via the Web Audio API and streams it
 * over a WebSocket to the backend relay (`/protocol/realtime`), which pipes it
 * to Mistral's realtime endpoint. Incremental `delta` events update the
 * `transcription` ref *while the user is still speaking* — no wait for a final
 * request/response.
 *
 * Graceful degradation: if the browser lacks the Web Audio pieces (AudioWorklet /
 * getUserMedia / a secure context), it falls back to the async path — record via
 * MediaRecorder, then POST the webm blob to `/protocol/transcribe`. Same public
 * surface either way; the transcript just arrives at the end instead of live.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { floatTo16BitPCM } from '@/utils/pcm'
import { useProtocol } from '@/stores/protocol'

export interface UseRealtimeTranscriptionOptions {
  tenantId: () => string
  /** Called on every incremental update while (and just after) recording. */
  onTranscriptionUpdate?: (text: string) => void
  /** Called once with the final transcript when recording finishes. */
  onTranscriptionComplete?: (text: string) => void
  onError?: (message: string) => void
}

/** The AudioWorklet processor: batches Float32 mic frames and posts them out. */
const WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._chunks = []
    this._count = 0
    this._target = 2048
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) {
      this._chunks.push(new Float32Array(channel))
      this._count += channel.length
      if (this._count >= this._target) {
        const merged = new Float32Array(this._count)
        let offset = 0
        for (const c of this._chunks) { merged.set(c, offset); offset += c.length }
        this._chunks = []
        this._count = 0
        this.port.postMessage(merged, [merged.buffer])
      }
    }
    return true
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor)
`

const realtimeSupported = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext !== false &&
  typeof AudioWorkletNode !== 'undefined' &&
  typeof (window.AudioContext || (window as any).webkitAudioContext) !==
    'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

export function useRealtimeTranscription(
  options: UseRealtimeTranscriptionOptions,
) {
  const { t } = useI18n()
  const protocol = useProtocol()

  const isRecording = ref(false)
  const isConnecting = ref(false)
  const isTranscribing = ref(false)
  const transcription = ref('')
  const error = ref('')

  // realtime resources
  let ws: WebSocket | null = null
  let audioContext: AudioContext | null = null
  let workletNode: AudioWorkletNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let stream: MediaStream | null = null
  let workletBlobUrl: string | null = null

  // async-fallback resources
  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []

  const cleanupAudio = () => {
    try {
      workletNode?.port.close()
    } catch {
      /* noop */
    }
    try {
      workletNode?.disconnect()
      sourceNode?.disconnect()
    } catch {
      /* noop */
    }
    stream?.getTracks().forEach((track) => track.stop())
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => undefined)
    }
    if (workletBlobUrl) {
      URL.revokeObjectURL(workletBlobUrl)
      workletBlobUrl = null
    }
    workletNode = null
    sourceNode = null
    audioContext = null
    stream = null
  }

  const finalize = (text: string) => {
    if (!isTranscribing.value && !isRecording.value) return
    isRecording.value = false
    isTranscribing.value = false
    transcription.value = text
    options.onTranscriptionComplete?.(text)
  }

  const fail = (message: string) => {
    error.value = message
    isRecording.value = false
    isConnecting.value = false
    isTranscribing.value = false
    options.onError?.(message)
  }

  // --- Realtime path --------------------------------------------------------

  const buildWsUrl = (sampleRate: number): string => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const tid = options.tenantId()
    return (
      `${proto}//${window.location.host}` +
      `/api/v1/tenant/${tid}/protocol/realtime?sampleRate=${sampleRate}`
    )
  }

  const startRealtime = async () => {
    isConnecting.value = true
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioContext = new Ctx({ sampleRate: 16000 })
    const sampleRate = audioContext.sampleRate

    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
    workletBlobUrl = URL.createObjectURL(blob)
    await audioContext.audioWorklet.addModule(workletBlobUrl)

    ws = new WebSocket(buildWsUrl(sampleRate))
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      if (!audioContext || !stream) return
      isConnecting.value = false
      isRecording.value = true

      sourceNode = audioContext.createMediaStreamSource(stream)
      workletNode = new AudioWorkletNode(audioContext, 'pcm-capture')
      workletNode.port.onmessage = (event: MessageEvent) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const frame = event.data as Float32Array
        const pcm = floatTo16BitPCM(frame)
        ws.send(pcm.buffer)
      }
      sourceNode.connect(workletNode)
      // No connection to the destination — we don't want to echo the mic.
    }

    ws.onmessage = (event: MessageEvent) => {
      let msg: { type?: string; text?: string; message?: string }
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (msg.type === 'delta') {
        transcription.value += msg.text ?? ''
        options.onTranscriptionUpdate?.(transcription.value)
      } else if (msg.type === 'done') {
        cleanupAudio()
        finalize(msg.text ?? transcription.value)
      } else if (msg.type === 'error') {
        cleanupAudio()
        fail(msg.message || t('Protocol.transcriptionError'))
      }
    }

    ws.onerror = () => {
      // If we never produced any text, surface a transcription error.
      if (isConnecting.value || (!transcription.value && isRecording.value)) {
        cleanupAudio()
        fail(t('Protocol.transcriptionError'))
      }
    }

    ws.onclose = () => {
      // Socket closed (e.g. after a done/error we already handled). If we were
      // still finalizing, settle with whatever text we have.
      if (isTranscribing.value || isRecording.value) {
        cleanupAudio()
        finalize(transcription.value)
      }
    }
  }

  const stopRealtime = () => {
    // Tell the relay the user stopped so Mistral flushes the final text.
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'stop' }))
      } catch {
        /* noop */
      }
    }
    // Stop capturing immediately; keep the socket open for the final `done`.
    try {
      workletNode?.disconnect()
      sourceNode?.disconnect()
    } catch {
      /* noop */
    }
    stream?.getTracks().forEach((track) => track.stop())
    isRecording.value = false
    isTranscribing.value = true
  }

  // --- Async fallback path --------------------------------------------------

  const startFallback = async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data)
    }
    mediaRecorder.onstop = async () => {
      stream?.getTracks().forEach((track) => track.stop())
      if (audioChunks.length === 0) {
        finalize('')
        return
      }
      try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
        const text = await protocol.transcribe(options.tenantId(), audioBlob)
        finalize(text)
      } catch {
        fail(t('Protocol.transcriptionError'))
      }
    }
    mediaRecorder.start()
    isRecording.value = true
  }

  const stopFallback = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      isRecording.value = false
      isTranscribing.value = true
      mediaRecorder.stop()
    }
  }

  // --- Public surface -------------------------------------------------------

  let usingFallback = false

  const startRecording = async () => {
    error.value = ''
    transcription.value = ''
    try {
      if (realtimeSupported()) {
        usingFallback = false
        await startRealtime()
      } else {
        usingFallback = true
        await startFallback()
      }
    } catch (err) {
      cleanupAudio()
      // Microphone permission denial vs. any other setup failure.
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      fail(denied ? t('Protocol.microphoneError') : t('Protocol.transcriptionError'))
    }
  }

  const stopRecording = () => {
    if (usingFallback) stopFallback()
    else stopRealtime()
  }

  const toggleRecording = () => {
    if (isRecording.value) stopRecording()
    else startRecording()
  }

  return {
    isRecording,
    isConnecting,
    isTranscribing,
    transcription,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
  }
}
