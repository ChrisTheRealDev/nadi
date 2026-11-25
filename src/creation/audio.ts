import { PianoSampleBank } from '../lib/pianoSampleBank'
import { encodePcm16Wave, measureSamplePeak } from '../lib/offlineProjectRender'
import { createDefaultMix, TICKS_PER_BAR, validateMix, validateProject, type CreationMix, type CreationProject, type Instrument, type Note } from './model'
import { notesInPlaybackWindow, type PlaybackLoopRange } from './playbackWindow'

const instruments: readonly Instrument[] = ['piano', 'kick', 'snare', 'hat']

/** Shared linear channel gains keep monitoring, playback and WAV mixing identical. */
export function createMixGraph(context: BaseAudioContext, destination: AudioNode, initial: CreationMix) {
  if (!validateMix(initial)) throw new TypeError('The mixer settings are invalid.')
  const channels = {} as Record<Instrument, GainNode>
  for (const instrument of instruments) {
    channels[instrument] = context.createGain()
    channels[instrument].connect(destination)
  }
  const setMix = (mix: CreationMix) => {
    if (!validateMix(mix)) throw new TypeError('The mixer settings are invalid.')
    for (const instrument of instruments) {
      const setting = mix[instrument]
      channels[instrument].gain.setValueAtTime(setting.muted ? 0 : setting.level / 100, context.currentTime)
    }
  }
  setMix(initial)
  return { channels, setMix, dispose: () => instruments.forEach(instrument => channels[instrument].disconnect()) }
}

export interface CreationPlaybackOptions {
  live?: boolean
  /** Legacy one-bar loop. Cannot be combined with loopRange. */
  loopBar?: number
  /** Half-open absolute project-tick range. Cannot be combined with loopBar. */
  loopRange?: PlaybackLoopRange
  failed?: (error: Error) => void
}

function validLoopRange(value: unknown, projectEndTick: number): value is PlaybackLoopRange {
  if (value === null || typeof value !== 'object') return false
  const range = value as Partial<PlaybackLoopRange>
  return Number.isSafeInteger(range.startTick)
    && Number.isSafeInteger(range.endTick)
    && Number(range.startTick) >= 0
    && Number(range.endTick) > Number(range.startTick)
    && Number(range.endTick) <= projectEndTick
}

function validPreviewNote(value: unknown): value is Pick<Note, 'instrument' | 'pitch' | 'velocity'> {
  if (value === null || typeof value !== 'object') return false
  const note = value as Partial<Note>
  return instruments.includes(note.instrument as Instrument)
    && Number.isSafeInteger(note.pitch) && Number(note.pitch) >= 0 && Number(note.pitch) <= 127
    && Number.isSafeInteger(note.velocity) && Number(note.velocity) >= 1 && Number(note.velocity) <= 127
}

type Voice = { release: (at: number) => void; stop: () => void }
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()
function noise(context: BaseAudioContext) {
  let buffer = noiseBuffers.get(context)
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .3), context.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 123456789
    for (let i = 0; i < data.length; i++) { seed = (1664525 * seed + 1013904223) >>> 0; data[i] = (seed / 4294967296) * 2 - 1 }
    noiseBuffers.set(context, buffer)
  }
  return buffer
}

/** Same voice graph for preview, song playback and offline export. */
function voice(context: BaseAudioContext, destination: AudioNode, bank: PianoSampleBank, note: Note, at: number, duration?: number): Voice {
  const gain = context.createGain()
  const level = Math.min(1, Math.max(0, note.velocity / 127)) * .26
  gain.connect(destination)
  const sources: (AudioBufferSourceNode | OscillatorNode)[] = []
  const nodes: AudioNode[] = [gain]
  let finished = false
  const cleanup = () => { if (finished) return; finished = true; nodes.forEach(node => node.disconnect()) }
  if (note.instrument === 'piano') {
    const sample = bank.select(note.pitch, note.velocity / 127)
    if (sample) {
      const source = context.createBufferSource(); source.buffer = sample.buffer
      source.playbackRate.value = 2 ** ((note.pitch - sample.rootMidi) / 12)
      source.connect(gain); sources.push(source)
    } else {
      const source = context.createOscillator(); source.type = 'triangle'
      source.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12)
      source.connect(gain); sources.push(source)
    }
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008)
  } else if (note.instrument === 'kick') {
    const source = context.createOscillator(); source.frequency.setValueAtTime(145, at)
    source.frequency.exponentialRampToValueAtTime(45, at + .12)
    source.connect(gain); sources.push(source)
    gain.gain.setValueAtTime(level * 1.5, at); gain.gain.exponentialRampToValueAtTime(.00001, at + .32)
  } else {
    const source = context.createBufferSource(); source.buffer = noise(context)
    const filter = context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = note.instrument === 'hat' ? 7500 : 1000
    source.connect(filter); filter.connect(gain); sources.push(source); nodes.push(filter)
    gain.gain.setValueAtTime(level * (note.instrument === 'hat' ? .45 : .85), at)
    gain.gain.exponentialRampToValueAtTime(.00001, at + (note.instrument === 'hat' ? .07 : .19))
  }
  sources.forEach(source => { nodes.push(source); source.start(at) })
  sources[0].onended = cleanup
  const stopAt = (time: number) => sources.forEach(source => { try { source.stop(time) } catch { /* already stopped */ } })
  const release = (time: number) => {
    if (finished || note.instrument !== 'piano') return
    const t = Math.max(at + .01, time)
    gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(level, t); gain.gain.linearRampToValueAtTime(0, t + .4)
    stopAt(t + .41)
  }
  if (note.instrument !== 'piano') stopAt(at + .34)
  else if (duration !== undefined) release(at + duration)
  else stopAt(at + 120) // runaway hardware guard, not a song-length restriction
  return { release, stop: () => { stopAt(context.currentTime); cleanup() } }
}

export class CreationAudio {
  private context?: AudioContext
  private mix = createDefaultMix()
  private mixGraph?: ReturnType<typeof createMixGraph>
  private bank = new PianoSampleBank()
  private live = new Map<string, Voice>()
  private pending = new Map<string, symbol>()
  private scheduled = new Map<Voice, number>()
  private preview?: Voice
  private previewGeneration = 0
  private playback?: { project: CreationProject; live: boolean; loopRange?: PlaybackLoopRange }
  private timer?: number
  private generation = 0
  private onInterrupted?: () => void
  setInterruptionHandler(handler?: () => void) { this.onInterrupted = handler }
  setMix(mix: CreationMix) {
    if (!validateMix(mix)) throw new TypeError('The mixer settings are invalid.')
    this.mix = structuredClone(mix)
    this.mixGraph?.setMix(this.mix)
  }
  get time() { return this.context?.currentTime ?? 0 }
  get label() { return this.bank.status === 'ready' ? 'Sampled piano ready' : this.bank.status === 'loading' ? 'Loading piano · preview sound active' : this.bank.status === 'fallback' ? 'Lightweight piano fallback' : 'Click a key to enable sound' }
  async unlock() {
    if (!this.context || this.context.state === 'closed') {
      this.mixGraph?.dispose()
      this.context = new AudioContext()
      this.mixGraph = createMixGraph(this.context, this.context.destination, this.mix)
      this.context.addEventListener('statechange', () => { if (this.context?.state === 'suspended') { this.stop(); this.onInterrupted?.() } })
    }
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Sound is paused. Click a piano key to enable it.')
    if (this.bank.status === 'idle') void this.bank.prepare(this.context, { timeoutMs: 8000 })
    return this.context
  }
  async noteOn(key: string, pitch: number, velocity: number) {
    this.noteOff(key)
    const token = Symbol(); this.pending.set(key, token)
    const context = await this.unlock()
    if (this.pending.get(key) !== token) return
    this.pending.delete(key)
    const item = voice(context, this.mixGraph!.channels.piano, this.bank, { id: key, instrument: 'piano', pitch, velocity, startTick: 0, durationTicks: 480 }, context.currentTime)
    this.live.set(key, item)
  }
  noteOff(key: string) { this.pending.delete(key); const item = this.live.get(key); item?.release(this.time); this.live.delete(key) }
  silenceKeys() { this.pending.clear(); this.live.forEach(item => item.stop()); this.live.clear() }
  async previewNote(note: Pick<Note, 'instrument' | 'pitch' | 'velocity'>): Promise<void> {
    if (!validPreviewNote(note)) throw new TypeError('Cannot preview an invalid note.')
    this.stopPreview()
    const generation = this.previewGeneration
    const context = await this.unlock()
    if (generation !== this.previewGeneration) return
    const preview = voice(context, this.mixGraph!.channels[note.instrument], this.bank, {
      ...note,
      id: 'preview',
      startTick: 0,
      durationTicks: 1,
    }, context.currentTime, note.instrument === 'piano' ? .25 : undefined)
    if (generation !== this.previewGeneration) { preview.stop(); return }
    this.preview = preview
  }
  stopPreview() {
    this.previewGeneration++
    this.preview?.stop()
    this.preview = undefined
  }
  stop() {
    this.generation++; if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined; this.playback = undefined; this.scheduled.forEach((_end, item) => item.stop()); this.scheduled.clear(); this.silenceKeys(); this.stopPreview()
  }
  /** Only song playback accepts edits. Queued attacks/tails are immutable (~200ms ahead). */
  updateSong(project: CreationProject): boolean {
    const session = this.playback
    if (!session?.live || !validateProject(project) || project.id !== session.project.id || project.bpm !== session.project.bpm || project.bars !== session.project.bars) return false
    session.project = structuredClone(project)
    return true
  }
  async play(project: CreationProject, update: (tick: number) => void, done: () => void, options: CreationPlaybackOptions = {}) {
    if (!validateProject(project)) throw new TypeError('Cannot play an invalid creation project.')
    if (options.loopBar !== undefined && options.loopRange !== undefined) throw new RangeError('Choose either a loop bar or a loop range, not both.')
    if (options.loopBar !== undefined && (!Number.isInteger(options.loopBar) || options.loopBar < 0 || options.loopBar >= project.bars)) throw new RangeError('Choose an existing bar to loop.')
    if (options.loopRange !== undefined && !validLoopRange(options.loopRange, project.bars * TICKS_PER_BAR)) throw new RangeError('Choose a valid loop range inside the project.')
    this.stop(); const generation = this.generation
    const frozen = structuredClone(project)
    const loopRange = options.loopRange === undefined
      ? options.loopBar === undefined ? undefined : { startTick: options.loopBar * TICKS_PER_BAR, endTick: (options.loopBar + 1) * TICKS_PER_BAR }
      : { ...options.loopRange }
    const session = { project: frozen, live: options.live === true, loopRange }
    this.playback = session
    this.setMix(frozen.mix)
    const context = await this.unlock()
    await this.bank.prepare(context, { timeoutMs: 8000 })
    if (generation !== this.generation) return
    const secondsPerTick = 60 / frozen.bpm / 480
    const start = context.currentTime + .12
    const end = frozen.bars * 1920 * secondsPerTick
    let frontier = 0
    const pump = () => {
      if (generation !== this.generation) return
      const elapsed = context.currentTime - start
      const horizon = Math.max(frontier, (elapsed + .2) / secondsPerTick)
      // After a throttled/background timer, skip missed attacks instead of bursting them.
      const from = Math.max(frontier, elapsed / secondsPerTick)
      this.scheduled.forEach((endAt, item) => { if (endAt < context.currentTime) this.scheduled.delete(item) })
      for (const { note, tick, durationTicks } of notesInPlaybackWindow(session.project.notes, from, horizon, session.loopRange)) {
        if (this.scheduled.size >= 10000) { this.stop(); done(); options.failed?.(new Error('Playback paused: too many overlapping voices. Shorten long notes or reduce the repeated part.')); return }
        const at = Math.max(context.currentTime, start + tick * secondsPerTick)
        const scheduledDuration = durationTicks ?? note.durationTicks
        const item = voice(context, this.mixGraph!.channels[note.instrument], this.bank, note, at, scheduledDuration * secondsPerTick)
        this.scheduled.set(item, at + (note.instrument === 'piano' ? Math.max(.01, scheduledDuration * secondsPerTick) + .41 : .34))
      }
      frontier = horizon
      const position = Math.max(0, elapsed / secondsPerTick)
      update(session.loopRange === undefined ? Math.min(frozen.bars * 1920, position) : session.loopRange.startTick + position % (session.loopRange.endTick - session.loopRange.startTick))
      if (session.loopRange === undefined && elapsed >= end + .5) { this.stop(); done() }
    }
    pump(); if (generation === this.generation) this.timer = window.setInterval(pump, 25)
  }
  click(at: number) {
    if (!this.context) return
    const oscillator = this.context.createOscillator(), gain = this.context.createGain()
    oscillator.frequency.value = 1000; gain.gain.setValueAtTime(.035, at); gain.gain.exponentialRampToValueAtTime(.00001, at + .04)
    oscillator.connect(gain); gain.connect(this.context.destination); oscillator.start(at); oscillator.stop(at + .05)
    const item = { release: () => {}, stop: () => { try { oscillator.stop() } catch { /* ended */ } oscillator.disconnect(); gain.disconnect() } }
    this.scheduled.set(item, at + .05); oscillator.onended = () => { item.stop(); this.scheduled.delete(item) }
  }
  async wav(project: CreationProject) {
    if (!validateProject(project)) throw new TypeError('Cannot export an invalid creation project.')
    const frozen = structuredClone(project)
    const duration = frozen.bars * 4 * 60 / frozen.bpm + .5
    if (duration > 600) throw new Error('This browser export is limited to 10 minutes of audio per render to protect memory. Your full .nadi project can still be saved.')
    const context = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000)
    const bank = new PianoSampleBank()
    if (!await bank.prepare(context, { timeoutMs: 8000 })) throw new Error('Piano samples could not load. Keep your .nadi project and retry WAV when samples are available.')
    const graph = createMixGraph(context, context.destination, frozen.mix)
    try {
      frozen.notes.forEach(note => voice(context, graph.channels[note.instrument], bank, note, note.startTick * 60 / frozen.bpm / 480, note.durationTicks * 60 / frozen.bpm / 480))
      const buffer = await context.startRendering()
      return { bytes: encodePcm16Wave(buffer), peak: measureSamplePeak(buffer) }
    } finally { graph.dispose() }
  }
  dispose() { this.stop(); this.onInterrupted = undefined; this.mixGraph?.dispose(); this.mixGraph = undefined; void this.context?.close() }
}

export function creationMidi(project: CreationProject): Uint8Array {
  if (!validateProject(project)) throw new TypeError('Cannot export an invalid creation project.')
  const vlq = (n: number) => { const result = [n & 127]; for (let v = n >>> 7; v > 0; v >>>= 7) result.unshift((v & 127) | 128); return result }
  const text = new TextEncoder()
  const chunk = (name: string, body: number[]) => { const data = new Uint8Array(body.length + 8); data.set(text.encode(name)); new DataView(data.buffer).setUint32(4, body.length); data.set(body, 8); return data }
  const micros = Math.round(60000000 / project.bpm)
  const end = project.bars * 1920
  const tracks = [chunk('MTrk', [0, 255, 81, 3, micros >> 16 & 255, micros >> 8 & 255, micros & 255, 0, 255, 88, 4, 4, 2, 24, 8, ...vlq(end), 255, 47, 0])]
  for (const channel of [0, 9]) {
    const events: { tick: number; off: boolean; data: number[] }[] = []
    project.notes.filter(note => (note.instrument === 'piano' ? 0 : 9) === channel).forEach(note => {
      const pitch = note.instrument === 'piano' ? note.pitch : ({ kick: 36, snare: 38, hat: 42 } as const)[note.instrument]
      events.push({ tick: note.startTick, off: false, data: [144 | channel, pitch, note.velocity] }, { tick: note.startTick + note.durationTicks, off: true, data: [128 | channel, pitch, 0] })
    })
    events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off))
    const name = text.encode(channel === 0 ? 'NADI Piano' : 'NADI Drums')
    const data: number[] = [0, 255, 3, name.length, ...name]
    if (channel === 0) data.push(0, 192, 0)
    let last = 0
    events.forEach(event => { data.push(...vlq(event.tick - last), ...event.data); last = event.tick })
    data.push(...vlq(Math.max(0, end - last)), 255, 47, 0); tracks.push(chunk('MTrk', data))
  }
  const header = chunk('MThd', [0, 1, 0, 3, 1, 224])
  const output = new Uint8Array(header.length + tracks.reduce((sum, track) => sum + track.length, 0)); output.set(header)
  let offset = header.length; tracks.forEach(track => { output.set(track, offset); offset += track.length }); return output
}
