import { describe, expect, it } from 'vitest'
import { Frequency } from 'tone'
import { completionDelayMilliseconds, createDeterministicImpulse, snapshotToneAuditionReceiptRun, snapshotToneRenderRun, ToneTransportEngine, type ToneAuditionReceiptRun, type ToneRenderRun } from './toneTransport'

describe('Tone transport timing contracts', () => {
  it('converts MIDI 69 to concert A rather than treating 69 as Hz', () => {
    expect(Frequency(69, 'midi').toFrequency()).toBeCloseTo(440)
  })

  it('does not acknowledge an early lookahead callback before its audio time', () => {
    expect(completionDelayMilliseconds(12.5, 12.38)).toBe(120)
    expect(completionDelayMilliseconds(12.5, 12.48)).toBe(20)
    expect(completionDelayMilliseconds(12.5, 12.6)).toBe(0)
  })

  it('rejects a note beyond the acknowledged range and freezes an accepted snapshot', () => {
    const run: ToneRenderRun = {
      notes: [{ note: 69, channelId: 'channel-melody', at: 0, duration: 1, velocity: 0.7 }],
      bpm: 90, meter: '4/4', duration: 8 / 3, tailSeconds: 2.2,
      projectId: 'project-abcdefgh', projectRevision: 1, audioEpoch: 2, runId: 3,
      projectContentFingerprint: 'fnv1a32-1234abcd', sequenceStartTick: 0, sequenceEndTick: 1920,
      channels: { 'channel-melody': { gain: 78, muted: false, reverbSend: 12 } },
    }
    const accepted = snapshotToneRenderRun(run)
    expect(Object.isFrozen(accepted)).toBe(true)
    expect(Object.isFrozen(accepted?.notes)).toBe(true)
    run.channels['channel-melody'].gain = 10
    expect(accepted?.channels['channel-melody'].gain).toBe(78)
    run.notes = [{ ...run.notes[0], at: 2.5, duration: 1 }]
    expect(snapshotToneRenderRun(run)).toBeUndefined()
  })

  it('builds the same bounded convolution impulse for the same audio format', () => {
    const createContext = () => ({
      sampleRate: 10,
      createBuffer: (channels: number, length: number, sampleRate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(length))
        return { numberOfChannels: channels, length, sampleRate, getChannelData: (channel: number) => data[channel] }
      },
    }) as unknown as BaseAudioContext
    const first = createDeterministicImpulse(createContext(), 1.2)
    const second = createDeterministicImpulse(createContext(), 1.2)
    expect([...first.getChannelData(0)]).toEqual([...second.getChannelData(0)])
    expect(first.length).toBe(12)
  })

  it('freezes an audition identity before audio awaits and rejects notes outside its timeline', () => {
    const run: ToneAuditionReceiptRun = {
      notes: [{ note: 84, at: 0, duration: 0.09, velocity: 0.9 }], bpm: 90, meter: '4/4', timelineSeconds: 8 / 3,
      audioEpoch: 2, runId: 8, artifact: { kind: 'metronome', bars: 1, beatsPerBar: 4 },
    }
    const accepted = snapshotToneAuditionReceiptRun(run)
    expect(Object.isFrozen(accepted)).toBe(true)
    expect(Object.isFrozen(accepted?.artifact)).toBe(true)
    run.artifact = { kind: 'metronome', bars: 4, beatsPerBar: 4 }
    expect(accepted?.artifact).toEqual({ kind: 'metronome', bars: 1, beatsPerBar: 4 })
    expect(snapshotToneAuditionReceiptRun({ ...run, notes: [{ note: 84, at: 3, duration: 1 }] })).toBeUndefined()
  })

  it('cancels a pending live attack when its owned release arrives during unlock', async () => {
    let resolveStart!: () => void
    const start = new Promise<void>((resolve) => { resolveStart = resolve })
    let synths = 0
    const raw = { state: 'running', addEventListener: () => undefined, removeEventListener: () => undefined }
    const fakeTone = {
      start: () => start,
      getContext: () => ({ state: 'running', rawContext: raw }),
      Synth: class { constructor() { synths += 1 } },
    } as unknown as typeof import('tone')
    const engine = new ToneTransportEngine(async () => fakeTone)
    const pending = engine.noteOn(60, 0.8, 'triangle', 'midi:port-1:0')
    engine.noteOff(60, 'midi:port-1:0')
    resolveStart()
    expect(await pending).toBe(false)
    expect(synths).toBe(0)
    engine.dispose()
  })

  it('releases repeated live pitches FIFO per input and panic disposes held and releasing voices', async () => {
    class FakeSynth {
      released = 0
      disposed = 0
      connect() { return this }
      triggerAttack() { return this }
      triggerRelease() { this.released += 1; return this }
      triggerAttackRelease() { return this }
      dispose() { this.disposed += 1 }
    }
    class FakeGain {
      connect() { return this }
      toDestination() { return this }
      dispose() { return undefined }
    }
    const synths: FakeSynth[] = []
    const raw = { state: 'running', addEventListener: () => undefined, removeEventListener: () => undefined }
    const fakeTone = {
      start: async () => undefined,
      getContext: () => ({ state: 'running', rawContext: raw }),
      getDestination: () => ({}),
      immediate: () => 0,
      Frequency: () => ({ toFrequency: () => 440 }),
      Synth: class extends FakeSynth { constructor() { super(); synths.push(this) } },
      Gain: FakeGain,
    } as unknown as typeof import('tone')
    const engine = new ToneTransportEngine(async () => fakeTone)
    await engine.noteOn(60, 0.8, 'triangle', 'midi:port-1:0')
    await engine.noteOn(60, 0.7, 'triangle', 'midi:port-1:0')
    engine.noteOff(60, 'midi:port-1:0')
    expect(synths.map((voice) => voice.released)).toEqual([1, 0])
    engine.allNotesOff()
    expect(synths.map((voice) => voice.disposed)).toEqual([1, 1])
    engine.dispose()
  })
})
