type WaveShape = OscillatorType

interface Voice {
  id: number
  oscillators: OscillatorNode[]
  gain: GainNode
}

export interface ScheduledNote {
  instanceId?: string
  channelId?: string
  note: number
  at: number
  duration: number
  velocity?: number
  channelGain?: number
  channelMuted?: boolean
  reverbSend?: number
}

export interface PlaybackReceipt {
  projectId: string
  projectRevision: number
  audioEpoch: number
  runId: number
  renderState: 'tone-transport-acknowledged'
  assetSet: 'salamander-browser-3layer-v1' | 'tone-synth-fallback-v1'
  projectContentFingerprint: string
  renderConfiguration: {
    bpm: number
    meter: string
    scheduledNoteCount: number
    tailSeconds: number
    masterGain: number
    voice:
      | { kind: 'salamander-3layer'; releaseSeconds: number; roots: number[]; velocityLayers: string[]; assetManifestFingerprint: string }
      | { kind: 'tone-synth-fallback'; oscillator: 'triangle'; releaseSeconds: number }
    reverb: { kind: 'deterministic-convolution'; impulseSeconds: number; preDelaySeconds: number }
    channels: Record<string, { gain: number; muted: boolean; reverbSend: number }>
  }
  sequenceStartTick: number
  sequenceEndTick: number
  acknowledgedAt: string
}

export type AuditionArtifactIdentity =
  | { kind: 'metronome'; bars: number; beatsPerBar: 4 }
  | { kind: 'artifact'; attemptId: string; generation: number; fingerprint: string; lengthTicks: number }

/**
 * Issued by the audio adapter only after the raw audio clock reaches the
 * scheduled end. It proves engine completion, not human audibility.
 */
export interface AuditionCompletionReceipt {
  renderState: 'tone-audition-completed'
  runId: number
  audioEpoch: number
  bpm: number
  meter: '4/4'
  scheduledNoteCount: number
  timelineSeconds: number
  tailSeconds: 1
  sequenceStartedAtAudioTime: number
  scheduledEndAudioTime: number
  completedAtAudioTime: number
  artifact: AuditionArtifactIdentity
  acknowledgedAt: string
}

export function isAcknowledgedAuditionCompletionReceipt(value: unknown): value is AuditionCompletionReceipt {
  if (!isRecord(value) || !isRecord(value.artifact)) return false
  const artifact = value.artifact
  const common = value.renderState === 'tone-audition-completed' && Number.isInteger(value.runId) && Number(value.runId) >= 1 &&
    Number.isInteger(value.audioEpoch) && Number(value.audioEpoch) >= 0 && finiteInRange(value.bpm, 30, 300) && value.meter === '4/4' &&
    Number.isInteger(value.scheduledNoteCount) && Number(value.scheduledNoteCount) >= 1 && Number(value.scheduledNoteCount) <= 131_072 &&
    finiteInRange(value.timelineSeconds, 0.001, 3_600) && value.tailSeconds === 1 && finiteInRange(value.sequenceStartedAtAudioTime, 0, Number.MAX_SAFE_INTEGER) &&
    finiteInRange(value.scheduledEndAudioTime, 0.001, Number.MAX_SAFE_INTEGER) && finiteInRange(value.completedAtAudioTime, 0.001, Number.MAX_SAFE_INTEGER) &&
    Number(value.scheduledEndAudioTime) >= Number(value.sequenceStartedAtAudioTime) + Number(value.timelineSeconds) + Number(value.tailSeconds) - 0.000_001 &&
    Number(value.completedAtAudioTime) >= Number(value.scheduledEndAudioTime) && typeof value.acknowledgedAt === 'string' && value.acknowledgedAt.length > 0 && value.acknowledgedAt.length <= 120
  if (!common) return false
  if (artifact.kind === 'metronome') return Number.isInteger(artifact.bars) && Number(artifact.bars) >= 1 && Number(artifact.bars) <= 4 && artifact.beatsPerBar === 4
  return artifact.kind === 'artifact' && /^[A-Za-z0-9._:-]{1,128}$/.test(String(artifact.attemptId)) && Number.isInteger(artifact.generation) && Number(artifact.generation) >= 0 &&
    /^fnv1a32-[a-f0-9]{8}$/.test(String(artifact.fingerprint)) && Number.isInteger(artifact.lengthTicks) && Number(artifact.lengthTicks) >= 480 && Number(artifact.lengthTicks) <= 15_360
}

export function isAcknowledgedPlaybackReceipt(value: unknown): value is PlaybackReceipt {
  if (!isRecord(value) || !isRecord(value.renderConfiguration)) return false
  const render = value.renderConfiguration
  if (!isRecord(render.voice) || !isRecord(render.reverb) || !isRecord(render.channels)) return false
  const knownSynth = value.assetSet === 'tone-synth-fallback-v1' && render.voice.kind === 'tone-synth-fallback' && render.voice.oscillator === 'triangle' && render.voice.releaseSeconds === 1
  const knownSamples = value.assetSet === 'salamander-browser-3layer-v1' && render.voice.kind === 'salamander-3layer' && render.voice.releaseSeconds === 1 &&
    render.voice.assetManifestFingerprint === 'sha256-1b3c343e578998caa3ac98d9978c50fb4b0671d18dd7488a20950a8be3885353' &&
    sameNumberArray(render.voice.roots, [48, 54, 60, 66, 72, 78, 84]) && sameStringArray(render.voice.velocityLayers, ['v5', 'v9', 'v13'])
  return /^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/.test(String(value.projectId)) && Number.isInteger(value.projectRevision) && Number(value.projectRevision) >= 0 &&
    Number.isInteger(value.audioEpoch) && Number(value.audioEpoch) >= 0 && Number.isInteger(value.runId) && Number(value.runId) >= 1 && value.renderState === 'tone-transport-acknowledged' &&
    /^fnv1a32-[a-f0-9]{8}$/.test(String(value.projectContentFingerprint)) && Number.isInteger(value.sequenceStartTick) && Number(value.sequenceStartTick) >= 0 && Number.isInteger(value.sequenceEndTick) && Number(value.sequenceEndTick) > Number(value.sequenceStartTick) &&
    render.meter === '4/4' && finiteInRange(render.bpm, 30, 300) && Number.isInteger(render.scheduledNoteCount) && Number(render.scheduledNoteCount) >= 0 && Number(render.scheduledNoteCount) <= 131_072 &&
    render.tailSeconds === 2.2 && render.masterGain === 0.22 && render.reverb.kind === 'deterministic-convolution' && render.reverb.impulseSeconds === 1.2 && render.reverb.preDelaySeconds === 0 &&
    (knownSynth || knownSamples) && validReceiptChannels(render.channels) && typeof value.acknowledgedAt === 'string' && value.acknowledgedAt.length > 0 && value.acknowledgedAt.length <= 120
}

function validReceiptChannels(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value)
  return entries.length > 0 && entries.length <= 32 && entries.every(([id, channel]) => /^[A-Za-z0-9._:?-]{1,80}$/.test(id) && isRecord(channel) && finiteInRange(channel.gain, 0, 100) && typeof channel.muted === 'boolean' && finiteInRange(channel.reverbSend, 0, 40))
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const finiteInRange = (value: unknown, minimum: number, maximum: number) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
const sameNumberArray = (value: unknown, expected: number[]) => Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
const sameStringArray = (value: unknown, expected: string[]) => Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])

const midiToFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12)

export class AudioEngine {
  private context?: AudioContext
  private master?: GainNode
  private compressor?: DynamicsCompressorNode
  private voices = new Map<number, Voice[]>()
  private noteGenerations = new Map<number, number>()
  private nextVoiceId = 1
  private timers = new Set<number>()
  private sequenceToken = 0
  private sequenceResolvers = new Map<number, (completed: boolean) => void>()

  get ready(): boolean {
    return this.context?.state === 'running'
  }

  async ensureReady(): Promise<boolean> {
    try {
      if (!this.context) {
        const AudioContextClass =
          window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        if (!AudioContextClass) return false
        const context = new AudioContextClass()
        context.onstatechange = () => {
          if (context.state === 'suspended' || context.state === 'interrupted') this.stopSequences()
        }
        const master = context.createGain()
        const compressor = context.createDynamicsCompressor()
        master.gain.value = 0.62
        compressor.threshold.value = -12
        compressor.knee.value = 12
        compressor.ratio.value = 8
        compressor.attack.value = 0.003
        compressor.release.value = 0.18
        master.connect(compressor)
        compressor.connect(context.destination)
        this.context = context
        this.master = master
        this.compressor = compressor
      }
      if (this.context.state === 'suspended') await this.context.resume()
      return this.context.state === 'running'
    } catch {
      return false
    }
  }

  async noteOn(
    note: number,
    velocity = 0.78,
    shape: WaveShape = 'triangle',
  ): Promise<boolean> {
    return Boolean(await this.startVoice(note, velocity, shape))
  }

  private async startVoice(
    note: number,
    velocity = 0.78,
    shape: WaveShape = 'triangle',
  ): Promise<Voice | undefined> {
    const generation = this.noteGenerations.get(note) ?? 0
    if (!this.noteGenerations.has(note)) this.noteGenerations.set(note, generation)
    if (
      !(await this.ensureReady()) ||
      !this.context ||
      !this.master ||
      (this.noteGenerations.get(note) ?? 0) !== generation
    ) {
      return undefined
    }
    const now = this.context.currentTime
    const voiceGain = this.context.createGain()
    const filter = this.context.createBiquadFilter()
    const body = this.context.createOscillator()
    const warmth = this.context.createOscillator()
    const safeVelocity = Math.max(0.08, Math.min(1, velocity))

    body.type = shape
    warmth.type = 'sine'
    body.frequency.value = midiToFrequency(note)
    warmth.frequency.value = midiToFrequency(note) / 2
    filter.type = 'lowpass'
    filter.frequency.value = 1850 + safeVelocity * 1200
    filter.Q.value = 0.7

    voiceGain.gain.setValueAtTime(0.0001, now)
    voiceGain.gain.exponentialRampToValueAtTime(
      0.13 * safeVelocity,
      now + 0.018,
    )
    voiceGain.gain.exponentialRampToValueAtTime(
      0.075 * safeVelocity,
      now + 0.38,
    )

    body.connect(filter)
    warmth.connect(filter)
    filter.connect(voiceGain)
    voiceGain.connect(this.master)
    body.start(now)
    warmth.start(now)

    const voice = { id: this.nextVoiceId++, oscillators: [body, warmth], gain: voiceGain }
    this.voices.set(note, [...(this.voices.get(note) ?? []), voice])
    return voice
  }

  noteOff(note: number): void {
    this.noteGenerations.set(note, (this.noteGenerations.get(note) ?? 0) + 1)
    if (!this.context) return
    const noteVoices = this.voices.get(note)
    if (!noteVoices?.length) return
    this.releaseVoices(note, noteVoices)
  }

  private releaseVoice(note: number, voiceId: number): void {
    const voice = this.voices.get(note)?.find((candidate) => candidate.id === voiceId)
    if (!voice) return
    this.releaseVoices(note, [voice])
  }

  private releaseVoices(note: number, voices: Voice[]): void {
    if (!this.context) return
    const now = this.context.currentTime
    voices.forEach((voice) => {
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setTargetAtTime(0.0001, now, 0.055)
      voice.oscillators.forEach((oscillator) => {
        try {
          oscillator.stop(now + 0.34)
        } catch {
          // A stopped voice is already safely silent.
        }
      })
    })
    const released = new Set(voices.map((voice) => voice.id))
    const remaining = (this.voices.get(note) ?? []).filter((voice) => !released.has(voice.id))
    if (remaining.length) this.voices.set(note, remaining)
    else this.voices.delete(note)
  }

  async trigger(
    note: number,
    duration = 0.72,
    velocity = 0.78,
    shape: WaveShape = 'triangle',
  ): Promise<boolean> {
    const voice = await this.startVoice(note, velocity, shape)
    if (!voice) return false
    this.schedule(() => this.releaseVoice(note, voice.id), duration * 1000)
    return true
  }

  async playChord(
    notes: readonly number[],
    duration = 1.35,
    velocity = 0.72,
    shape: WaveShape = 'triangle',
  ): Promise<boolean> {
    this.stopSequences()
    const voices = await Promise.all(
      notes.map((note) => this.startVoice(note, velocity, shape)),
    )
    if (!notes.length || voices.some((voice) => !voice)) {
      this.allNotesOff()
      return false
    }
    this.schedule(
      () => notes.forEach((note, index) => {
        const voice = voices[index]
        if (voice) this.releaseVoice(note, voice.id)
      }),
      duration * 1000,
    )
    return true
  }

  async playSeparated(notes: readonly number[]): Promise<boolean> {
    this.stopSequences()
    const sequence = notes.map((note, index) => ({
      note,
      at: index * 0.56,
      duration: 0.48,
      velocity: 0.76,
    }))
    return this.playSequence(sequence)
  }

  async playSequence(notes: readonly ScheduledNote[]): Promise<boolean> {
    const token = ++this.sequenceToken
    if (!(await this.ensureReady()) || !notes.length) return false
    const immediate = notes.filter(({ at }) => at <= 0)
    const started = await Promise.all(
      immediate.map(({ note, duration, velocity }) =>
        this.trigger(note, duration, velocity),
      ),
    )
    if (
      token !== this.sequenceToken ||
      !immediate.length ||
      started.some((result) => !result)
    ) {
      return false
    }
    notes.filter(({ at }) => at > 0).forEach(({ note, at, duration, velocity }) => {
      this.schedule(() => {
        if (token !== this.sequenceToken) return
        void this.trigger(note, duration, velocity)
      }, at * 1000)
    })
    return true
  }

  async playSequenceToEnd(
    notes: readonly ScheduledNote[],
    duration: number,
  ): Promise<boolean> {
    this.stopSequences()
    const token = ++this.sequenceToken
    const completion = new Promise<boolean>((resolve) => this.sequenceResolvers.set(token, resolve))
    const complete = (result: boolean) => {
      const resolver = this.sequenceResolvers.get(token)
      this.sequenceResolvers.delete(token)
      resolver?.(result)
    }
    const ready = await Promise.race([this.ensureReady(), completion])
    if (!ready || token !== this.sequenceToken || !notes.length || !this.ready) {
      complete(false)
      return false
    }
    const immediate = notes.filter(({ at }) => at <= 0)
    const started = await Promise.race([Promise.all(
      immediate.map(({ note, duration: noteDuration, velocity }) =>
        this.trigger(note, noteDuration, velocity),
      ),
    ), completion])
    if (!Array.isArray(started) || token !== this.sequenceToken || started.some((result) => !result)) {
      complete(false)
      return false
    }
    let failed = false
    const pending = new Set<Promise<boolean>>()
    notes.filter(({ at }) => at > 0).forEach(({ note, at, duration: noteDuration, velocity }) => {
      this.schedule(() => {
        if (token !== this.sequenceToken) return
        if (!this.ready) { failed = true; return }
        const attempt = this.trigger(note, noteDuration, velocity).then((played) => {
          if (!played || token !== this.sequenceToken) failed = true
          return played
        }, () => {
          failed = true
          return false
        })
        pending.add(attempt)
        void attempt.finally(() => pending.delete(attempt))
      }, at * 1000)
    })
    this.schedule(() => {
      void Promise.race([Promise.allSettled([...pending]), completion]).then(() => {
        if (token === this.sequenceToken) complete(!failed && this.ready)
      })
    }, duration * 1000)
    return completion
  }

  async playComparison(mode: 'minor' | 'major'): Promise<boolean> {
    const chord = mode === 'minor' ? [57, 60, 64] : [57, 61, 64]
    return this.playChord(chord, 1.6, 0.76)
  }

  async playMetronome(bars = 1): Promise<boolean> {
    this.stopSequences()
    const token = ++this.sequenceToken
    if (!(await this.ensureReady())) return false
    if (!(await this.trigger(84, 0.09, 0.9, 'sine'))) return false
    const totalBeats = Math.max(1, Math.min(4, Math.round(bars))) * 4
    Array.from({ length: totalBeats - 1 }, (_, index) => index + 1).forEach((beat) => {
      this.schedule(() => {
        if (token !== this.sequenceToken) return
        const isBarStart = beat % 4 === 0
        void this.trigger(isBarStart ? 84 : 79, 0.09, isBarStart ? 0.9 : 0.55, 'sine')
      }, beat * 667)
    })
    return true
  }

  async playDemo(id: 'emotive' | 'guitar' | 'cinematic' | 'electronic'): Promise<boolean> {
    this.stopSequences()
    const demoNotes: Record<typeof id, ScheduledNote[]> = {
      emotive: [
        { note: 57, at: 0, duration: 1.25 },
        { note: 64, at: 0.08, duration: 1.15 },
        { note: 69, at: 0.2, duration: 0.42 },
        { note: 72, at: 0.72, duration: 0.42 },
        { note: 65, at: 1.45, duration: 1.15 },
        { note: 60, at: 1.52, duration: 1.05 },
        { note: 69, at: 1.63, duration: 0.45 },
        { note: 67, at: 2.18, duration: 0.58 },
      ],
      guitar: [
        { note: 52, at: 0, duration: 0.44, velocity: 0.72 },
        { note: 59, at: 0.22, duration: 0.44, velocity: 0.68 },
        { note: 64, at: 0.44, duration: 0.52, velocity: 0.66 },
        { note: 55, at: 1.05, duration: 0.44, velocity: 0.74 },
        { note: 62, at: 1.27, duration: 0.44, velocity: 0.68 },
        { note: 67, at: 1.49, duration: 0.62, velocity: 0.66 },
        { note: 59, at: 2.18, duration: 0.72, velocity: 0.72 },
      ],
      cinematic: [
        { note: 45, at: 0, duration: 1.25, velocity: 0.82 },
        { note: 57, at: 0, duration: 1.25, velocity: 0.68 },
        { note: 60, at: 0.5, duration: 0.7, velocity: 0.66 },
        { note: 43, at: 1.28, duration: 1.25, velocity: 0.88 },
        { note: 55, at: 1.28, duration: 1.25, velocity: 0.72 },
        { note: 62, at: 1.8, duration: 0.7, velocity: 0.7 },
      ],
      electronic: [
        { note: 69, at: 0, duration: 0.28, velocity: 0.58 },
        { note: 76, at: 0.34, duration: 0.28, velocity: 0.62 },
        { note: 72, at: 0.68, duration: 0.42, velocity: 0.56 },
        { note: 81, at: 1.16, duration: 0.3, velocity: 0.64 },
        { note: 76, at: 1.52, duration: 0.32, velocity: 0.58 },
        { note: 79, at: 1.92, duration: 0.65, velocity: 0.6 },
        { note: 64, at: 0, duration: 2.7, velocity: 0.3 },
      ],
    }
    return this.playSequence(demoNotes[id])
  }

  stopSequences(): void {
    this.sequenceToken += 1
    this.sequenceResolvers.forEach((resolve) => resolve(false))
    this.sequenceResolvers.clear()
    this.timers.forEach((timer) => window.clearTimeout(timer))
    this.timers.clear()
    this.allNotesOff()
  }

  allNotesOff(): void {
    const notes = new Set([
      ...this.noteGenerations.keys(),
      ...this.voices.keys(),
    ])
    notes.forEach((note) => this.noteOff(note))
  }

  dispose(): void {
    this.stopSequences()
    if (this.context && this.context.state !== 'closed') {
      void this.context.close()
    }
    this.context = undefined
    this.master = undefined
    this.compressor = undefined
  }

  private schedule(action: () => void, milliseconds: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer)
      action()
    }, milliseconds)
    this.timers.add(timer)
    return timer
  }
}
