import { PianoSampleBank } from '../../lib/pianoSampleBank'
import { encodePcm16Wave, measureSamplePeak } from '../../lib/offlineProjectRender'
import { notesInPlaybackWindow } from '../playbackWindow'
import type { CreationPlaybackOptions } from '../audio'
import { assertStudioProject, compileArrangement, isMelodicSound, isSoundId, TICKS_PER_BAR, validateStudioProject, type CompiledNote, type SoundId, type StudioProject, type Track } from './model'
import { AcousticSampleBank } from './sampleBank'
import { acousticEnvelope, isAcousticSound, soundById } from './sounds'
import { audibleArrangement, audibleTracks, notesForRange, resolveStudioRange, type StudioRange } from './transport'
import { productionRouting, productionTail } from './productionAudio'
import { metronomeWindow, type MetronomeSettings } from './metronome'
import { ExternalMidi } from './externalMidi'

export interface StudioPlaybackOptions extends CreationPlaybackOptions, StudioRange {
  /** Audition only these placed occurrences; never changes exports or stored patterns. */
  clipIds?: readonly string[]
  /** Shared AudioContext epoch; used to align backing and capture after count-in. */
  startAt?: number
  metronome?: boolean
  metronomeSettings?: MetronomeSettings
}
export interface StudioMeters { tracks: Record<string, number>; master: number; clipping: boolean }
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Instrument preparation cancelled.', 'AbortError'))
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Instrument preparation cancelled.', 'AbortError'))
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

type Voice = { release: (at: number) => void; stop: () => void }
type VoiceNote = { pitch: number; velocity: number; soundId: SoundId }
const noises = new WeakMap<BaseAudioContext, AudioBuffer>()
function noise(context: BaseAudioContext) {
  let buffer = noises.get(context)
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .3), context.sampleRate)
    const data = buffer.getChannelData(0); let seed = 123456789
    for (let i = 0; i < data.length; i++) { seed = (1664525 * seed + 1013904223) >>> 0; data[i] = (seed / 4294967296) * 2 - 1 }
    noises.set(context, buffer)
  }
  return buffer
}

/** Per-track channels are retained across mixer edits, so held notes respond immediately. */
export function createTrackMixGraph(context: BaseAudioContext, destination: AudioNode, tracks: readonly Track[]) {
  const channels = new Map<string, GainNode>()
  const analysers = new Map<string, AnalyserNode>()
  const master = context.createAnalyser?.()
  if (master) { master.fftSize = 256; master.connect(destination) }
  const production = productionRouting(context, master ?? destination)
  let expressionTick = 0
  const setTracks = (next: readonly Track[]) => {
    for (const track of next) {
      if (!Number.isInteger(track.level) || track.level < 0 || track.level > 100) throw new TypeError('Invalid track volume.')
    }
    for (const [id, node] of channels) if (!next.some(track => track.id === id)) { node.gain.setValueAtTime(0, context.currentTime); node.disconnect(); production.remove(id); channels.delete(id); analysers.get(id)?.disconnect(); analysers.delete(id) }
    for (const track of next) {
      let node = channels.get(track.id)
      if (!node) {
        node = context.createGain(); node.connect(master ?? destination); channels.set(track.id, node)
        const analyser = context.createAnalyser?.()
        if (analyser) { analyser.fftSize = 256; analysers.set(track.id, analyser) }
      }
      node.gain.setValueAtTime(track.muted ? 0 : track.level / 100, context.currentTime)
      const output = production.connect(node, track, expressionTick)
      const meter = analysers.get(track.id); if (meter) output.connect(meter)
    }
  }
  setTracks(tracks)
  const peak = (analyser?: AnalyserNode) => { if (!analyser) return 0; const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); return data.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0) }
  const meters = (): StudioMeters => { const value = peak(master); return { tracks: Object.fromEntries([...analysers].map(([id, node]) => [id, peak(node)])), master: value, clipping: value >= 1 } }
  return { channels, setTracks, meters, expressionPosition: (tick: number) => { expressionTick = tick; production.position(tick) }, scheduleExpression: production.schedule, dispose: () => { production.dispose(); channels.forEach(node => node.disconnect()); channels.clear(); analysers.forEach(node => node.disconnect()); analysers.clear(); master?.disconnect() } }
}

/** Shared voice graph for monitoring, previews, playback and WAV. Legacy four sounds retain their graphs. */
function voice(context: BaseAudioContext, destination: AudioNode, piano: PianoSampleBank, acoustic: AcousticSampleBank, note: VoiceNote, at: number, duration?: number, onEnded?: () => void): Voice {
  const pianoSample = note.soundId === 'piano' ? piano.select(note.pitch, note.velocity / 127) : undefined
  if (note.soundId === 'piano' && !pianoSample) throw new Error('Piano samples unavailable. Retry sound; no substitute was played.')
  const gain = context.createGain(), level = Math.min(1, Math.max(0, note.velocity / 127)) * .26
  const frequency = 440 * 2 ** ((note.pitch - 69) / 12)
  gain.connect(destination)
  const sources: (AudioBufferSourceNode | OscillatorNode)[] = [], nodes: AudioNode[] = [gain]
  let finished = false
  const cleanup = () => { if (finished) return; finished = true; nodes.forEach(node => node.disconnect()); onEnded?.() }
  const oscillator = (type: OscillatorType, ratio = 1, weight = 1) => {
    const source = context.createOscillator(); source.type = type; source.frequency.value = frequency * ratio
    if (weight === 1) source.connect(gain)
    else { const partial = context.createGain(); partial.gain.value = weight; source.connect(partial); partial.connect(gain); nodes.push(partial) }
    sources.push(source)
  }
  if (note.soundId === 'piano') {
    const sample = pianoSample
    if (sample) { const source = context.createBufferSource(); source.buffer = sample.buffer; source.playbackRate.value = 2 ** ((note.pitch - sample.rootMidi) / 12); source.connect(gain); sources.push(source) }
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008)
  } else if (note.soundId === 'kick') {
    const source = context.createOscillator(); source.frequency.setValueAtTime(145, at); source.frequency.exponentialRampToValueAtTime(45, at + .12)
    source.connect(gain); sources.push(source); gain.gain.setValueAtTime(level * 1.5, at); gain.gain.exponentialRampToValueAtTime(.00001, at + .32)
  } else if (note.soundId === 'hat' || note.soundId === 'snare') {
    const source = context.createBufferSource(); source.buffer = noise(context)
    const filter = context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = note.soundId === 'hat' ? 7500 : 1000
    source.connect(filter); filter.connect(gain); sources.push(source); nodes.push(filter)
    gain.gain.setValueAtTime(level * (note.soundId === 'hat' ? .45 : .85), at); gain.gain.exponentialRampToValueAtTime(.00001, at + (note.soundId === 'hat' ? .07 : .19))
  } else if (isAcousticSound(note.soundId)) {
    const sample = acoustic.select(note.soundId, note.pitch), source = context.createBufferSource()
    source.buffer = sample.buffer; source.playbackRate.value = 2 ** ((note.pitch - sample.rootMidi) / 12)
    // Bowed sustain is looped; the guitar retains its natural decaying/plucked envelope.
    if (note.soundId === 'strings') { source.loop = true; source.loopStart = Math.min(1, sample.buffer.duration / 4); source.loopEnd = Math.max(source.loopStart + .1, sample.buffer.duration - 1) }
    else if (sample.loopStart !== undefined && sample.loopEnd !== undefined) { source.loop = true; source.loopStart = sample.loopStart; source.loopEnd = sample.loopEnd }
    if (sample.gain !== undefined) {
      const calibration = context.createGain(); calibration.gain.value = sample.gain
      source.connect(calibration); calibration.connect(gain); nodes.push(calibration)
    } else source.connect(gain)
    sources.push(source)
    if (note.soundId === 'ancient-reed') { oscillator('triangle', .997, .1); oscillator('sine', 2.004, .035) }
    const envelope = acousticEnvelope(note.soundId)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level * envelope.gain, at + envelope.attack)
  } else if (note.soundId === 'electric-piano') {
    oscillator('sine', 1, .8); oscillator('sine', 2, .22); oscillator('sine', 3, .08)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .006); gain.gain.exponentialRampToValueAtTime(Math.max(.00001, level * .12), at + 2)
  } else if (note.soundId === 'synth-bass') {
    oscillator('sine', 1, .85); oscillator('triangle', 1, .25)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .012)
  } else if (note.soundId === 'soft-pad') {
    oscillator('sine', .998, .5); oscillator('triangle', 1.002, .35); oscillator('sine', 2, .08)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .16)
  } else if (note.soundId === 'vocal-air') {
    const source = context.createOscillator(); source.type = 'sawtooth'; source.frequency.value = frequency; sources.push(source)
    for (const [centre, weight, q] of [[700, .48, 6], [1220, .25, 8], [2600, .09, 10]]) {
      const filter = context.createBiquadFilter(), partial = context.createGain(); filter.type = 'bandpass'; filter.frequency.value = centre; filter.Q.value = q; partial.gain.value = weight
      source.connect(filter); filter.connect(partial); partial.connect(gain); nodes.push(filter, partial)
    }
    oscillator('sine', 1.002, .1)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .18)
  } else if (note.soundId === 'bronze-resonance') {
    for (const [ratio, weight] of [[1, .48], [1.414, .22], [2.756, .14], [4.07, .08], [5.43, .04]]) oscillator('sine', ratio, weight)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008); gain.gain.exponentialRampToValueAtTime(Math.max(.00001, level * .08), at + 4)
  } else { gain.disconnect(); throw new Error('This sound has no registered renderer; no substitute was played.') }
  sources.forEach(source => { nodes.push(source); source.start(at) }); sources[0].onended = cleanup
  const stopAt = (time: number) => sources.forEach(source => { try { source.stop(time) } catch { /* already stopped */ } })
  const release = (time: number) => {
    if (finished || !isMelodicSound(note.soundId)) return
    const envelope = isAcousticSound(note.soundId) ? acousticEnvelope(note.soundId) : undefined
    const t = Math.max(at + .01, time), tail = envelope?.release ?? (note.soundId === 'soft-pad' ? .8 : .4)
    gain.gain.cancelScheduledValues(t)
    // Preserve the original piano release. Other presets release from their actual envelope value.
    const attack = note.soundId === 'plucked-guitar' ? 0 : envelope?.attack ?? (note.soundId === 'soft-pad' ? .16 : note.soundId === 'vocal-air' ? .18 : 0)
    const amplitude = (envelope ? level * envelope.gain : note.soundId === 'electric-piano' ? level * Math.pow(.12, Math.min(2, Math.max(0, t - at)) / 2) : note.soundId === 'bronze-resonance' ? level * Math.pow(.08, Math.min(4, Math.max(0, t - at)) / 4) : level) * (attack ? Math.min(1, (t - at) / attack) : 1)
    if (attack && t < at + attack) gain.gain.linearRampToValueAtTime(amplitude, t)
    else gain.gain.setValueAtTime(amplitude, t)
    gain.gain.linearRampToValueAtTime(0, t + tail); stopAt(t + tail + .01)
  }
  if (!isMelodicSound(note.soundId)) stopAt(at + .34)
  else if (duration !== undefined) release(at + duration)
  else stopAt(at + 120)
  return { release, stop: () => { stopAt(context.currentTime); cleanup() } }
}

export interface MiraExampleNote { pitch: number; startTick: number; durationTicks: number; velocity: number }
export interface MiraExample { notes: readonly MiraExampleNote[] }

/** Isolated listening only: this controller has no project, MIDI, capture or history access. */
export class MiraExampleAudio {
  private context?: AudioContext
  private piano = new PianoSampleBank()
  private acoustic = new AcousticSampleBank()
  private voices: Voice[] = []
  private output?: GainNode
  private generation = 0
  private preparation?: AbortController
  private timer?: ReturnType<typeof setInterval>
  private completed?: () => void

  async play(example: MiraExample, source: Pick<Track, 'soundId' | 'level' | 'muted'>, bpm: number, done?: () => void): Promise<boolean> {
    this.stop()
    if (!example || !Array.isArray(example.notes) || example.notes.length < 1 || example.notes.length > 16
      || example.notes.some(note => !note || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127
        || !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127
        || !Number.isInteger(note.startTick) || note.startTick < 0
        || !Number.isInteger(note.durationTicks) || note.durationTicks < 1
        || note.startTick + note.durationTicks > 2 * TICKS_PER_BAR)) throw new TypeError('Example unavailable: use 1–16 valid notes contained within two bars.')
    if (!source || !isSoundId(source.soundId) || !isMelodicSound(source.soundId)
      || !Number.isInteger(source.level) || source.level < 0 || source.level > 100 || typeof source.muted !== 'boolean'
      || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) throw new TypeError('Example instrument or tempo is invalid.')
    if (source.muted || source.level === 0) throw new Error('This track is muted or its volume is zero. Unmute it or raise its volume to hear the example.')
    // Snapshot before awaiting: later edits cannot change a pending demonstration.
    const notes = example.notes.map(note => ({ ...note })), { soundId, level } = source
    const generation = this.generation, preparation = new AbortController()
    this.preparation = preparation
    try {
      if (!this.context) {
        this.context = new AudioContext()
        this.context.addEventListener('statechange', () => {
          if (this.context?.state === 'suspended' || this.context?.state === 'closed') {
            const notify = this.completed
            this.stop(); notify?.()
          }
        })
      }
      const context = this.context
      await abortable(context.resume(), preparation.signal)
      if (soundId === 'piano') {
        if (!await abortable(this.piano.prepare(context, { retry: true, timeoutMs: 8000 }), preparation.signal)) throw new Error('Piano samples unavailable. Retry the example; no substitute was played.')
      } else await abortable(this.acoustic.prepare(context, soundId, true), preparation.signal)
      if (generation !== this.generation) return false
      this.preparation = undefined
      const output = context.createGain(); output.gain.setValueAtTime(level / 100, context.currentTime); output.connect(context.destination); this.output = output
      const start = context.currentTime + .05, secondsPerTick = 60 / bpm / 480
      for (const note of notes) this.voices.push(voice(context, output, this.piano, this.acoustic, { ...note, soundId }, start + note.startTick * secondsPerTick, note.durationTicks * secondsPerTick))
      const end = start + Math.max(...notes.map(note => note.startTick + note.durationTicks)) * secondsPerTick + .85
      this.completed = done
      this.timer = setInterval(() => {
        if (generation !== this.generation || context.currentTime < end) return
        this.stop(); done?.()
      }, 40)
      return true
    } catch (error) {
      if (generation !== this.generation || preparation.signal.aborted) return false
      this.stop(); throw error
    }
  }

  stop(): void {
    this.generation++
    this.preparation?.abort(); this.preparation = undefined
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined; this.completed = undefined
    this.voices.forEach(item => item.stop()); this.voices = []
    this.output?.disconnect(); this.output = undefined
  }

  dispose(): void { this.stop(); const context = this.context; this.context = undefined; void context?.close() }
}

export class StudioAudio {
  private context?: AudioContext
  private project?: StudioProject
  private validated = new WeakSet<StudioProject>()
  private populated = new Set<string>()
  private graph?: ReturnType<typeof createTrackMixGraph>
  private piano = new PianoSampleBank()
  private acoustic = new AcousticSampleBank()
  private midiOutput = new ExternalMidi()
  private monitorMidiLocally = false
  private live = new Map<string, Voice>()
  private liveTracks = new Map<string, string>()
  private releasing = new Map<Voice, string>()
  private pending = new Map<string, symbol>()
  private scheduled = new Map<Voice, number>()
  private preview?: Voice
  private previewTrackId?: string
  private previewGeneration = 0
  private generation = 0
  private timer?: number
  private onInterrupted?: () => void
  private solo = new Set<string>()
  private expressionTick = 0
  private refreshExpression?: () => void
  setExpressionPosition(tick: number) { if (Number.isFinite(tick) && tick >= 0) { this.expressionTick = tick; if (!this.playback) this.graph?.expressionPosition(tick) } }
  private playback?: { project: StudioProject; notes: CompiledNote[]; live: boolean; clipIds?: ReadonlySet<string> }
  setInterruptionHandler(handler?: () => void) { this.onInterrupted = handler }
  setMidiOutput(output?: MIDIOutput, trackId?: string, channel?: number, monitorLocal = false, { onFailure, projectId = this.project?.id }: { onFailure?: () => void; projectId?: string } = {}) {
    this.midiOutput.setRoute(output, projectId, trackId, channel, onFailure)
    this.monitorMidiLocally = monitorLocal
  }
  releaseMidiOutput() { this.midiOutput.stop() }
  setProject(project: StudioProject) {
    assertStudioProject(project)
    const populatedPatterns = new Set(project.patterns.filter(pattern => pattern.notes.length > 0).map(pattern => pattern.id))
    const populated = new Set(project.clips.filter(clip => populatedPatterns.has(clip.patternId)).map(clip => clip.trackId))
    const changedProject = this.project !== undefined && this.project.id !== project.id
    const changedTracks = new Set(this.project?.tracks.filter(old => project.tracks.find(track => track.id === old.id)?.soundId !== old.soundId).map(track => track.id))
    const midiTrack = this.midiOutput.trackFor(project.id)
    if (changedProject || (midiTrack && !audibleTracks(project.tracks, this.solo).some(track => track.id === midiTrack))) this.midiOutput.stop()
    if (changedProject || changedTracks.size) {
      this.pending.clear()
      for (const [key, item] of this.live) if (changedProject || changedTracks.has(this.liveTracks.get(key)!)) { item.stop(); this.live.delete(key); this.liveTracks.delete(key) }
      for (const [item, trackId] of this.releasing) if (changedProject || changedTracks.has(trackId)) item.stop()
      if (changedProject || (this.previewTrackId && changedTracks.has(this.previewTrackId))) this.stopPreview()
    }
    this.project = structuredClone(project); this.validated.add(this.project); this.populated = populated; this.graph?.setTracks(this.mixTracks(project))
    this.graph?.expressionPosition(this.expressionTick)
    this.refreshExpression?.()
  }
  private mixTracks(project: StudioProject) { return project.tracks.map(track => ({ ...track, muted: track.muted || (this.solo.size > 0 && !this.solo.has(track.id)) })) }
  setSolo(trackIds: readonly string[]): boolean {
    this.solo = new Set(trackIds)
    if (this.project) this.graph?.setTracks(this.mixTracks(this.project))
    this.refreshExpression?.()
    const audibleIds = new Set(this.project ? audibleTracks(this.project.tracks, this.solo).map(track => track.id) : [])
    const midiTrack = this.midiOutput.trackFor(this.project?.id)
    if (midiTrack && !audibleIds.has(midiTrack)) this.midiOutput.stop()
    const externalTrack = this.playback && this.externalOnlyTrack(this.playback.project.id)
    if (this.playback && this.playback.notes.some(note => note.trackId !== externalTrack && audibleIds.has(note.trackId) && this.soundStatus(note.soundId) !== 'ready')) {
      this.stop(); return false
    }
    return true
  }
  meterSnapshot(): StudioMeters { return this.graph?.meters() ?? { tracks: {}, master: 0, clipping: false } }
  get time() { return this.context?.currentTime ?? 0 }
  get label() {
    const sounds = this.project?.tracks.map(track => track.soundId) ?? []
    if (sounds.includes('piano') && this.piano.status === 'fallback') return 'Piano samples unavailable — Retry sound'
    if (sounds.some(id => this.acoustic.status(id) === 'loading')) return 'Loading instrument samples…'
    if (sounds.some(id => this.acoustic.status(id) === 'error')) return 'Instrument samples unavailable — Retry sound'
    return this.context?.state === 'running' ? 'Sound ready' : 'Click a key to enable sound'
  }
  soundStatus(id: SoundId) { return id === 'piano' ? this.piano.status : isAcousticSound(id) ? this.acoustic.status(id) : 'ready' }
  private ensureContext() {
    if (!this.context || this.context.state === 'closed') {
      this.graph?.dispose(); this.context = new AudioContext({ latencyHint: 'interactive' }); this.graph = createTrackMixGraph(this.context, this.context.destination, this.project ? this.mixTracks(this.project) : [])
      this.graph.expressionPosition(this.expressionTick)
      this.context.addEventListener('statechange', () => { if (this.context?.state === 'suspended') { this.stop(); this.onInterrupted?.() } })
    }
    return this.context
  }
  /** Decode the selected instrument before a keypress, without starting audio. */
  async preloadTrack(trackId: string) {
    const track = this.track(trackId)
    await this.prepareSound(this.ensureContext(), track.soundId)
  }
  private async prepareSound(context: AudioContext, soundId: SoundId) {
    if (soundId === 'piano') {
      if (!await this.piano.prepare(context, { timeoutMs: 8000 })) throw new Error('Piano samples unavailable. Retry sound; no substitute was played.')
    } else await this.acoustic.prepare(context, soundId)
  }
  private externalOnlyTrack(projectId: string) {
    return this.monitorMidiLocally ? undefined : this.midiOutput.trackFor(projectId)
  }
  async unlock() {
    const context = this.ensureContext()
    await context.resume()
    if (context.state !== 'running') throw new Error('Sound is paused. Click a key to enable it.')
    return context
  }
  async prepareTracks(project: StudioProject, trackIds?: readonly string[], signal?: AbortSignal, allowExternalMidi = false) {
    if (!this.validated.has(project)) { assertStudioProject(project); this.validated.add(project) }
    if (signal?.aborted) throw new DOMException('Instrument preparation cancelled.', 'AbortError')
    let tracks: Track[]
    if (trackIds === undefined) {
      const populated = project === this.project ? this.populated : new Set(project.clips.filter(clip => project.patterns.some(pattern => pattern.id === clip.patternId && pattern.notes.length > 0)).map(clip => clip.trackId))
      tracks = audibleTracks(project.tracks, this.solo).filter(track => populated.has(track.id))
    } else tracks = trackIds.map(id => { const track = project.tracks.find(item => item.id === id); if (!track) throw new Error('Recording destination no longer exists.'); return track })
    const externalTrack = allowExternalMidi ? this.externalOnlyTrack(project.id) : undefined
    const neededSounds = new Set(tracks.filter(track => track.id !== externalTrack).map(track => track.soundId))
    const fallbackSound = tracks.find(track => track.id === externalTrack)?.soundId
    const context = await abortable(this.unlock(), signal)
    // The external-only destination has no local sample prerequisite. Prepare
    // its fallback opportunistically, without delaying playback or count-in.
    if (fallbackSound && !neededSounds.has(fallbackSound)) void this.prepareSound(context, fallbackSound).catch(() => {})
    await abortable(Promise.all([...neededSounds].map(sound => this.prepareSound(context, sound))), signal)
    return context
  }
  private track(id: string): Track { const track = this.project?.tracks.find(item => item.id === id); if (!track) throw new Error('Select an existing instrument track.'); return track }
  async retrySound(id: SoundId) { const context = await this.unlock(); if (id === 'piano') { if (!await this.piano.prepare(context, { retry: true, timeoutMs: 8000 })) throw new Error('Piano samples unavailable. Please retry.'); } else await this.acoustic.prepare(context, id, true) }
  async noteOn(key: string, pitch: number, velocity: number, trackId: string, sendToMidi = false) {
    validatePreview({ pitch, velocity }); const original = this.track(trackId)
    this.noteOff(key); const token = Symbol(); this.pending.set(key, token)
    try {
      if (!audibleTracks([original], this.solo).length) { this.pending.delete(key); return }
      const sent = sendToMidi && trackId === this.midiOutput.trackFor(this.project?.id) && this.midiOutput.noteOn(key, pitch, velocity)
      if (sent && !this.monitorMidiLocally) { this.pending.delete(key); return }
      // A warm live note must reach Web Audio in this same event turn. Transport
      // lookahead and asynchronous instrument preparation are only for cold starts.
      const context = this.context?.state === 'running' && this.soundStatus(original.soundId) === 'ready'
        ? this.context : await this.prepareTracks(this.project!, [trackId])
      if (this.pending.get(key) !== token || this.project?.tracks.find(track => track.id === trackId)?.soundId !== original.soundId) { if (this.pending.get(key) === token) this.pending.delete(key); return }
      this.pending.delete(key)
      const item = voice(context, this.graph!.channels.get(trackId)!, this.piano, this.acoustic, { pitch, velocity, soundId: original.soundId }, context.currentTime, undefined, () => {
        this.releasing.delete(item)
        if (this.live.get(key) === item) { this.live.delete(key); this.liveTracks.delete(key) }
      })
      this.live.set(key, item); this.liveTracks.set(key, trackId)
    } catch (error) {
      if (this.pending.get(key) === token) { this.pending.delete(key); this.midiOutput.noteOff(key) }
      throw error
    }
  }
  noteOff(key: string) {
    this.pending.delete(key)
    this.midiOutput.noteOff(key)
    const item = this.live.get(key), trackId = this.liveTracks.get(key)
    // A released key can still sound during its envelope tail. Keep ownership until
    // the source ends so panic/all-notes-off also silences these in-flight voices.
    if (item) { this.releasing.set(item, trackId!); item.release(this.time) }
    this.live.delete(key); this.liveTracks.delete(key)
  }
  silenceKeys() { this.pending.clear(); this.midiOutput.silenceKeys(); this.live.forEach(item => item.stop()); this.live.clear(); this.liveTracks.clear(); for (const item of this.releasing.keys()) item.stop(); this.releasing.clear() }
  async previewNote(note: { pitch: number; velocity: number }, trackId: string) {
    validatePreview(note); const original = this.track(trackId); this.stopPreview(); this.previewTrackId = trackId; const generation = this.previewGeneration
    if (!audibleTracks([original], this.solo).length) return
    const context = await this.prepareTracks(this.project!, [trackId])
    if (generation !== this.previewGeneration || this.project?.tracks.find(track => track.id === trackId)?.soundId !== original.soundId) return
    this.preview = voice(context, this.graph!.channels.get(trackId)!, this.piano, this.acoustic, { ...note, soundId: original.soundId }, context.currentTime, .35)
  }
  async previewSound(id: SoundId) {
    const sound = soundById(id); if (!sound) throw new Error('Unknown sound.')
    this.stopPreview(); const generation = this.previewGeneration, context = await this.unlock()
    if (id === 'piano') { if (!await this.piano.prepare(context, { timeoutMs: 8000 })) throw new Error('Piano samples unavailable. Retry sound; no substitute was played.') } else await this.acoustic.prepare(context, id)
    if (generation !== this.previewGeneration) return
    this.preview = voice(context, context.destination, this.piano, this.acoustic, { pitch: sound.previewPitch, velocity: 85, soundId: id }, context.currentTime, .6)
  }
  stopPreview() { this.previewGeneration++; this.preview?.stop(); this.preview = undefined; this.previewTrackId = undefined }
  stop() {
    this.generation++; if (this.timer !== undefined) window.clearInterval(this.timer)
    this.midiOutput.stop()
    this.timer = undefined; this.playback = undefined; this.refreshExpression = undefined; this.scheduled.forEach((_end, item) => item.stop()); this.scheduled.clear(); this.silenceKeys(); this.stopPreview()
    // Discard the hall's buffered tail as well as sources. Future listening gets a clean graph.
    if (this.context && this.graph) { this.graph.dispose(); this.graph = createTrackMixGraph(this.context, this.context.destination, this.project ? this.mixTracks(this.project) : []); this.graph.expressionPosition(this.expressionTick) }
  }
  updateSong(project: StudioProject): boolean {
    const session = this.playback
    if (!session?.live || !validateStudioProject(project) || project.id !== session.project.id || project.bpm !== session.project.bpm || project.bars !== session.project.bars) return false
    // Loading a newly selected acoustic sound requires a fresh Play, not silent substitution.
    const notes = compileArrangement(project).filter(note => !session.clipIds || session.clipIds.has(note.clipId)), audibleIds = new Set(audibleTracks(project.tracks, this.solo).map(track => track.id))
    const externalTrack = this.externalOnlyTrack(project.id)
    if (notes.some(note => note.trackId !== externalTrack && audibleIds.has(note.trackId) && this.soundStatus(note.soundId) !== 'ready')) return false
    session.project = structuredClone(project); session.notes = notes; this.setProject(project); return true
  }
  async play(project: StudioProject, update: (tick: number) => void, done: () => void, options: StudioPlaybackOptions = {}) {
    assertStudioProject(project)
    if (options.clipIds !== undefined && (!Array.isArray(options.clipIds) || !options.clipIds.length || new Set(options.clipIds).size !== options.clipIds.length || options.clipIds.some(id => !project.clips.some(clip => clip.id === id)))) throw new RangeError('Choose existing clips to audition.')
    const clipIds = options.clipIds ? new Set(options.clipIds) : undefined
    if (options.loopBar !== undefined && options.loopRange !== undefined) throw new RangeError('Choose either a loop bar or a loop range.')
    const loop = options.loopRange ?? (options.loopBar === undefined ? undefined : { startTick: options.loopBar * 1920, endTick: (options.loopBar + 1) * 1920 })
    if (loop && (!Number.isSafeInteger(loop.startTick) || !Number.isSafeInteger(loop.endTick) || loop.startTick < 0 || loop.endTick <= loop.startTick || loop.endTick > project.bars * 1920)) throw new RangeError('Choose a valid loop range.')
    const range = resolveStudioRange(project, loop ?? options)
    if (options.startTick !== undefined && (!Number.isSafeInteger(options.startTick) || options.startTick < 0 || options.startTick >= project.bars * 1920)) throw new RangeError('Choose a valid playback start position.')
    // A paused loop resumes at its phase, while ordinary starts outside its range
    // begin at the range boundary. The arrangement itself is never rewritten.
    const loopOffset = loop && options.startTick !== undefined && options.startTick >= loop.startTick && options.startTick < loop.endTick ? options.startTick - loop.startTick : 0
    if (options.startAt !== undefined && (!Number.isFinite(options.startAt) || options.startAt < 0)) throw new RangeError('Choose a valid playback start time.')
    this.stop(); const generation = this.generation, frozen = structuredClone(project)
    this.setProject(frozen); const session = { project: frozen, notes: compileArrangement(frozen).filter(note => !clipIds || clipIds.has(note.clipId)), live: options.live === true, clipIds }; this.playback = session
    try {
      const populated = new Set(session.notes.map(note => note.trackId))
      const externalTrack = this.externalOnlyTrack(frozen.id)
      const context = await this.prepareTracks(frozen, audibleTracks(frozen.tracks, this.solo).filter(track => populated.has(track.id)).map(track => track.id), undefined, true)
      if (generation !== this.generation) return
      const secondsPerTick = 60 / frozen.bpm / 480, start = options.startAt ?? context.currentTime + .12
      if (start < context.currentTime) throw new Error('Playback start expired while loading. Prepare instruments before count-in and retry.')
      const midiEpoch = performance.now() + (start - context.currentTime) * 1000
      let frontier = 0
      this.refreshExpression = () => {
        if (generation !== this.generation) return
        const elapsed = context.currentTime - start, horizon = Math.max(0, (elapsed + .2) / secondsPerTick)
        // Schedule absolute-song expression over this lookahead, splitting at loop boundaries.
        let expressionFrom = Math.max(0, elapsed / secondsPerTick)
        const phaseNow = loop ? (expressionFrom + loopOffset) % (range.endTick - range.startTick) : expressionFrom
        this.graph!.expressionPosition(range.startTick + phaseNow)
        while (expressionFrom < horizon) {
          const length = range.endTick - range.startTick
          const phase = loop ? (expressionFrom + loopOffset) % length : expressionFrom
          const span = loop ? Math.min(horizon - expressionFrom, length - phase) : horizon - expressionFrom
          this.graph!.scheduleExpression(range.startTick + phase, range.startTick + phase + span, start + expressionFrom * secondsPerTick, secondsPerTick)
          expressionFrom += span
        }
      }
      const scheduleLocal = (note: CompiledNote, at: number, duration: number) => {
        if (generation !== this.generation) return false
        const destination = this.graph!.channels.get(note.trackId)
        if (!destination) return true
        if (this.scheduled.size >= 10000) { this.stop(); done(); options.failed?.(new Error('Too many overlapping voices. Shorten held notes.')); return false }
        const startedAt = Math.max(context.currentTime, at)
        const item = voice(context, destination, this.piano, this.acoustic, note, startedAt, duration)
        this.scheduled.set(item, startedAt + (isMelodicSound(note.soundId) ? Math.max(.01, duration) + .81 : .34))
        return true
      }
      const scheduleFallback = (note: CompiledNote, at: number, duration: number) => {
        if (generation !== this.generation) return false
        if (this.soundStatus(note.soundId) === 'ready') return scheduleLocal(note, at, duration)
        void this.prepareSound(context, note.soundId).then(() => {
          const remaining = at + duration - Math.max(context.currentTime, at)
          if (remaining <= 0 || !audibleTracks(session.project.tracks, this.solo).some(track => track.id === note.trackId)) return
          scheduleLocal(note, at, remaining)
        }).catch(() => { /* The sound status reports an unavailable local fallback. */ })
        return true
      }
      const pump = () => {
        if (generation !== this.generation) return
        const elapsed = context.currentTime - start, horizon = Math.max(frontier, (elapsed + .2) / secondsPerTick), from = Math.max(frontier, elapsed / secondsPerTick)
        this.refreshExpression?.()
        this.scheduled.forEach((endAt, item) => { if (endAt < context.currentTime) this.scheduled.delete(item) })
        const audibleIds = new Set(audibleTracks(session.project.tracks, this.solo).map(track => track.id))
        const audibleNotes = session.notes.filter(note => audibleIds.has(note.trackId))
        const rangeNotes = loop ? audibleNotes : notesForRange(audibleNotes, range.startTick, range.endTick)
        const events = loop
          ? notesInPlaybackWindow(rangeNotes, from + loopOffset, horizon + loopOffset, loop).map(event => ({ ...event, tick: event.tick - loopOffset }))
          : notesInPlaybackWindow(rangeNotes, from, horizon)
        // Chase notes already sounding at the resumed phase once. Later cycles
        // still attack only notes whose starts lie inside the chosen loop range.
        if (loop && loopOffset > 0 && from <= 0 && horizon > 0) {
          const resumedTick = loop.startTick + loopOffset
          for (const note of audibleNotes) if (note.startTick < resumedTick && note.startTick + note.durationTicks > resumedTick) events.unshift({ note, tick: 0, durationTicks: note.startTick + note.durationTicks - resumedTick })
        }
        const midiTrack = this.midiOutput.trackFor(session.project.id)
        for (const event of events) {
          const note = event.note as CompiledNote
          const at = Math.max(context.currentTime, start + event.tick * secondsPerTick), duration = (event.durationTicks ?? note.durationTicks) * secondsPerTick
          if (note.trackId === midiTrack) {
            const length = range.endTick - range.startTick
            const loopEnd = start + (event.tick + length - (event.tick + loopOffset) % length) * secondsPerTick
            const end = loop ? Math.min(at + duration, loopEnd) : at + duration
            const fallback = this.monitorMidiLocally ? undefined : () => {
              try { scheduleFallback(note, at, duration) }
              catch (error) { this.stop(); done(); options.failed?.(error instanceof Error ? error : new Error(String(error))) }
            }
            const queued = this.midiOutput.schedule(note.pitch, note.velocity, midiEpoch + (at - start) * 1000, midiEpoch + (end - start) * 1000, fallback)
            if (queued && fallback) continue
          }
          const schedule = note.trackId === externalTrack ? scheduleFallback : scheduleLocal
          if (!schedule(note, at, duration)) return
        }
        if (midiTrack) this.midiOutput.flush(midiEpoch + horizon * secondsPerTick * 1000)
        if (generation !== this.generation) return
        if (options.metronome) {
          for (const click of metronomeWindow(frozen, from, horizon, range, !!loop, loopOffset)) this.click(start + click.tick * secondsPerTick, { volume: options.metronomeSettings?.volume ?? 0.7, accent: click.accent && options.metronomeSettings?.accent !== false })
        }
        frontier = horizon; const position = Math.max(0, elapsed / secondsPerTick)
        const absolutePosition = loop ? loop.startTick + (position + loopOffset) % (loop.endTick - loop.startTick) : Math.min(range.endTick, range.startTick + position)
        this.expressionTick = absolutePosition; update(absolutePosition)
        const end = Math.max(range.endTick - range.startTick, ...rangeNotes.map(note => note.startTick + note.durationTicks)) * secondsPerTick
        if (!loop && elapsed >= end + productionTail(session.project.tracks.filter(track => rangeNotes.some(note => note.trackId === track.id)))) { this.stop(); done() }
      }
      pump(); if (generation === this.generation) this.timer = window.setInterval(pump, 25)
    } catch (error) { if (generation !== this.generation) return; this.stop(); throw error }
  }
  click(at: number, settings: { volume: number; accent: boolean } = { volume: 0.7, accent: false }) {
    if (!this.context) return
    const oscillator = this.context.createOscillator(), gain = this.context.createGain()
    oscillator.frequency.value = settings.accent ? 1400 : 1000; gain.gain.setValueAtTime(Math.max(.00001, .05 * Math.min(1, Math.max(0, settings.volume)) * (settings.accent ? 1.25 : 1)), at); gain.gain.exponentialRampToValueAtTime(.00001, at + .04)
    oscillator.connect(gain); gain.connect(this.context.destination); oscillator.start(at); oscillator.stop(at + .05)
    const item = { release: () => {}, stop: () => { try { oscillator.stop() } catch { /* ended */ } oscillator.disconnect(); gain.disconnect() } }
    this.scheduled.set(item, at + .05); oscillator.onended = () => { item.stop(); this.scheduled.delete(item) }
  }
  async wav(project: StudioProject, options: StudioRange = {}) {
    assertStudioProject(project); const frozen = structuredClone(project), range = resolveStudioRange(frozen, options)
    const notes = notesForRange(audibleArrangement(frozen), range.startTick, range.endTick)
    const duration = Math.max(range.endTick - range.startTick, ...notes.map(note => note.startTick + note.durationTicks)) * 60 / frozen.bpm / 480 + productionTail(frozen.tracks.filter(track => notes.some(note => note.trackId === track.id)))
    if (duration > 600) throw new Error('WAV export is limited to 10 minutes to protect memory. Save your full .nadi project or MIDI instead.')
    const context = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000), piano = new PianoSampleBank(), acoustic = new AcousticSampleBank()
    for (const id of new Set(notes.map(note => note.soundId))) {
      if (id === 'piano') { if (!await piano.prepare(context, { timeoutMs: 8000 })) throw new Error('Piano samples unavailable. WAV was not substituted; save .nadi or MIDI and retry.'); }
      else await acoustic.prepare(context, id)
    }
    const graph = createTrackMixGraph(context, context.destination, frozen.tracks)
    graph.scheduleExpression(range.startTick, range.startTick + duration * frozen.bpm * 480 / 60, 0, 60 / frozen.bpm / 480)
    try { notes.forEach(note => voice(context, graph.channels.get(note.trackId)!, piano, acoustic, note, note.startTick * 60 / frozen.bpm / 480, note.durationTicks * 60 / frozen.bpm / 480)); const buffer = await context.startRendering(); return { bytes: encodePcm16Wave(buffer), peak: measureSamplePeak(buffer) } }
    finally { graph.dispose() }
  }
  dispose() { this.stop(); this.onInterrupted = undefined; this.graph?.dispose(); this.graph = undefined; void this.context?.close() }
}
function validatePreview(note: { pitch: number; velocity: number }) { if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 || !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) throw new TypeError('Cannot preview an invalid note.') }

/** Named MIDI tracks preserve musical data regardless of track volume, mute or hidden status. */
export function studioMidi(project: StudioProject): Uint8Array {
  assertStudioProject(project); const notes = compileArrangement(project), text = new TextEncoder()
  const vlq = (n: number) => { const result = [n & 127]; for (let v = n >>> 7; v > 0; v >>>= 7) result.unshift((v & 127) | 128); return result }
  const chunk = (name: string, body: number[]) => { const data = new Uint8Array(body.length + 8); data.set(text.encode(name)); new DataView(data.buffer).setUint32(4, body.length); data.set(body, 8); return data }
  const micros = Math.round(60000000 / project.bpm), end = project.bars * 1920
  const tracks = [chunk('MTrk', [0, 255, 81, 3, micros >> 16 & 255, micros >> 8 & 255, micros & 255, 0, 255, 88, 4, 4, 2, 24, 8, ...vlq(end), 255, 47, 0])]
  let melodicChannel = 0
  for (const track of project.tracks) {
    if (melodicChannel === 9) melodicChannel++
    const melodic = isMelodicSound(track.soundId), channel = melodic ? melodicChannel++ : 9
    const events: { tick: number; off: boolean; data: number[] }[] = []
    notes.filter(note => note.trackId === track.id).forEach(note => {
      const pitch = melodic ? note.pitch : soundById(track.soundId).previewPitch
      events.push({ tick: note.startTick, off: false, data: [144 | channel, pitch, note.velocity] }, { tick: note.startTick + note.durationTicks, off: true, data: [128 | channel, pitch, 0] })
    })
    events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off))
    const name = text.encode(track.name), data = [0, 255, 3, ...vlq(name.length), ...name]
    if (melodic) data.push(0, 192 | channel, soundById(track.soundId).program)
    let last = 0; events.forEach(event => { data.push(...vlq(event.tick - last), ...event.data); last = event.tick })
    data.push(...vlq(Math.max(0, end - last)), 255, 47, 0); tracks.push(chunk('MTrk', data))
  }
  const header = chunk('MThd', [0, 1, tracks.length >> 8, tracks.length & 255, 1, 224]), output = new Uint8Array(header.length + tracks.reduce((sum, track) => sum + track.length, 0))
  output.set(header); let offset = header.length; tracks.forEach(track => { output.set(track, offset); offset += track.length }); return output
}
