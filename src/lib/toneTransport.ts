import type { AuditionArtifactIdentity, AuditionCompletionReceipt, PlaybackReceipt, ScheduledNote } from './audio'
import { PianoSampleBank, SALAMANDER_MANIFEST_FINGERPRINT, type PianoAssetSet, type LoadedPianoSample } from './pianoSampleBank'

interface DisposableNode {
  dispose(): unknown
}

interface ToneVoice extends DisposableNode {
  connect(destination: unknown): unknown
  triggerAttack(note: number, time: number, velocity: number): unknown
  triggerRelease(time: number): unknown
  triggerAttackRelease(note: number, duration: number, time: number, velocity: number): unknown
}

interface TonePlayerLike extends DisposableNode {
  playbackRate: number
  connect(destination: unknown): unknown
  start(time: number): unknown
  stop(time: number): unknown
}

interface ToneGainLike extends DisposableNode {
  gain: {
    cancelScheduledValues(time: number): unknown
    setValueAtTime(value: number, time: number): unknown
    linearRampToValueAtTime(value: number, time: number): unknown
  }
  connect(destination: unknown): unknown
}

interface ToneTransportLike {
  bpm: { value: number }
  seconds: number
  schedule(callback: (time: number) => void, time: number): number
  clear(id: number): this
  cancel(after?: number): this
  start(time?: number | string): this
  stop(time?: number | string): this
}

interface ToneBusGain extends DisposableNode {
  gain: { value: number }
}

export interface ToneRenderRun {
  notes: readonly ScheduledNote[]
  bpm: number
  meter: '4/4'
  duration: number
  tailSeconds: number
  projectId: string
  projectRevision: number
  audioEpoch: number
  runId: number
  projectContentFingerprint: string
  sequenceStartTick: number
  sequenceEndTick: number
  channels: Record<string, { gain: number; muted: boolean; reverbSend: number }>
}

export interface ToneAuditionReceiptRun {
  notes: readonly ScheduledNote[]
  bpm: number
  meter: '4/4'
  timelineSeconds: number
  audioEpoch: number
  runId: number
  artifact: AuditionArtifactIdentity
}

interface AuditionClockCompletion {
  timelineSeconds: number
  sequenceStartedAtAudioTime: number
  scheduledEndAudioTime: number
  completedAtAudioTime: number
}

type AuditionShape = 'triangle' | 'sine'

const MASTER_GAIN = 0.22
const SYNTH_RELEASE_SECONDS = 1
const IMPULSE_SECONDS = 1.2

export class ToneTransportEngine {
  private tone?: typeof import('tone')
  private transport?: ToneTransportLike
  private token = 0
  private resolveCurrent?: (completed: boolean) => void
  private scheduleIds: number[] = []
  private nodes: DisposableNode[] = []
  private liveVoices = new Map<string, ToneVoice[]>()
  private liveNodes = new Set<DisposableNode>()
  private liveTimers = new Set<ReturnType<typeof globalThis.setTimeout>>()
  private liveGeneration = 0
  private liveKeyGenerations = new Map<string, number>()
  private liveMaster?: InstanceType<typeof import('tone').Gain>
  private readonly sampleBank = new PianoSampleBank()
  private projectBuses = new Map<string, { input: ToneBusGain; send: ToneBusGain }>()
  private completionTimers = new Set<ReturnType<typeof globalThis.setTimeout>>()
  private contextListenerInstalled = false
  private listenedContext?: BaseAudioContext & { state: string }
  private readonly contextStateListener = () => {
    const raw = this.listenedContext
    if (raw && raw.state !== 'running') {
      this.onInterrupted?.()
      this.stopAll()
    }
  }
  private onInterrupted?: () => void

  constructor(private readonly loadTone: () => Promise<typeof import('tone')> = () => import('tone')) {}

  setInterruptionHandler(handler?: () => void): void {
    this.onInterrupted = handler
  }

  get ready(): boolean {
    return this.tone?.getContext().state === 'running'
  }

  get assetStatus() {
    return this.sampleBank.status
  }

  async prepareAssets(retry = false): Promise<PianoAssetSet | undefined> {
    if (!(await this.ensureReady()) || !this.tone) return undefined
    await this.sampleBank.prepare(this.tone.getContext().rawContext, { retry })
    return this.sampleBank.assetSet
  }

  async ensureReady(): Promise<boolean> {
    try {
      const tone = this.tone ?? await this.loadTone()
      this.tone = tone
      await tone.start()
      if (!this.contextListenerInstalled) {
        const raw = tone.getContext().rawContext as BaseAudioContext & { state: string }
        this.listenedContext = raw
        raw.addEventListener('statechange', this.contextStateListener)
        this.contextListenerInstalled = true
      }
      return tone.getContext().state === 'running'
    } catch {
      return false
    }
  }

  async play(run: ToneRenderRun): Promise<PlaybackReceipt | undefined> {
    const acceptedRun = snapshotToneRenderRun(run)
    if (!acceptedRun) return undefined
    run = acceptedRun
    this.stop()
    const token = ++this.token
    const completion = new Promise<boolean>((resolve) => { this.resolveCurrent = resolve })
    const ready = await Promise.race([this.ensureReady(), completion])
    if (!ready || token !== this.token || !this.tone) {
      if (token === this.token) this.finish(false)
      return undefined
    }
    const tone = this.tone
    const transport = tone.getTransport() as unknown as ToneTransportLike
    this.transport = transport
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    transport.bpm.value = run.bpm

    const rawContext = tone.getContext().rawContext
    const assetPreparation = await Promise.race([
      this.sampleBank.prepare(rawContext).then(() => 'ready' as const),
      completion.then(() => 'cancelled' as const),
    ])
    if (assetPreparation === 'cancelled' || token !== this.token) return undefined
    const assetSet = this.sampleBank.assetSet
    const master = new tone.Gain(MASTER_GAIN).toDestination()
    const impulse = createDeterministicImpulse(rawContext, IMPULSE_SECONDS)
    const reverb = new tone.Convolver(impulse).connect(master)
    this.nodes.push(master, reverb)
    const appliedChannels = JSON.parse(JSON.stringify(run.channels)) as ToneRenderRun['channels']
    const buses = new Map<string, { input: InstanceType<typeof tone.Gain>; send: InstanceType<typeof tone.Gain> }>()
    Object.entries(appliedChannels).forEach(([channelId, channel]) => {
      const input = new tone.Gain(channel.muted ? 0 : channel.gain / 100).connect(master)
      const send = new tone.Gain(channel.reverbSend / 100).connect(reverb)
      input.connect(send)
      buses.set(channelId, { input, send })
      this.nodes.push(input, send)
    })
    this.projectBuses = buses
    for (const note of run.notes) {
      const bus = buses.get(note.channelId ?? '')
      if (!bus) continue
      const voice = this.createVoice(tone, 'triangle', note.note, note.velocity)
      voice.connect(bus.input)
      this.nodes.push(voice)
      this.scheduleIds.push(transport.schedule((audioTime) => {
        if (token !== this.token) return
        try {
          voice.triggerAttackRelease(note.note, note.duration, audioTime, note.velocity ?? 0.78)
        } catch {
          this.finish(false)
        }
      }, Math.max(0, note.at)))
    }
    this.scheduleIds.push(transport.schedule((audioTime) => {
      if (token !== this.token) return
      const waitForAudioClock = () => {
        if (token !== this.token) return
        if (rawContext.currentTime < audioTime) {
          const retry = globalThis.setTimeout(() => {
            this.completionTimers.delete(retry)
            waitForAudioClock()
          }, Math.max(1, completionDelayMilliseconds(audioTime, rawContext.currentTime)))
          this.completionTimers.add(retry)
          return
        }
        this.finish(true)
      }
      waitForAudioClock()
    }, Math.max(0.001, run.duration + run.tailSeconds)))
    transport.start()
    const completed = await completion
    if (!completed) return undefined
    return freezePlaybackReceipt({
      projectId: run.projectId,
      projectRevision: run.projectRevision,
      audioEpoch: run.audioEpoch,
      runId: run.runId,
      renderState: 'tone-transport-acknowledged',
      assetSet,
      projectContentFingerprint: run.projectContentFingerprint,
      renderConfiguration: {
        bpm: run.bpm,
        meter: run.meter,
        scheduledNoteCount: run.notes.length,
        tailSeconds: run.tailSeconds,
        masterGain: MASTER_GAIN,
        voice: voiceConfiguration(assetSet),
        reverb: { kind: 'deterministic-convolution', impulseSeconds: IMPULSE_SECONDS, preDelaySeconds: 0 },
        channels: appliedChannels,
      },
      sequenceStartTick: run.sequenceStartTick,
      sequenceEndTick: run.sequenceEndTick,
      acknowledgedAt: new Date().toISOString(),
    })
  }

  async noteOn(note: number, velocity = 0.78, shape: AuditionShape = 'triangle', owner = 'default'): Promise<boolean> {
    if (!validMidiNote(note) || !Number.isFinite(velocity) || !validOwner(owner)) return false
    const key = liveKey(note, owner)
    const globalGeneration = this.liveGeneration
    const keyGeneration = this.liveKeyGenerations.get(key) ?? 0
    if (!(await this.ensureReady()) || globalGeneration !== this.liveGeneration || keyGeneration !== (this.liveKeyGenerations.get(key) ?? 0) || !this.tone) return false
    await this.sampleBank.prepare(this.tone.getContext().rawContext)
    if (globalGeneration !== this.liveGeneration || keyGeneration !== (this.liveKeyGenerations.get(key) ?? 0)) return false
    const voice = this.createVoice(this.tone, shape, note, velocity)
    voice.connect(this.ensureLiveMaster(this.tone))
    voice.triggerAttack(note, this.tone.immediate(), clamp01(velocity))
    this.liveNodes.add(voice)
    this.liveVoices.set(key, [...(this.liveVoices.get(key) ?? []), voice])
    return true
  }

  noteOff(note: number, owner = 'default'): void {
    const key = liveKey(note, owner)
    this.liveKeyGenerations.set(key, (this.liveKeyGenerations.get(key) ?? 0) + 1)
    if (!this.tone) return
    const voices = this.liveVoices.get(key) ?? []
    const voice = voices.shift()
    if (voices.length) this.liveVoices.set(key, voices)
    else this.liveVoices.delete(key)
    if (!voice) return
    const now = this.tone.immediate()
    try { voice.triggerRelease(now) } catch { /* an interrupted voice is already silent */ }
    const timer = globalThis.setTimeout(() => {
      this.liveTimers.delete(timer)
      this.liveNodes.delete(voice)
      try { voice.dispose() } catch { /* already disposed */ }
    }, (SYNTH_RELEASE_SECONDS + 0.1) * 1000)
    this.liveTimers.add(timer)
  }

  async playAudition(notes: readonly ScheduledNote[], bpm = 90, shape: AuditionShape = 'triangle'): Promise<boolean> {
    const timelineSeconds = notes.length ? Math.max(...notes.map((note) => note.at + note.duration)) : 0
    return Boolean(await this.performAudition(notes, bpm, shape, timelineSeconds))
  }

  async playAuditionReceipt(run: ToneAuditionReceiptRun, shape: AuditionShape = 'triangle'): Promise<AuditionCompletionReceipt | undefined> {
    const acceptedRun = snapshotToneAuditionReceiptRun(run)
    if (!acceptedRun) return undefined
    const completion = await this.performAudition(acceptedRun.notes, acceptedRun.bpm, shape, acceptedRun.timelineSeconds)
    if (!completion) return undefined
    return freezeAuditionCompletionReceipt({
      renderState: 'tone-audition-completed',
      runId: acceptedRun.runId,
      audioEpoch: acceptedRun.audioEpoch,
      bpm: acceptedRun.bpm,
      meter: acceptedRun.meter,
      scheduledNoteCount: acceptedRun.notes.length,
      timelineSeconds: completion.timelineSeconds,
      tailSeconds: SYNTH_RELEASE_SECONDS,
      sequenceStartedAtAudioTime: completion.sequenceStartedAtAudioTime,
      scheduledEndAudioTime: completion.scheduledEndAudioTime,
      completedAtAudioTime: completion.completedAtAudioTime,
      artifact: acceptedRun.artifact,
      acknowledgedAt: new Date().toISOString(),
    })
  }

  private async performAudition(notes: readonly ScheduledNote[], bpm: number, shape: AuditionShape, timelineSeconds: number): Promise<AuditionClockCompletion | undefined> {
    if (!validAuditionNotes(notes, timelineSeconds) || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) return undefined
    this.stop()
    const token = ++this.token
    const completion = new Promise<boolean>((resolve) => { this.resolveCurrent = resolve })
    let scheduledEndAudioTime: number | undefined
    let completedAtAudioTime: number | undefined
    const ready = await Promise.race([this.ensureReady(), completion])
    if (!ready || token !== this.token || !this.tone) {
      if (token === this.token) this.finish(false)
      return undefined
    }
    const tone = this.tone
    const assetPreparation = await Promise.race([
      this.sampleBank.prepare(tone.getContext().rawContext).then(() => 'ready' as const),
      completion.then(() => 'cancelled' as const),
    ])
    if (assetPreparation === 'cancelled' || token !== this.token) return undefined
    const transport = tone.getTransport() as unknown as ToneTransportLike
    this.transport = transport
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    transport.bpm.value = bpm
    const master = new tone.Gain(MASTER_GAIN).toDestination()
    this.nodes.push(master)
    notes.forEach((note) => {
      const voice = this.createVoice(tone, shape, note.note, note.velocity)
      voice.connect(master)
      this.nodes.push(voice)
      this.scheduleIds.push(transport.schedule((audioTime) => {
        if (token !== this.token) return
        try {
          voice.triggerAttackRelease(note.note, note.duration, audioTime, clamp01(note.velocity ?? 0.78))
        } catch {
          this.finish(false)
        }
      }, Math.max(0, note.at)))
    })
    const duration = timelineSeconds + SYNTH_RELEASE_SECONDS
    this.scheduleIds.push(transport.schedule((audioTime) => {
      if (token !== this.token) return
      scheduledEndAudioTime = audioTime
      this.waitForRawAudioTime(token, audioTime, () => {
        completedAtAudioTime = tone.getContext().rawContext.currentTime
        this.finish(true)
      })
    }, duration))
    transport.start()
    const completed = await completion
    if (!completed || scheduledEndAudioTime === undefined || completedAtAudioTime === undefined) return undefined
    return {
      timelineSeconds,
      sequenceStartedAtAudioTime: Math.max(0, scheduledEndAudioTime - duration),
      scheduledEndAudioTime,
      completedAtAudioTime,
    }
  }

  stop(): void {
    this.token += 1
    this.transport?.stop()
    this.transport?.cancel(0)
    for (const timer of this.completionTimers) globalThis.clearTimeout(timer)
    this.completionTimers.clear()
    this.finish(false)
  }

  previewMix(channelId: string, settings: { gain: number; muted: boolean; reverbSend: number }): boolean {
    const bus = this.projectBuses.get(channelId)
    if (!bus || !Number.isFinite(settings.gain) || settings.gain < 0 || settings.gain > 100 || typeof settings.muted !== 'boolean' || !Number.isFinite(settings.reverbSend) || settings.reverbSend < 0 || settings.reverbSend > 40) return false
    bus.input.gain.value = settings.muted ? 0 : settings.gain / 100
    bus.send.gain.value = settings.reverbSend / 100
    return true
  }

  allNotesOff(): void {
    this.liveGeneration += 1
    this.liveKeyGenerations.clear()
    this.liveVoices.clear()
    for (const timer of this.liveTimers) globalThis.clearTimeout(timer)
    this.liveTimers.clear()
    for (const node of this.liveNodes) {
      try { node.dispose() } catch { /* panic may encounter a previously stopped node */ }
    }
    this.liveNodes.clear()
    if (this.liveMaster) {
      try { this.liveMaster.dispose() } catch { /* already disposed */ }
      this.liveMaster = undefined
    }
  }

  stopAll(): void {
    this.stop()
    this.allNotesOff()
  }

  dispose(): void {
    this.stopAll()
    this.listenedContext?.removeEventListener('statechange', this.contextStateListener)
    this.listenedContext = undefined
    this.contextListenerInstalled = false
    this.onInterrupted = undefined
  }

  private finish(completed: boolean): void {
    this.transport?.stop()
    this.transport?.cancel(0)
    for (const id of this.scheduleIds) this.transport?.clear(id)
    this.scheduleIds = []
    for (const node of this.nodes.splice(0)) {
      try { node.dispose() } catch { /* a stopped Tone node is already disposable */ }
    }
    this.projectBuses.clear()
    const resolve = this.resolveCurrent
    this.resolveCurrent = undefined
    resolve?.(completed)
  }

  private createVoice(tone: typeof import('tone'), shape: AuditionShape, note: number, velocity = 0.78): ToneVoice {
    const sample = this.sampleBank.select(note, velocity)
    if (sample) return createSampleVoice(tone, sample, note)
    const synth = new tone.Synth({ oscillator: { type: shape }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.55, release: SYNTH_RELEASE_SECONDS } })
    return {
      connect: (destination) => synth.connect(destination as never),
      triggerAttack: (midi, time, nextVelocity) => synth.triggerAttack(tone.Frequency(midi, 'midi').toFrequency(), time, nextVelocity),
      triggerRelease: (time) => synth.triggerRelease(time),
      triggerAttackRelease: (midi, duration, time, nextVelocity) => synth.triggerAttackRelease(tone.Frequency(midi, 'midi').toFrequency(), duration, time, nextVelocity),
      dispose: () => synth.dispose(),
    }
  }

  private ensureLiveMaster(tone: typeof import('tone')): InstanceType<typeof tone.Gain> {
    if (!this.liveMaster) {
      this.liveMaster = new tone.Gain(MASTER_GAIN).toDestination()
      this.liveNodes.add(this.liveMaster)
    }
    return this.liveMaster
  }

  private waitForRawAudioTime(token: number, audioTime: number, onReached: () => void): void {
    if (token !== this.token || !this.tone) return
    const rawContext = this.tone.getContext().rawContext
    if (rawContext.currentTime >= audioTime) {
      onReached()
      return
    }
    const timer = globalThis.setTimeout(() => {
      this.completionTimers.delete(timer)
      this.waitForRawAudioTime(token, audioTime, onReached)
    }, Math.max(1, completionDelayMilliseconds(audioTime, rawContext.currentTime)))
    this.completionTimers.add(timer)
  }
}

export function completionDelayMilliseconds(scheduledAudioTime: number, currentAudioTime: number): number {
  return Math.max(0, Math.ceil((scheduledAudioTime - currentAudioTime) * 1000))
}

export function createDeterministicImpulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(context.sampleRate * seconds))
  const impulse = context.createBuffer(2, length, context.sampleRate)
  let seed = 0x4e414449
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = (seed / 0xffffffff) * 2 - 1
      data[index] = noise * (1 - index / length) ** 2
    }
  }
  return impulse
}

const validMidiNote = (note: number) => Number.isInteger(note) && note >= 0 && note <= 127
const validOwner = (owner: string) => /^[A-Za-z0-9._:-]{1,256}$/.test(owner)
const liveKey = (note: number, owner: string) => `${owner}:${note}`
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
export const freezePlaybackReceipt = (receipt: PlaybackReceipt): PlaybackReceipt => deepFreeze(JSON.parse(JSON.stringify(receipt)) as PlaybackReceipt)
export const freezeAuditionCompletionReceipt = (receipt: AuditionCompletionReceipt): AuditionCompletionReceipt => deepFreeze(JSON.parse(JSON.stringify(receipt)) as AuditionCompletionReceipt)

export function snapshotToneRenderRun(run: ToneRenderRun): ToneRenderRun | undefined {
  return validRenderRun(run) ? deepFreeze(JSON.parse(JSON.stringify(run)) as ToneRenderRun) : undefined
}

export function snapshotToneAuditionReceiptRun(run: ToneAuditionReceiptRun): ToneAuditionReceiptRun | undefined {
  if (!run || run.meter !== '4/4' || !Number.isFinite(run.bpm) || run.bpm < 30 || run.bpm > 300 || !Number.isFinite(run.timelineSeconds) || run.timelineSeconds <= 0 || run.timelineSeconds > 3_600 ||
    !Number.isInteger(run.audioEpoch) || run.audioEpoch < 0 || !Number.isInteger(run.runId) || run.runId < 1 || !validAuditionNotes(run.notes, run.timelineSeconds) || !validAuditionArtifact(run.artifact)) return undefined
  return deepFreeze(JSON.parse(JSON.stringify(run)) as ToneAuditionReceiptRun)
}

function validRenderRun(run: ToneRenderRun): boolean {
  if (!Number.isFinite(run.bpm) || run.bpm < 30 || run.bpm > 300 || run.meter !== '4/4' || !Number.isFinite(run.duration) || run.duration <= 0 || run.tailSeconds !== SYNTH_RELEASE_SECONDS + IMPULSE_SECONDS) return false
  if (!/^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/.test(run.projectId) || !Number.isInteger(run.projectRevision) || run.projectRevision < 0 || !Number.isInteger(run.audioEpoch) || run.audioEpoch < 0 || !Number.isInteger(run.runId) || run.runId < 1) return false
  if (!/^fnv1a32-[a-f0-9]{8}$/.test(run.projectContentFingerprint) || !Number.isInteger(run.sequenceStartTick) || !Number.isInteger(run.sequenceEndTick) || run.sequenceStartTick < 0 || run.sequenceEndTick <= run.sequenceStartTick) return false
  const expectedDuration = ((run.sequenceEndTick - run.sequenceStartTick) / 480) * (60 / run.bpm)
  if (Math.abs(run.duration - expectedDuration) > 0.000_001) return false
  const channels = Object.entries(run.channels)
  if (!channels.length || !channels.every(([id, channel]) => /^[A-Za-z0-9._:?-]{1,80}$/.test(id) && Number.isFinite(channel.gain) && channel.gain >= 0 && channel.gain <= 100 && typeof channel.muted === 'boolean' && Number.isFinite(channel.reverbSend) && channel.reverbSend >= 0 && channel.reverbSend <= 40)) return false
  return run.notes.length <= 131_072 && run.notes.every((note) => validMidiNote(note.note) && typeof note.channelId === 'string' && run.channels[note.channelId] !== undefined &&
    Number.isFinite(note.at) && note.at >= 0 && Number.isFinite(note.duration) && note.duration > 0 && note.at + note.duration <= run.duration + 0.000_001 && Number.isFinite(note.velocity) && Number(note.velocity) >= 0 && Number(note.velocity) <= 1)
}

function validAuditionNotes(notes: readonly ScheduledNote[], timelineSeconds: number): boolean {
  return Array.isArray(notes) && notes.length >= 1 && notes.length <= 131_072 && notes.every((note) => validMidiNote(note.note) &&
    Number.isFinite(note.at) && note.at >= 0 && Number.isFinite(note.duration) && note.duration > 0 && note.at + note.duration <= timelineSeconds + 0.000_001 &&
    (note.velocity === undefined || (Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1)))
}

function validAuditionArtifact(artifact: AuditionArtifactIdentity): boolean {
  if (!artifact || typeof artifact !== 'object') return false
  if (artifact.kind === 'metronome') return Number.isInteger(artifact.bars) && artifact.bars >= 1 && artifact.bars <= 4 && artifact.beatsPerBar === 4
  return artifact.kind === 'artifact' && /^[A-Za-z0-9._:-]{1,128}$/.test(artifact.attemptId) && Number.isInteger(artifact.generation) && artifact.generation >= 0 &&
    /^fnv1a32-[a-f0-9]{8}$/.test(artifact.fingerprint) && Number.isInteger(artifact.lengthTicks) && artifact.lengthTicks >= 480 && artifact.lengthTicks <= 15_360
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value as Record<string, unknown>).forEach((nested) => deepFreeze(nested))
  }
  return value
}

function createSampleVoice(tone: typeof import('tone'), sample: LoadedPianoSample, note: number): ToneVoice {
  const player = new tone.Player(sample.buffer) as unknown as TonePlayerLike
  const output = new tone.Gain(0) as unknown as ToneGainLike
  player.playbackRate = 2 ** ((note - sample.rootMidi) / 12)
  player.connect(output)
  let currentVelocity = 0
  const attack = (time: number, velocity: number) => {
    currentVelocity = clamp01(velocity)
    output.gain.setValueAtTime(currentVelocity, time)
    player.start(time)
  }
  const release = (time: number) => {
    output.gain.cancelScheduledValues(time)
    output.gain.setValueAtTime(currentVelocity, time)
    output.gain.linearRampToValueAtTime(0, time + SYNTH_RELEASE_SECONDS)
    try { player.stop(time + SYNTH_RELEASE_SECONDS) } catch { /* stopped sample voice */ }
  }
  return {
    connect: (destination) => output.connect(destination),
    triggerAttack: (_midi, time, velocity) => attack(time, velocity),
    triggerRelease: (time) => release(time),
    triggerAttackRelease: (_midi, duration, time, velocity) => { attack(time, velocity); release(time + duration) },
    dispose: () => { player.dispose(); output.dispose() },
  }
}

function voiceConfiguration(assetSet: PianoAssetSet): PlaybackReceipt['renderConfiguration']['voice'] {
  return assetSet === 'salamander-browser-3layer-v1'
    ? { kind: 'salamander-3layer', releaseSeconds: SYNTH_RELEASE_SECONDS, roots: [48, 54, 60, 66, 72, 78, 84], velocityLayers: ['v5', 'v9', 'v13'], assetManifestFingerprint: SALAMANDER_MANIFEST_FINGERPRINT }
    : { kind: 'tone-synth-fallback', oscillator: 'triangle', releaseSeconds: SYNTH_RELEASE_SECONDS }
}
