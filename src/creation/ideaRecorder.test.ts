import { describe, expect, it, vi } from 'vitest'
import { AUDIO_CAPTURE_BYTES, IdeaRecorder, base64ToBytes, bytesToBase64, microphoneError, type RawAudioRecovery, type RecordedOriginal } from './ideaRecorder'

class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  final: Blob | null = null
  start = vi.fn(() => { this.state = 'recording' })
  stop = vi.fn(() => { this.state = 'inactive'; if (this.final) this.ondataavailable?.({ data: this.final }); this.onstop?.() })
  chunk(data: Blob) { this.ondataavailable?.({ data }) }
}

function setup(getStream?: () => Promise<MediaStream>) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const fake = new FakeRecorder()
  const onState = vi.fn()
  const onOriginal = vi.fn<(original: RecordedOriginal) => void>()
  const onRecovery = vi.fn<(recovery: RawAudioRecovery) => void>()
  let time = 100
  const makeRecorder = vi.fn(() => fake as unknown as MediaRecorder)
  const recorder = new IdeaRecorder({ getStream: getStream ?? (() => Promise.resolve(stream)), makeRecorder, supported: mime => mime.startsWith('audio/webm'), now: () => time, onState, onOriginal, onRecovery })
  return { recorder, fake, track, stream, onState, onOriginal, onRecovery, makeRecorder, at: (next: number) => { time = next } }
}

describe('original microphone capture', () => {
  it('negotiates MIME and includes final data before releasing hardware and delivering bytes', async () => {
    const test = setup()
    await test.recorder.start()
    expect(test.makeRecorder).toHaveBeenCalledWith(test.stream, 'audio/webm;codecs=opus')
    expect(test.fake.start).toHaveBeenCalledWith(1000)
    test.fake.chunk(new Blob([new Uint8Array([0, 255])]))
    test.fake.final = new Blob([new Uint8Array([12, 99])])
    test.at(1600)
    test.recorder.stop()
    await vi.waitFor(() => expect(test.onOriginal).toHaveBeenCalledTimes(1))
    expect(test.onOriginal.mock.calls[0][0]).toEqual({ base64: 'AP8MYw==', byteLength: 4, mimeType: 'audio/webm;codecs=opus', durationMs: 1500 })
    expect(test.track.stop).toHaveBeenCalled()
    expect(test.recorder.active).toBe(false)
  })

  it('cancels ignored permission requests and releases a late-granted stream without recording', async () => {
    let resolve!: (stream: MediaStream) => void
    const test = setup(() => new Promise<MediaStream>(done => { resolve = done }))
    const pending = test.recorder.start()
    expect(test.recorder.active).toBe(true)
    test.recorder.stop()
    expect(test.recorder.active).toBe(false)
    resolve(test.stream)
    await pending
    expect(test.track.stop).toHaveBeenCalledTimes(1)
    expect(test.makeRecorder).not.toHaveBeenCalled()
    expect(test.onOriginal).not.toHaveBeenCalled()
  })

  it('rejects oversized captures without delivering a misleading truncated original', async () => {
    const test = setup()
    await test.recorder.start()
    test.fake.chunk(new Blob([new Uint8Array(AUDIO_CAPTURE_BYTES + 1)]))
    expect(test.onState).toHaveBeenLastCalledWith('error', expect.stringContaining('not added as an idea'))
    expect(test.onOriginal).not.toHaveBeenCalled()
    expect(test.track.stop).toHaveBeenCalled()
    expect(test.recorder.active).toBe(false)
    expect(test.onRecovery).toHaveBeenCalledWith(expect.objectContaining({ reason: 'oversize', incomplete: false }))
    expect(test.onRecovery.mock.calls[0][0].blob.size).toBe(AUDIO_CAPTURE_BYTES + 1)
  })

  it('retains bounded raw bytes on recorder error, never as a valid original', async () => {
    const test = setup()
    await test.recorder.start()
    test.fake.chunk(new Blob([new Uint8Array([1, 2, 3])]))
    test.fake.onerror?.()
    expect(test.onOriginal).not.toHaveBeenCalled()
    expect(test.onRecovery).toHaveBeenCalledWith(expect.objectContaining({ reason: 'recorder-error', incomplete: false }))
    expect(test.onRecovery.mock.calls[0][0].blob.size).toBe(3)
  })

  it('caps raw recovery memory and labels omitted oversized chunks as incomplete', async () => {
    const test = setup()
    await test.recorder.start()
    test.fake.chunk(new Blob([new Uint8Array([1, 2])]))
    test.fake.chunk(new Blob([new Uint8Array(2 * AUDIO_CAPTURE_BYTES + 1)]))
    expect(test.onOriginal).not.toHaveBeenCalled()
    expect(test.onRecovery).toHaveBeenCalledWith(expect.objectContaining({ reason: 'oversize', incomplete: true }))
    expect(test.onRecovery.mock.calls[0][0].blob.size).toBe(2)
  })

  it('handles denial, missing hardware and unreadable input distinctly', async () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
      const error = Object.assign(new Error('denied'), { name })
      const test = setup(() => Promise.reject(error))
      await test.recorder.start()
      expect(test.onState).toHaveBeenLastCalledWith('error', microphoneError(error))
      expect(test.onOriginal).not.toHaveBeenCalled()
    }
    expect(microphoneError(Object.assign(new Error(), { name: 'NotFoundError' }))).toContain('Connect an input')
  })

  it('does not deliver after disposal/cancellation during finalization', async () => {
    const test = setup()
    await test.recorder.start()
    test.fake.final = new Blob([new Uint8Array([9])])
    test.recorder.stop()
    test.recorder.cancel()
    await Promise.resolve()
    await Promise.resolve()
    expect(test.onOriginal).not.toHaveBeenCalled()
  })

  it('reports empty recordings and recording errors rather than save success', async () => {
    const test = setup()
    await test.recorder.start()
    test.recorder.stop()
    expect(test.onState).toHaveBeenLastCalledWith('error', expect.stringContaining('no audio'))
    await test.recorder.start()
    test.fake.onerror?.()
    expect(test.onState).toHaveBeenLastCalledWith('error', expect.stringContaining('unexpectedly'))
    expect(test.onOriginal).not.toHaveBeenCalled()
  })

  it('round-trips arbitrary original bytes without text encoding', () => {
    const bytes = Uint8Array.from({ length: 40_000 }, (_, index) => index % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('stops automatically at the sixty-second boundary', async () => {
    vi.useFakeTimers()
    try {
      const test = setup()
      await test.recorder.start()
      test.at(60_100)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(test.fake.stop).toHaveBeenCalledTimes(1)
      expect(test.track.stop).toHaveBeenCalled()
      expect(test.recorder.active).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('ignores an obsolete stop event without releasing a newer recording input', async () => {
    const test = setup()
    await test.recorder.start()
    const oldStop = test.fake.onstop
    test.recorder.cancel()
    await test.recorder.start()
    const releasedBefore = test.track.stop.mock.calls.length
    oldStop?.()
    expect(test.track.stop).toHaveBeenCalledTimes(releasedBefore)
    expect(test.recorder.active).toBe(true)
    test.recorder.cancel()
  })
})
