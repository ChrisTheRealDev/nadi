import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, isAcknowledgedAuditionCompletionReceipt, isAcknowledgedPlaybackReceipt, type AuditionCompletionReceipt } from './audio'
import { createInitialCourseProgress } from './courseProgress'
import { createMockPlaybackReceipt } from '../test/playbackReceiptFixture'

function audioParam(value = 0) {
  return {
    value,
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
  }
}

class FakeAudioContext {
  static latest: FakeAudioContext | undefined
  state: AudioContextState = 'suspended'
  currentTime = 0
  destination = {}
  resumePromise: Promise<void>
  resolveResume!: () => void
  stoppedOscillators: Array<ReturnType<typeof vi.fn>> = []

  constructor() {
    FakeAudioContext.latest = this
    this.resumePromise = new Promise((resolve) => {
      this.resolveResume = () => {
        this.state = 'running'
        resolve()
      }
    })
  }

  createGain() {
    return { gain: audioParam(), connect: vi.fn() }
  }

  createDynamicsCompressor() {
    return {
      threshold: audioParam(),
      knee: audioParam(),
      ratio: audioParam(),
      attack: audioParam(),
      release: audioParam(),
      connect: vi.fn(),
    }
  }

  createBiquadFilter() {
    return { type: 'lowpass', frequency: audioParam(), Q: audioParam(), connect: vi.fn() }
  }

  createOscillator() {
    const stop = vi.fn()
    this.stoppedOscillators.push(stop)
    return {
      type: 'sine', frequency: audioParam(), connect: vi.fn(), start: vi.fn(), stop,
    }
  }

  resume() {
    return this.resumePromise
  }

  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AudioEngine recovery', () => {
  it('returns false when Web Audio is unavailable', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    })
    const engine = new AudioEngine()
    await expect(engine.trigger(60)).resolves.toBe(false)
  })

  it('honours note-off while audio unlock is still pending', async () => {
    vi.stubGlobal('window', {
      AudioContext: FakeAudioContext,
      setTimeout,
      clearTimeout,
    })

    const engine = new AudioEngine()
    const starting = engine.noteOn(60)
    engine.noteOff(60)
    FakeAudioContext.latest?.resolveResume()

    await expect(starting).resolves.toBe(false)
    engine.dispose()
  })

  it('honours all-notes-off while audio unlock is still pending', async () => {
    vi.stubGlobal('window', {
      AudioContext: FakeAudioContext,
      setTimeout,
      clearTimeout,
    })

    const engine = new AudioEngine()
    const starting = engine.noteOn(64)
    engine.allNotesOff()
    FakeAudioContext.latest?.resolveResume()

    await expect(starting).resolves.toBe(false)
    engine.dispose()
  })

  it('keeps simultaneous same-pitch voices independent until each duration ends', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      AudioContext: FakeAudioContext,
      setTimeout,
      clearTimeout,
    })
    const engine = new AudioEngine()
    const ready = engine.ensureReady()
    FakeAudioContext.latest?.resolveResume()
    await ready

    await expect(Promise.all([
      engine.trigger(60, 0.1),
      engine.trigger(60, 0.3),
    ])).resolves.toEqual([true, true])
    expect(FakeAudioContext.latest?.stoppedOscillators).toHaveLength(4)

    await vi.advanceTimersByTimeAsync(150)
    expect(FakeAudioContext.latest?.stoppedOscillators.filter((stop) => stop.mock.calls.length > 0)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(FakeAudioContext.latest?.stoppedOscillators.filter((stop) => stop.mock.calls.length > 0)).toHaveLength(4)
    engine.dispose()
    vi.useRealTimers()
  })

  it('supports an initial rest and resolves only after the complete range', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, setTimeout, clearTimeout })
    const engine = new AudioEngine()
    const playing = engine.playSequenceToEnd([{ note: 60, at: 1, duration: 0.25 }], 1.5)
    FakeAudioContext.latest?.resolveResume()
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeAudioContext.latest?.stoppedOscillators).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeAudioContext.latest?.stoppedOscillators).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    await expect(playing).resolves.toBe(true)
    engine.dispose()
  })

  it('cancels promptly while initial audio unlock is pending and prevents a later attack', async () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, setTimeout, clearTimeout })
    const engine = new AudioEngine()
    const playing = engine.playSequenceToEnd([{ note: 60, at: 0, duration: 1 }], 2)
    engine.stopSequences()
    await expect(playing).resolves.toBe(false)
    FakeAudioContext.latest?.resolveResume()
    await Promise.resolve()
    expect(FakeAudioContext.latest?.stoppedOscillators).toHaveLength(0)
    engine.dispose()
  })
})

describe('acknowledged render receipt schema', () => {
  it('accepts only known exact synth or verified sample configurations', () => {
    const receipt = createMockPlaybackReceipt(createInitialCourseProgress('now').project, 1920)
    expect(isAcknowledgedPlaybackReceipt(receipt)).toBe(true)
    const sampleReceipt = structuredClone(receipt)
    sampleReceipt.assetSet = 'salamander-browser-3layer-v1'
    sampleReceipt.renderConfiguration.voice = {
      kind: 'salamander-3layer', releaseSeconds: 1, roots: [48, 54, 60, 66, 72, 78, 84], velocityLayers: ['v5', 'v9', 'v13'],
      assetManifestFingerprint: 'sha256-1b3c343e578998caa3ac98d9978c50fb4b0671d18dd7488a20950a8be3885353',
    }
    expect(isAcknowledgedPlaybackReceipt(sampleReceipt)).toBe(true)
    sampleReceipt.renderConfiguration.voice.velocityLayers[1] = 'invented'
    expect(isAcknowledgedPlaybackReceipt(sampleReceipt)).toBe(false)
  })

  it('requires an audition to reach its scheduled raw-clock end and bind a typed artifact', () => {
    const receipt: AuditionCompletionReceipt = {
      renderState: 'tone-audition-completed', runId: 3, audioEpoch: 4, bpm: 90, meter: '4/4', scheduledNoteCount: 4,
      timelineSeconds: 8 / 3, tailSeconds: 1, sequenceStartedAtAudioTime: 10, scheduledEndAudioTime: 13.6666667,
      completedAtAudioTime: 13.67, artifact: { kind: 'artifact', attemptId: 'attempt-s2', generation: 2, fingerprint: 'fnv1a32-1234abcd', lengthTicks: 1920 },
      acknowledgedAt: '2026-09-05T00:00:00.000Z',
    }
    expect(isAcknowledgedAuditionCompletionReceipt(receipt)).toBe(true)
    expect(isAcknowledgedAuditionCompletionReceipt({ ...receipt, completedAtAudioTime: 13.5 })).toBe(false)
    expect(isAcknowledgedAuditionCompletionReceipt({ ...receipt, artifact: { ...receipt.artifact, fingerprint: 'caller-label' } })).toBe(false)
  })
})
