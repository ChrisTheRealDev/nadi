import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreationAudio, createMixGraph, creationMidi } from './audio'
import { createDefaultMix, createProject } from './model'
import { PianoSampleBank } from '../lib/pianoSampleBank'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function audioHarness(resume?: () => Promise<void>) {
  const contexts: FakeContext[] = []
  const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() })
  const gainNode = () => ({ gain: parameter(), connect: vi.fn(), disconnect: vi.fn() })
  const source = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: parameter(), playbackRate: { value: 1 }, onended: null })
  class FakeContext {
    currentTime = 0
    sampleRate = 48000
    state = 'running'
    destination = {} as AudioNode
    gains: ReturnType<typeof gainNode>[] = []
    sources: ReturnType<typeof source>[] = []
    constructor(public channels = 2, public length = 96000) { contexts.push(this) }
    createGain() {
      const node = gainNode()
      this.gains.push(node)
      return node
    }
    createOscillator() { const node = source(); this.sources.push(node); return node }
    createBufferSource() { const node = { ...source(), buffer: undefined as unknown }; this.sources.push(node); return node }
    createBiquadFilter() { return { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() } }
    createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } }
    addEventListener() {}
    async resume() { await resume?.() }
    async close() { this.state = 'closed' }
    async startRendering() {
      const values = new Float32Array([.2, -.2])
      return { numberOfChannels: 2, length: 2, sampleRate: 48000, getChannelData: () => values } as unknown as AudioBuffer
    }
  }
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('OfflineAudioContext', FakeContext)
  vi.spyOn(PianoSampleBank.prototype, 'prepare').mockResolvedValue(true)
  vi.spyOn(PianoSampleBank.prototype, 'select').mockReturnValue(undefined)
  return contexts
}

function readMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 14
  const tracks: { tick: number; status: number; data: number[] }[][] = []
  for (let track = 0; track < view.getUint16(10); track++) {
    const end = offset + 8 + view.getUint32(offset + 4); offset += 8
    let tick = 0
    const events = []
    const vlq = () => { let value = 0, next: number; do { next = bytes[offset++]; value = value * 128 + (next & 127) } while (next & 128); return value }
    while (offset < end) {
      tick += vlq(); const status = bytes[offset++]
      if (status === 255) { const type = bytes[offset++], length = vlq(); events.push({ tick, status: type, data: [...bytes.slice(offset, offset + length)] }); offset += length }
      else { const length = (status & 240) === 192 ? 1 : 2; events.push({ tick, status, data: [...bytes.slice(offset, offset + length)] }); offset += length }
    }
    tracks.push(events)
  }
  return { ppq: view.getUint16(12), tracks }
}
describe('creation MIDI transfer', () => {
  it('ignores volume and Mute while retaining all original note events', () => {
    const project = createProject()
    project.notes = [{ id: 'n', instrument: 'piano', pitch: 60, startTick: 77, durationTicks: 7033, velocity: 92 }]
    const before = creationMidi(project)
    project.mix.piano = { level: 0, muted: true }
    project.mix.kick = { level: 12, muted: true }
    expect(creationMidi(project)).toEqual(before)
  })
  it('retains tempo, leading rests, long-song positions and drum channel ten', () => {
    const project = createProject(); project.bpm = 120; project.bars = 16
    project.notes = [
      { id: 'piano', instrument: 'piano', pitch: 69, startTick: 19200, durationTicks: 960, velocity: 71 },
      { id: 'kick', instrument: 'kick', pitch: 36, startTick: 19680, durationTicks: 60, velocity: 95 },
      { id: 'snare', instrument: 'snare', pitch: 38, startTick: 20160, durationTicks: 60, velocity: 83 },
    ]
    const midi = readMidi(creationMidi(project))
    expect(midi.ppq).toBe(480)
    expect(midi.tracks[0]).toContainEqual({ tick: 0, status: 81, data: [7, 161, 32] })
    expect(midi.tracks[1]).toContainEqual({ tick: 19200, status: 144, data: [69, 71] })
    expect(midi.tracks[1]).toContainEqual({ tick: 20160, status: 128, data: [69, 0] })
    expect(midi.tracks[2]).toContainEqual({ tick: 19680, status: 153, data: [36, 95] })
    expect(midi.tracks[2]).toContainEqual({ tick: 20160, status: 153, data: [38, 83] })
    expect(midi.tracks.every(track => track.at(-1)?.tick === 30720)).toBe(true)
  })
  it('puts note-off before reattack at the same tick and does not mutate the project', () => {
    const project = createProject()
    project.notes = [0, 480].map((startTick, index) => ({ id: `n${index}`, instrument: 'piano', pitch: 60, startTick, durationTicks: 480, velocity: 80 }))
    const original = JSON.stringify(project)
    const notes = readMidi(creationMidi(project)).tracks[1].filter(event => event.tick === 480)
    expect(notes.map(event => event.status)).toEqual([128, 144])
    expect(JSON.stringify(project)).toBe(original)
  })
})

describe('shared creation audio mixer graph', () => {
  it('retains the actual minimum piano tail in Stop bookkeeping for one-tick notes', async () => {
    const contexts = audioHarness(); let pump = () => {}
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval: vi.fn() })
    const audio = new CreationAudio(), p = createProject(); p.bpm = 300
    p.notes = [{ id: 'tiny', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 1, velocity: 90 }]
    await audio.play(p, vi.fn(), vi.fn(), { live: true })
    const c = contexts[0]; c.currentTime = .535; pump(); audio.stop()
    expect(c.sources[0].stop).toHaveBeenLastCalledWith(.535)
  })
  it('applies live edits only beyond the queued frontier and keeps long tails; Stop cancels updates', async () => {
    const contexts = audioHarness()
    let pump = () => {}
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval: vi.fn() })
    const audio = new CreationAudio(), p = createProject(); p.bpm = 120
    p.notes = [
      { id: 'held', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 4000, velocity: 90 },
      { id: 'queued', instrument: 'piano', pitch: 61, startTick: 240, durationTicks: 480, velocity: 90 },
      { id: 'future', instrument: 'piano', pitch: 62, startTick: 960, durationTicks: 480, velocity: 90 },
    ]
    await audio.play(p, vi.fn(), vi.fn(), { live: true })
    const c = contexts[0]
    expect(c.sources).toHaveLength(1)
    c.currentTime = .2; pump(); expect(c.sources).toHaveLength(2)
    const heldStopCalls = c.sources[0].stop.mock.calls.slice()
    const next = structuredClone(p); next.notes = [
      { ...p.notes[0], pitch: 80, durationTicks: 1 },
      { ...p.notes[2], pitch: 72 },
      { ...p.notes[1], id: 'past', startTick: 1 },
    ]
    expect(audio.updateSong(next)).toBe(true)
    c.currentTime = .99; pump()
    expect(c.sources).toHaveLength(3)
    expect(c.sources[2].frequency.value).toBeCloseTo(523.251)
    expect(c.sources[0].stop.mock.calls).toEqual(heldStopCalls)
    pump(); expect(c.sources).toHaveLength(3)
    audio.stop(); c.currentTime = 3; pump(); expect(c.sources).toHaveLength(3)
    expect(audio.updateSong(next)).toBe(false)
  })
  it('loops a chosen bar exactly once at boundaries, retaining long note tails and new edits', async () => {
    const contexts = audioHarness(); let pump = () => {}
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval: vi.fn() })
    const audio = new CreationAudio(), p = createProject(); p.bpm = 120
    p.notes = [{ id: 'n', instrument: 'piano', pitch: 60, startTick: 1920, durationTicks: 3000, velocity: 90 }]
    const done = vi.fn()
    await audio.play(p, vi.fn(), done, { live: true, loopBar: 1 })
    const c = contexts[0]; expect(c.sources).toHaveLength(1)
    expect(c.sources[0].stop).toHaveBeenCalledWith(.12 + 3000 / 960 + .41)
    c.currentTime = 1.94; pump(); expect(c.sources).toHaveLength(2)
    pump(); expect(c.sources).toHaveLength(2)
    const next = structuredClone(p); next.notes[0].pitch = 72; audio.updateSong(next)
    c.currentTime = 3.94; pump(); expect(c.sources).toHaveLength(3)
    expect(c.sources[2].frequency.value).toBeCloseTo(523.251)
    expect(done).not.toHaveBeenCalled(); audio.stop()
  })
  it('loops an absolute tick range, chases initial tails once, and keeps absolute playhead position', async () => {
    const contexts = audioHarness(); let pump = () => {}
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval: vi.fn() })
    const audio = new CreationAudio(), p = createProject(); p.bpm = 120
    p.notes = [
      { id: 'chased', instrument: 'piano', pitch: 59, startTick: 1800, durationTicks: 300, velocity: 90 },
      { id: 'start', instrument: 'piano', pitch: 60, startTick: 1920, durationTicks: 800, velocity: 90 },
      { id: 'end', instrument: 'piano', pitch: 61, startTick: 2400, durationTicks: 100, velocity: 90 },
    ]
    const update = vi.fn()
    await audio.play(p, update, vi.fn(), { live: true, loopRange: { startTick: 1920, endTick: 2400 } })
    const c = contexts[0]
    expect(c.sources).toHaveLength(2)
    expect(c.sources[0].stop).toHaveBeenCalledWith(.12 + 180 / 960 + .41)
    expect(c.sources[1].stop).toHaveBeenCalledWith(.12 + 800 / 960 + .41)
    expect(update).toHaveBeenLastCalledWith(1920)

    c.currentTime = .45; pump()
    expect(c.sources).toHaveLength(3)
    expect(c.sources.filter(source => source.frequency.value === 440 * 2 ** ((59 - 69) / 12))).toHaveLength(1)
    expect(update.mock.lastCall?.[0]).toBeCloseTo(1920 + 316.8)

    const next = structuredClone(p); next.notes[1].pitch = 72
    expect(audio.updateSong(next)).toBe(true)
    c.currentTime = .95; pump()
    expect(c.sources).toHaveLength(4)
    expect(c.sources[3].frequency.value).toBeCloseTo(523.251)
    expect(update.mock.lastCall?.[0]).toBeCloseTo(1920 + 316.8)
    audio.stop()
  })
  it('rejects ambiguous or invalid ranges without interrupting existing playback', async () => {
    audioHarness(); let pump = () => {}
    const clearInterval = vi.fn()
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval })
    const audio = new CreationAudio(), p = createProject()
    await audio.play(p, vi.fn(), vi.fn(), { live: true })
    await expect(audio.play(p, vi.fn(), vi.fn(), { loopBar: 0, loopRange: { startTick: 0, endTick: 480 } })).rejects.toThrow(/either/)
    await expect(audio.play(p, vi.fn(), vi.fn(), { loopRange: { startTick: -1, endTick: 480 } })).rejects.toThrow(/valid loop range/)
    await expect(audio.play(p, vi.fn(), vi.fn(), { loopRange: { startTick: 1.5, endTick: 480 } })).rejects.toThrow(/valid loop range/)
    await expect(audio.play(p, vi.fn(), vi.fn(), { loopRange: { startTick: 480, endTick: 480 } })).rejects.toThrow(/valid loop range/)
    await expect(audio.play(p, vi.fn(), vi.fn(), { loopRange: { startTick: 0, endTick: p.bars * 1920 + 1 } })).rejects.toThrow(/valid loop range/)
    expect(clearInterval).not.toHaveBeenCalled()
    pump()
    expect(audio.updateSong(p)).toBe(true)
    audio.stop()
  })
  it('rejects original replay, other projects and tempo/length changes as live edits', async () => {
    audioHarness(); vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    const audio = new CreationAudio(), p = createProject()
    await audio.play(p, vi.fn(), vi.fn())
    expect(audio.updateSong(p)).toBe(false)
    await audio.play(p, vi.fn(), vi.fn(), { live: true })
    expect(audio.updateSong({ ...p, bpm: 123 })).toBe(false)
    expect(audio.updateSong({ ...p, bars: 5 })).toBe(false)
    expect(audio.updateSong({ ...p, id: 'different' })).toBe(false)
    expect(audio.updateSong({ ...p, notes: [{ id: 'bad', instrument: 'piano', pitch: 999, startTick: 0, durationTicks: 1, velocity: 90 }] })).toBe(false)
    audio.stop()
  })
  it('does not resurrect stopped playback after asynchronous sample preparation', async () => {
    const contexts = audioHarness()
    const setInterval = vi.fn(() => 1)
    vi.stubGlobal('window', { setInterval, clearInterval: vi.fn() })
    let resolve!: (value: boolean) => void
    const pending = new Promise<boolean>(done => { resolve = done })
    vi.spyOn(PianoSampleBank.prototype, 'prepare').mockReturnValue(pending)
    const audio = new CreationAudio(), p = createProject()
    p.notes = [{ id: 'n', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }]
    const playing = audio.play(p, vi.fn(), vi.fn(), { live: true })
    await Promise.resolve(); await Promise.resolve()
    audio.stop(); resolve(true); await playing
    expect(contexts[0].sources).toHaveLength(0)
    expect(setInterval).not.toHaveBeenCalled()
    expect(audio.updateSong(p)).toBe(false)
  })
  it('song playback starts from the project mixer and responds to Mute while playing', async () => {
    const contexts = audioHarness()
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    const audio = new CreationAudio()
    const project = createProject(); project.mix.kick.level = 31
    project.notes = [{ id: 'hit', instrument: 'kick', pitch: 36, startTick: 0, durationTicks: 120, velocity: 100 }]
    const before = structuredClone(project)
    await audio.play(project, vi.fn(), vi.fn())
    const context = contexts[0]
    expect(context.gains[4].connect).toHaveBeenCalledWith(context.gains[1])
    expect(context.gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(.31, 0)
    const next = structuredClone(project.mix); next.kick.muted = true
    audio.setMix(next)
    expect(context.gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    expect(project).toEqual(before)
    audio.dispose()
  })

  it('changes monitoring volume/Mute on an already sounding key without changing note velocity', async () => {
    const contexts = audioHarness()
    const audio = new CreationAudio()
    const mix = createDefaultMix(); mix.piano.level = 40
    audio.setMix(mix)
    await audio.noteOn('held', 60, 96)
    const context = contexts[0]
    expect(context.gains[4].connect).toHaveBeenCalledWith(context.gains[0])
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(.4, 0)
    mix.piano.muted = true
    audio.setMix(mix)
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    expect(context.gains[4].gain.linearRampToValueAtTime).toHaveBeenCalledWith(96 / 127 * .26, .008)
    audio.dispose()
  })

  it('previews through the current mix without stopping song playback or mutating note data', async () => {
    const contexts = audioHarness(); let pump = () => {}
    const clearInterval = vi.fn()
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval })
    const audio = new CreationAudio(), project = createProject(); project.bpm = 120
    project.notes = [{ id: 'song', instrument: 'piano', pitch: 72, startTick: 480, durationTicks: 480, velocity: 90 }]
    await audio.play(project, vi.fn(), vi.fn(), { live: true })
    const preview = { instrument: 'piano' as const, pitch: 60, velocity: 87 }
    const before = structuredClone(preview)
    await audio.previewNote(preview)
    const context = contexts[0]
    expect(context.sources).toHaveLength(1)
    expect(context.gains[4].connect).toHaveBeenCalledWith(context.gains[0])
    expect(context.sources[0].stop.mock.calls[0][0]).toBeCloseTo(.66)
    expect(preview).toEqual(before)
    audio.stopPreview()
    expect(clearInterval).not.toHaveBeenCalled()
    context.currentTime = .5; pump()
    expect(context.sources).toHaveLength(2)
    expect(context.sources[1].frequency.value).toBeCloseTo(523.251)
    audio.stop()
  })

  it('replaces preview voices, keeps drum duration standard, and Stop kills the active preview', async () => {
    const contexts = audioHarness()
    const audio = new CreationAudio()
    await audio.previewNote({ instrument: 'piano', pitch: 60, velocity: 90 })
    const context = contexts[0], piano = context.sources[0]
    await audio.previewNote({ instrument: 'kick', pitch: 36, velocity: 100 })
    expect(piano.stop).toHaveBeenLastCalledWith(0)
    expect(context.sources).toHaveLength(2)
    expect(context.gains[5].connect).toHaveBeenCalledWith(context.gains[1])
    expect(context.sources[1].stop).toHaveBeenCalledWith(.34)
    audio.stop()
    expect(context.sources[1].stop).toHaveBeenLastCalledWith(0)
  })

  it('prevents stopped or superseded asynchronous preview initialization from sounding', async () => {
    const resumes: (() => void)[] = []
    const contexts = audioHarness(() => new Promise<void>(resolve => resumes.push(resolve)))
    const audio = new CreationAudio()
    const first = audio.previewNote({ instrument: 'piano', pitch: 60, velocity: 90 })
    await Promise.resolve()
    audio.stopPreview(); resumes.shift()?.(); await first
    expect(contexts[0].sources).toHaveLength(0)

    const stale = audio.previewNote({ instrument: 'piano', pitch: 61, velocity: 90 })
    await Promise.resolve()
    const latest = audio.previewNote({ instrument: 'snare', pitch: 38, velocity: 90 })
    await Promise.resolve()
    resumes.shift()?.(); await stale
    expect(contexts[0].sources).toHaveLength(0)
    resumes.shift()?.(); await latest
    expect(contexts[0].sources).toHaveLength(1)
    expect(contexts[0].gains[4].connect).toHaveBeenCalledWith(contexts[0].gains[2])
    audio.dispose()
  })

  it('WAV snapshots mix/notes, routes every voice through the matching bus, and retains sustained tails', async () => {
    const contexts = audioHarness()
    const project = createProject(); project.bpm = 120
    project.mix.piano = { level: 25, muted: false }; project.mix.kick.muted = true
    project.mix.snare.level = 50; project.mix.hat.level = 75
    project.notes = [
      { id: 'long', instrument: 'piano', pitch: 60, startTick: 73, durationTicks: 7500, velocity: 88 },
      ...(['kick', 'snare', 'hat'] as const).map((instrument, index) => ({ id: instrument, instrument, pitch: 36, startTick: 100 + index, durationTicks: 60, velocity: 96 })),
    ]
    const original = structuredClone(project)
    const audio = new CreationAudio()
    const rendering = audio.wav(project)
    // Mutation while the sample preparation awaits must not affect the render.
    project.mix.piano.level = 100; project.notes[0].durationTicks = 60
    const result = await rendering
    const context = contexts[0]
    expect(context.gains.slice(0, 4).map(node => node.gain.setValueAtTime.mock.lastCall?.[0])).toEqual([.25, 0, .5, .75])
    context.gains.slice(4).forEach((gain, index) => expect(gain.connect).toHaveBeenCalledWith(context.gains[index]))
    expect(context.sources[0].stop).toHaveBeenCalledWith((73 + 7500) / 960 + .41)
    expect(context.length).toBe(Math.ceil((original.bars * 4 * .5 + .5) * 48000))
    expect(result.bytes.slice(0, 4)).toEqual(new TextEncoder().encode('RIFF'))
    expect(project.notes[0].startTick).toBe(73)
    expect(context.gains.slice(0, 4).every(node => node.disconnect.mock.calls.length === 1)).toBe(true)
    audio.dispose()
  })

  it('routes four instruments through unity defaults and applies exact level/mute gains atomically', () => {
    const nodes = Array.from({ length: 4 }, () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn() } }))
    let index = 0
    const context = { currentTime: 3, createGain: () => nodes[index++] } as unknown as BaseAudioContext
    const destination = {} as AudioNode
    const graph = createMixGraph(context, destination, createDefaultMix())
    nodes.forEach(node => {
      expect(node.connect).toHaveBeenCalledWith(destination)
      expect(node.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 3)
    })
    const mix = createDefaultMix()
    mix.piano.level = 35; mix.kick.muted = true; mix.snare.level = 0; mix.hat.level = 72
    graph.setMix(mix)
    expect(nodes.map(node => node.gain.setValueAtTime.mock.lastCall?.[0])).toEqual([.35, 0, 0, .72])
    const counts = nodes.map(node => node.gain.setValueAtTime.mock.calls.length)
    mix.hat.level = 101
    expect(() => graph.setMix(mix)).toThrow()
    expect(nodes.map(node => node.gain.setValueAtTime.mock.calls.length)).toEqual(counts)
    graph.dispose()
    nodes.forEach(node => expect(node.disconnect).toHaveBeenCalledOnce())
  })

  it('rejects invalid mix or projects before opening browser audio or mutating music', async () => {
    const audio = new CreationAudio()
    const mix = createDefaultMix(); mix.piano.level = -1
    expect(() => audio.setMix(mix)).toThrow()
    const project = createProject(); project.notes = [{ id: 'invalid', instrument: 'piano', pitch: 128, startTick: 0, durationTicks: 480, velocity: 80 }]
    const before = structuredClone(project)
    await expect(audio.play(project, () => {}, () => {})).rejects.toThrow(/invalid/)
    await expect(audio.wav(project)).rejects.toThrow(/invalid/)
    expect(() => creationMidi(project)).toThrow(/invalid/)
    expect(project).toEqual(before)
  })
})
