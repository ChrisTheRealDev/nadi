export const AUDIO_CAPTURE_BYTES = 1024 * 1024
export const CAPTURE_SECONDS = 60
export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'error'
export interface RecordedOriginal { base64: string; mimeType: string; byteLength: number; durationMs: number }
export interface RawAudioRecovery { blob: Blob; reason: 'oversize' | 'recorder-error' | 'unsupported-original'; incomplete: boolean }
export const RAW_RECOVERY_BYTES = 2 * AUDIO_CAPTURE_BYTES
interface RecorderOptions {
  getStream: () => Promise<MediaStream>
  makeRecorder: (stream: MediaStream, mimeType?: string) => MediaRecorder
  supported: (mimeType: string) => boolean
  now: () => number
  onState: (state: RecorderState, message: string) => void
  onOriginal: (original: RecordedOriginal) => void
  onRecovery?: (recovery: RawAudioRecovery) => void
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission is off. Allow it in this site’s browser settings and your operating-system privacy settings, then try Record microphone again.'
  if (name === 'NotFoundError') return 'No microphone is available. Connect an input and try again, or capture text or keyboard notes.'
  if (name === 'NotReadableError') return 'The microphone could not be read. Check the selected input or another app using it, then try again.'
  return error instanceof Error ? error.message : 'Microphone capture failed. Your existing ideas are unchanged; try again or use text or keyboard notes.'
}

/** MediaRecorder originals only: no monitoring, decoding, or musical transformation. */
export class IdeaRecorder {
  private generation = 0
  private stream?: MediaStream
  private recorder?: MediaRecorder
  private timer?: ReturnType<typeof setTimeout>
  private state: RecorderState = 'idle'
  private startedAt = 0
  private stoppedAt = 0

  constructor(private options: RecorderOptions) {}

  get active(): boolean { return this.state === 'requesting' || this.state === 'recording' || this.state === 'stopping' }

  private transition(state: RecorderState, message: string) { this.state = state; this.options.onState(state, message) }
  private release() { this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined; clearTimeout(this.timer); this.timer = undefined }

  async start(): Promise<void> {
    if (this.active) return
    const generation = ++this.generation
    this.transition('requesting', 'Waiting for microphone permission. Nothing is recorded until permission is granted; Cancel remains available.')
    try {
      const stream = await this.options.getStream()
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => this.options.supported(type))
      const recorder = this.options.makeRecorder(stream, mimeType)
      this.recorder = recorder
      const chunks: Blob[] = []
      let bytes = 0
      let recoveryBytes = 0
      let failed: RawAudioRecovery['reason'] | undefined
      let incomplete = false
      let stopping = false
      recorder.ondataavailable = event => {
        if (generation !== this.generation || !event.data.size) return
        bytes += event.data.size
        if (recoveryBytes + event.data.size <= RAW_RECOVERY_BYTES) { chunks.push(event.data); recoveryBytes += event.data.size }
        else incomplete = true
        if (bytes > AUDIO_CAPTURE_BYTES && !failed) {
          failed = 'oversize'
          this.transition('error', 'This capture exceeded the 1 MiB project limit. Available raw recorder bytes may be downloadable below; they were not added as an idea.')
          if (!stopping && recorder.state !== 'inactive') { stopping = true; recorder.stop() }
          this.release()
        }
      }
      recorder.onerror = () => {
        if (generation !== this.generation) return
        failed = 'recorder-error'
        this.transition('error', 'The browser stopped recording unexpectedly. Available raw recorder bytes may be downloadable below; they were not added as an idea.')
        if (!stopping && recorder.state !== 'inactive') { stopping = true; recorder.stop() }
        this.release()
      }
      recorder.onstop = () => {
        if (generation !== this.generation) return
        this.release()
        this.recorder = undefined
        const mime = recorder.mimeType || chunks[0]?.type || mimeType || 'application/octet-stream'
        if (failed) {
          if (recoveryBytes) this.options.onRecovery?.({ blob: new Blob(chunks, { type: mime }), reason: failed, incomplete: incomplete || recoveryBytes < bytes })
          return
        }
        const durationMs = Math.max(1, Math.min(60_000, (this.stoppedAt || this.options.now()) - this.startedAt))
        const blob = new Blob(chunks, { type: mime })
        if (!blob.size) { this.transition('error', 'The microphone returned no audio. Check your input and try again.'); return }
        void blob.arrayBuffer().then(buffer => {
          if (generation !== this.generation) return
          this.options.onOriginal({ base64: bytesToBase64(new Uint8Array(buffer)), mimeType: blob.type, byteLength: blob.size, durationMs })
          this.transition('idle', 'Original microphone capture finalized. No live microphone monitoring was enabled.')
        }).catch(error => { if (generation === this.generation) this.transition('error', microphoneError(error)) })
      }
      this.startedAt = this.options.now()
      this.stoppedAt = 0
      recorder.start(1000)
      this.transition('recording', 'Microphone recording · maximum 60 seconds / 1 MiB. No live monitoring.')
      this.timer = setTimeout(() => this.stop(), CAPTURE_SECONDS * 1000)
    } catch (error) {
      if (generation !== this.generation) return
      this.release()
      this.recorder = undefined
      this.transition('error', microphoneError(error))
    }
  }

  stop(): void {
    if (this.state === 'requesting') { this.cancel(); return }
    if (this.state !== 'recording' || !this.recorder) return
    this.stoppedAt = this.options.now()
    clearTimeout(this.timer)
    this.transition('stopping', 'Finalizing original recording. Please wait before changing projects or closing this page.')
    try { this.recorder.stop() } catch (error) { this.release(); this.transition('error', microphoneError(error)) }
  }

  cancel(): void {
    ++this.generation
    if (this.recorder && this.recorder.state !== 'inactive') { try { this.recorder.stop() } catch { /* Cleanup still releases input. */ } }
    this.recorder = undefined
    this.release()
    this.transition('idle', 'Microphone request/capture cancelled. Existing ideas are unchanged.')
  }
}

export function createBrowserRecorder(onState: RecorderOptions['onState'], onOriginal: RecorderOptions['onOriginal'], onRecovery?: RecorderOptions['onRecovery']): IdeaRecorder {
  return new IdeaRecorder({
    getStream: () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return Promise.reject(new Error('Microphone recording is unavailable here. Use a supporting browser on localhost or HTTPS, or capture text/keyboard notes.'))
      return navigator.mediaDevices.getUserMedia({ audio: true })
    },
    makeRecorder: (stream, mimeType) => new MediaRecorder(stream, mimeType ? { mimeType } : undefined),
    supported: type => MediaRecorder.isTypeSupported(type), now: () => performance.now(), onState, onOriginal, onRecovery,
  })
}
