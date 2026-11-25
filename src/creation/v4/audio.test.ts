import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioAudio, MiraExampleAudio, studioMidi, createTrackMixGraph } from './audio'
import { createStudioProject, compileArrangement } from './model'
import { addTrack, duplicateClip } from './operations'
import { PianoSampleBank } from '../../lib/pianoSampleBank'
import { AcousticSampleBank } from './sampleBank'
import { ORCHESTRA_IDS, acousticEnvelope } from './sounds'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function harness(resume?: () => Promise<void>) {
  const contexts: FakeContext[] = []
  const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() })
  const source = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: parameter(), playbackRate: { value: 1 }, onended: null })
  const gain = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: parameter() })
  class FakeContext {
    currentTime = 0; sampleRate = 48000; state = resume ? 'suspended' : 'running'; destination = {} as AudioNode
    sources: ReturnType<typeof source>[] = []; gains: ReturnType<typeof gain>[] = []
    constructor(public channels = 2, public length = 96000) { contexts.push(this) }
    createGain() { const node = gain(); this.gains.push(node); return node }
    createOscillator() { const node = source(); this.sources.push(node); return node }
    createBufferSource() { const node = source(); this.sources.push(node); return node }
    createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } }
    createBiquadFilter() { return { frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() } }
    createStereoPanner() { return { pan: parameter(), connect: vi.fn(), disconnect: vi.fn() } }
    createConvolver() { return { buffer: null, normalize: true, connect: vi.fn(), disconnect: vi.fn() } }
    addEventListener() {}
    async resume() { await resume?.(); this.state = 'running' }
    async close() { this.state = 'closed' }
    async startRendering() { return { numberOfChannels: 2, length: 2, sampleRate: 48000, getChannelData: () => new Float32Array([.2, -.2]) } as unknown as AudioBuffer }
  }
  vi.stubGlobal('AudioContext', FakeContext); vi.stubGlobal('OfflineAudioContext', FakeContext)
  vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
  vi.spyOn(PianoSampleBank.prototype, 'prepare').mockResolvedValue(true); vi.spyOn(PianoSampleBank.prototype, 'status', 'get').mockReturnValue('ready'); vi.spyOn(PianoSampleBank.prototype, 'select').mockReturnValue({ rootMidi: 60, buffer: { duration: 4 } as AudioBuffer } as ReturnType<PianoSampleBank['select']>)
  return contexts
}
function tune() { const p = createStudioProject(); p.bpm = 120; p.patterns[0].notes = [{ id: 'one', pitch: 60, startTick: 73, durationTicks: 7033, velocity: 90 }]; return p }

describe('external MIDI output integration', () => {
  it('routes only opted-in live keys and falls back to the built-in sound if sending fails', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    const port = { send: vi.fn() }
    audio.setProject(project)
    audio.setMidiOutput(port as unknown as MIDIOutput, project.tracks[0].id, 2)
    await audio.noteOn('screen', 60, 90, project.tracks[0].id, true)
    audio.noteOff('screen')
    expect(port.send.mock.calls.map(([bytes]) => bytes)).toEqual([[0x91, 60, 90], [0x81, 60, 0]])
    expect(contexts).toHaveLength(0)

    await audio.noteOn('incoming-midi', 60, 90, project.tracks[0].id)
    audio.noteOff('incoming-midi')
    expect(contexts[0].sources).toHaveLength(1)
    expect(port.send).toHaveBeenCalledTimes(2)

    port.send.mockImplementation(() => { throw new Error('Port unavailable') })
    await audio.noteOn('screen', 62, 90, project.tracks[0].id, true)
    audio.noteOff('screen')
    expect(contexts[0].sources).toHaveLength(2)
    audio.dispose()
  })

  it('schedules both loop sides on the audio timeline and clears queued MIDI on stop', async () => {
    vi.useFakeTimers()
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const port = { send: vi.fn() }
    project.patterns[0].notes[0].startTick = 0
    audio.setProject(project)
    audio.setMidiOutput(port as unknown as MIDIOutput, project.tracks[0].id, 2)
    await audio.play(project, vi.fn(), vi.fn(), { loopRange: { startTick: 0, endTick: 240 }, startAt: 0 })
    expect(port.send.mock.calls).toEqual([[[0x91, 60, 90], 1000]])
    const pump = vi.mocked(window.setInterval).mock.lastCall?.[0] as () => void
    contexts[0].currentTime = .1; clock.mockReturnValue(1100); pump()
    expect(port.send).toHaveBeenCalledTimes(1)
    contexts[0].currentTime = .25; clock.mockReturnValue(1250); vi.advanceTimersByTime(150)
    expect(port.send.mock.calls.slice(1)).toEqual([[[0x81, 60, 0], 1250], [[0x91, 60, 90], 1250]])
    expect(contexts[0].sources).toHaveLength(0)
    audio.stop()
    expect(port.send).toHaveBeenLastCalledWith([0x81, 60, 0], undefined)
    clock.mockReturnValue(2000); vi.advanceTimersByTime(1000)
    expect(port.send).toHaveBeenCalledTimes(4)
    audio.dispose()
  })

  it('offers optional local monitoring without sending from a WAV render or another project', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    const port = { send: vi.fn() }
    audio.setProject(project)
    audio.setMidiOutput(port as unknown as MIDIOutput, project.tracks[0].id, 2, true)
    await audio.noteOn('screen', 60, 90, project.tracks[0].id, true)
    audio.noteOff('screen')
    expect(contexts[0].sources).toHaveLength(1)
    expect(port.send).toHaveBeenCalledTimes(2)
    await audio.wav(project)
    await audio.play({ ...project, id: 'another-song' }, vi.fn(), vi.fn(), { startAt: 0 })
    expect(port.send).toHaveBeenCalledTimes(2)
    expect(contexts[0].sources).toHaveLength(2)
    expect(contexts[1].sources).toHaveLength(1)
    audio.dispose()
  })

  it('renders the built-in fallback if a queued attack fails at its start time', async () => {
    vi.useFakeTimers()
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const port = { send: vi.fn(() => { throw new Error('Device disconnected') }) }
    const failed = vi.fn()
    project.patterns[0].notes[0].startTick = 0
    audio.setProject(project)
    audio.setMidiOutput(port as unknown as MIDIOutput, project.tracks[0].id, 2, false, { onFailure: failed })
    await audio.play(project, vi.fn(), vi.fn(), { startAt: .1 })
    expect(contexts[0].sources).toHaveLength(0)
    contexts[0].currentTime = .11; clock.mockReturnValue(1110); vi.advanceTimersByTime(100)
    expect(port.send).toHaveBeenCalledOnce()
    expect(contexts[0].sources[0].start).toHaveBeenCalledWith(.11)
    expect(failed).toHaveBeenCalledOnce()
    audio.dispose()
  })

  it('starts external-only recording preflight and arranged notes with local samples unavailable', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    const port = { send: vi.fn() }
    const unavailable = vi.mocked(PianoSampleBank.prototype.prepare).mockResolvedValue(false)
    project.patterns[0].notes[0].startTick = 0
    const trackId = project.tracks[0].id
    audio.setProject(project)
    audio.setMidiOutput(port as unknown as MIDIOutput, trackId, 2)
    await expect(audio.prepareTracks(project, [trackId], undefined, true)).resolves.toBe(contexts[0])
    await audio.play(project, vi.fn(), vi.fn(), { startAt: 0, live: true })
    expect(unavailable).toHaveBeenCalled()
    expect(port.send).toHaveBeenCalledWith([0x91, 60, 90], expect.any(Number))
    expect(contexts[0].sources).toHaveLength(0)
    expect(audio.updateSong(project)).toBe(true)
    audio.dispose()
  })

  it('still waits for built-in samples when another track needs them or monitoring is enabled', async () => {
    harness()
    const project = addTrack(tune(), 'piano'), audio = new StudioAudio()
    const port = { send: vi.fn() } as unknown as MIDIOutput
    const [routed, local] = project.tracks
    vi.mocked(PianoSampleBank.prototype.prepare).mockResolvedValue(false)
    audio.setProject(project)
    audio.setMidiOutput(port, routed.id, 2)
    await expect(audio.prepareTracks(project, [routed.id, local.id], undefined, true)).rejects.toThrow('Piano samples unavailable')
    audio.setMidiOutput(port, routed.id, 2, true)
    await expect(audio.prepareTracks(project, [routed.id], undefined, true)).rejects.toThrow('Piano samples unavailable')
    audio.dispose()
  })

  it('releases only the MIDI notes on page-exit cleanup', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    const port = { send: vi.fn() }
    const trackId = project.tracks[0].id
    audio.setProject(project)
    audio.setMidiOutput(port as unknown as MIDIOutput, trackId, 2, true)
    await audio.noteOn('screen', 60, 90, trackId, true)
    const stops = contexts[0].sources[0].stop.mock.calls.length
    audio.releaseMidiOutput()
    expect(port.send.mock.calls.map(([bytes]) => bytes)).toEqual([[0x91, 60, 90], [0x81, 60, 0]])
    expect(contexts[0].sources[0].stop).toHaveBeenCalledTimes(stops)
    audio.dispose()
  })
})

describe('brass audio routing', () => {
  it.each(ORCHESTRA_IDS)('uses calibrated %s samples for monitoring, preview, song and WAV without changing music', async soundId => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = soundId
    project.patterns[0].notes[0].startTick = 0
    const sustained = !['harp', 'timpani'].includes(soundId)
    vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockResolvedValue()
    vi.spyOn(AcousticSampleBank.prototype, 'select').mockReturnValue({ rootMidi: 60, buffer: { duration: 15 } as AudioBuffer, gain: 3, ...(sustained ? { loopStart: 2, loopEnd: 10 } : {}) })
    const before = JSON.stringify(project)
    audio.setProject(project)
    await audio.noteOn('orchestra', 60, 90, project.tracks[0].id); audio.noteOff('orchestra')
    await audio.previewNote({ pitch: 60, velocity: 90 }, project.tracks[0].id)
    await audio.play(project, vi.fn(), vi.fn())
    await audio.wav(project)
    for (const ctx of contexts) {
      expect(ctx.sources.length).toBeGreaterThan(0)
      expect(ctx.gains.some(node => node.gain.value === 3)).toBe(true)
      for (const source of ctx.sources) {
        if (sustained) expect(source).toMatchObject({ loop: true, loopStart: 2, loopEnd: 10 })
        else expect(source).not.toHaveProperty('loop', true)
      }
    }
    const offline = contexts.at(-1)!
    expect(offline.sources[0].stop.mock.lastCall?.[0]).toBeCloseTo(7033 / 960 + acousticEnvelope(soundId).release + .01)
    expect(JSON.stringify(project)).toBe(before)
    audio.dispose()
  })
  it('reschedules a held-note expression immediately after a live mixer edit, not after the old lookahead', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = 'synth-bass'; project.tracks[0].expression = [{ tick: 0, value: .2 }, { tick: 960, value: .8 }]
    await audio.play(project, vi.fn(), vi.fn(), { live: true })
    contexts[0].currentTime = .5
    project.tracks[0].level = 30; audio.setProject(project)
    const expression = contexts[0].gains[1].gain
    expect(expression.setValueAtTime.mock.lastCall?.[0]).toBeCloseTo(.428)
    expect(expression.setValueAtTime.mock.lastCall?.[1]).toBe(.5)
    expect(expression.linearRampToValueAtTime.mock.lastCall?.[0]).toBeCloseTo(.548)
    expect(expression.linearRampToValueAtTime.mock.lastCall?.[1]).toBeCloseTo(.7)
    audio.dispose()
  })
  it('restarts absolute expression on loop passes, including the held-note channel', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = 'synth-bass'; project.tracks[0].expression = [{ tick: 0, value: .2 }, { tick: 960, value: .8 }]
    await audio.play(project, vi.fn(), vi.fn(), { loopRange: { startTick: 0, endTick: 480 }, startAt: 0 })
    contexts[0].currentTime = .55
    audio.setSolo([project.tracks[0].id])
    const expression = contexts[0].gains[1].gain
    expect(expression.setValueAtTime.mock.lastCall?.[0]).toBeCloseTo(.23)
    expect(expression.setValueAtTime.mock.lastCall?.[1]).toBe(.55)
    audio.dispose()
  })
  it.each(['oboe', 'ancient-reed', 'vocal-air', 'bronze-resonance'] as const)('renders %s monitoring, preview and WAV without mutating music', async soundId => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = soundId; project.tracks[0].pan = -.3; project.tracks[0].space = .2
    project.tracks[0].expression = [{ tick: 0, value: .2 }, { tick: 1920, value: .9 }]
    vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockResolvedValue()
    vi.spyOn(AcousticSampleBank.prototype, 'select').mockReturnValue({ rootMidi: 65, buffer: { duration: 10 } as AudioBuffer, loopStart: 1.5, loopEnd: 6.8 })
    const before = JSON.stringify(project)
    audio.setProject(project); await audio.noteOn('one', 60, 90, project.tracks[0].id); audio.noteOff('one')
    await audio.previewNote({ pitch: 60, velocity: 90 }, project.tracks[0].id)
    await audio.wav(project)
    expect(contexts[0].sources.length).toBeGreaterThan(0)
    expect(contexts[1].sources.length).toBeGreaterThan(0)
    expect(contexts[1].length / 48000).toBeCloseTo(8 + 4.85)
    expect(JSON.stringify(project)).toBe(before)
    audio.dispose()
  })
  it.each(['french-horn', 'trumpet'] as const)('shares %s loop, attack, sustained duration and release between song and WAV', async soundId => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = soundId; project.tracks[0].level = 25
    project.patterns[0].notes[0].startTick = 0
    vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockResolvedValue()
    vi.spyOn(AcousticSampleBank.prototype, 'select').mockReturnValue({ rootMidi: 60, buffer: { duration: 12 } as AudioBuffer, loopStart: 1.52, loopEnd: 8.89 })
    await audio.play(project, vi.fn(), vi.fn())
    await audio.wav(project)
    const attack = soundId === 'french-horn' ? .035 : .015, release = soundId === 'french-horn' ? .3 : .22
    for (const [index, context] of contexts.entries()) {
      const start = index === 0 ? .12 : 0
      expect(context.sources).toHaveLength(1)
      expect(context.sources[0]).toMatchObject({ loop: true, loopStart: 1.52, loopEnd: 8.89 })
      expect(context.sources[0].stop.mock.lastCall?.[0]).toBeCloseTo(start + 7033 / 960 + release + .01)
      expect(context.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(.25, 0)
      expect(context.gains[1].gain.linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(start + attack)
    }
    expect(contexts).toHaveLength(2)
    audio.dispose()
  })
  it.each(['french-horn', 'trumpet'] as const)('monitors %s using only its prepared sample and measured loop', async soundId => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = soundId
    const prepare = vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockResolvedValue()
    const select = vi.spyOn(AcousticSampleBank.prototype, 'select').mockReturnValue({ rootMidi: 60, buffer: { duration: 12 } as AudioBuffer, loopStart: 1.52, loopEnd: 8.89 })
    audio.setProject(project)
    await audio.noteOn('test-brass', 67, 90, project.tracks[0].id)
    expect(prepare).toHaveBeenCalledWith(contexts[0], soundId)
    expect(select).toHaveBeenCalledWith(soundId, 67)
    expect(contexts[0].sources).toHaveLength(1)
    expect(contexts[0].sources[0]).toMatchObject({ loop: true, loopStart: 1.52, loopEnd: 8.89 })
    expect(contexts[0].sources[0].playbackRate.value).toBeCloseTo(2 ** (7 / 12))
    audio.noteOff('test-brass')
    expect(contexts[0].sources[0].stop).toHaveBeenCalled()
    audio.dispose()
  })
  it('does not start an oscillator substitute when brass preparation fails or is stopped', async () => {
    const contexts = harness(), project = tune(), audio = new StudioAudio()
    project.tracks[0].soundId = 'trumpet'; audio.setProject(project)
    const prepare = vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockRejectedValue(new Error('Trumpet samples unavailable. Retry sound.'))
    await expect(audio.noteOn('brass', 60, 90, project.tracks[0].id)).rejects.toThrow(/Trumpet/)
    expect(contexts[0].sources).toHaveLength(0)
    let finish!: () => void
    prepare.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = audio.noteOn('brass', 60, 90, project.tracks[0].id)
    await vi.waitFor(() => expect(finish).toBeDefined())
    audio.stop(); finish(); await pending
    expect(contexts[0].sources).toHaveLength(0)
    audio.dispose()
  })
})

describe('isolated Mira examples', () => {
  const example = { notes: [{ pitch: 60, startTick: 73, durationTicks: 480, velocity: 90 }, { pitch: 64, startTick: 73, durationTicks: 960, velocity: 70 }] }
  const source = { soundId: 'piano' as const, level: 35, muted: false }

  it('preserves exact example timing and source mix without changing input objects', async () => {
    const contexts = harness(), player = new MiraExampleAudio(), before = JSON.stringify({ example, source })
    expect(await player.play(example, source, 120)).toBe(true)
    const context = contexts[0]
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(.35, 0)
    expect(context.sources).toHaveLength(2)
    expect(context.sources[0].start).toHaveBeenCalledWith(.05 + 73 / 960)
    expect(context.sources[1].stop.mock.lastCall?.[0]).toBeCloseTo(.05 + (73 + 960) / 960 + .41)
    expect(JSON.stringify({ example, source })).toBe(before)
    player.dispose()
  })

  it('rejects invalid examples atomically, including tails over two bars and percussion', async () => {
    const contexts = harness(), player = new MiraExampleAudio()
    for (const notes of [[], Array.from({ length: 17 }, () => example.notes[0]), [{ ...example.notes[0], durationTicks: 3840 }], [{ ...example.notes[0], startTick: .25 }], [{ ...example.notes[0], pitch: 128 }], [{ ...example.notes[0], velocity: 0 }]]) {
      await expect(player.play({ notes }, source, 120)).rejects.toThrow(/Example unavailable/)
    }
    await expect(player.play(example, { ...source, soundId: 'kick' }, 120)).rejects.toThrow(/instrument/)
    expect(contexts).toHaveLength(0)
  })

  it('explains muted and zero-volume sources without preparing or creating audio', async () => {
    const contexts = harness(), player = new MiraExampleAudio()
    await expect(player.play(example, { ...source, muted: true }, 120)).rejects.toThrow(/muted/)
    await expect(player.play(example, { ...source, level: 0 }, 120)).rejects.toThrow(/volume/)
    expect(contexts).toHaveLength(0)
  })

  it('Stop immediately settles pending preparation and never resurrects voices', async () => {
    const contexts = harness(), player = new MiraExampleAudio()
    let finish!: (ready: boolean) => void
    const prepare = vi.spyOn(PianoSampleBank.prototype, 'prepare').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const playing = player.play(example, source, 120)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled())
    player.stop(); expect(await playing).toBe(false)
    finish(true); await Promise.resolve()
    expect(contexts[0].sources).toHaveLength(0)
    player.dispose()
  })

  it('superseding a pending request leaves only the latest example audible', async () => {
    const contexts = harness(), player = new MiraExampleAudio()
    let finish!: (ready: boolean) => void
    const prepare = vi.spyOn(PianoSampleBank.prototype, 'prepare').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = player.play(example, source, 120)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled())
    expect(await player.play({ notes: [example.notes[0]] }, { ...source, soundId: 'synth-bass' }, 120)).toBe(true)
    finish(true); expect(await pending).toBe(false)
    expect(contexts[0].sources).toHaveLength(2) // bass oscillator pair, no stale piano
    player.dispose()
  })

  it('fails visibly without substitution and allows an explicit subsequent retry', async () => {
    const contexts = harness(), player = new MiraExampleAudio()
    vi.spyOn(PianoSampleBank.prototype, 'prepare').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(player.play(example, source, 120)).rejects.toThrow(/no substitute/)
    expect(contexts[0].sources).toHaveLength(0)
    expect(await player.play(example, source, 120)).toBe(true)
    player.dispose()
  })

  it('keeps example Stop isolated from song voices and live monitoring', async () => {
    const contexts = harness(), studio = new StudioAudio(), player = new MiraExampleAudio(), project = tune()
    studio.setProject(project); await studio.noteOn('held-key', 60, 90, project.tracks[0].id)
    const heldCalls = contexts[0].sources[0].stop.mock.calls.slice()
    await player.play(example, source, 120); player.stop()
    expect(contexts).toHaveLength(2)
    expect(contexts[0].sources[0].stop.mock.calls).toEqual(heldCalls)
    expect(contexts[1].sources[0].stop).toHaveBeenLastCalledWith(0)
    studio.dispose(); player.dispose()
  })

  it('waits for the full release tail, then completes once and releases its graph', async () => {
    const contexts = harness(), player = new MiraExampleAudio(), done = vi.fn()
    vi.useFakeTimers()
    await player.play(example, source, 120, done)
    contexts[0].currentTime = .05 + 1033 / 960 + .7; vi.advanceTimersByTime(100)
    expect(done).not.toHaveBeenCalled()
    contexts[0].currentTime += .2; vi.advanceTimersByTime(100)
    expect(done).toHaveBeenCalledTimes(1)
    expect(contexts[0].gains[0].disconnect).toHaveBeenCalled()
    vi.advanceTimersByTime(1000); expect(done).toHaveBeenCalledTimes(1)
    player.dispose()
  })
})

describe('track audio', () => {
  it('routes identical sounds independently; live mute affects a held voice, hidden is not mute', async () => {
    const contexts = harness(), audio = new StudioAudio(); const p = addTrack(tune(), 'piano')
    p.tracks[0].level = 25; p.tracks[1].level = 75; p.tracks[1].hidden = true; audio.setProject(p)
    await audio.noteOn('a', 60, 90, p.tracks[0].id); await audio.noteOn('b', 67, 90, p.tracks[1].id)
    const c = contexts[0]; expect(c.gains[2].connect).toHaveBeenCalledWith(c.gains[0]); expect(c.gains[3].connect).toHaveBeenCalledWith(c.gains[1])
    expect(c.gains.slice(0, 2).map(node => node.gain.setValueAtTime.mock.lastCall?.[0])).toEqual([.25, .75])
    p.tracks[1].muted = true; audio.setProject(p); expect(c.gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    audio.dispose()
  })
  it('does not restart a stopped pending preview or note-on', async () => {
    const resumes: (() => void)[] = [], contexts = harness(() => new Promise<void>(resolve => resumes.push(resolve))), audio = new StudioAudio(), p = tune(); audio.setProject(p)
    const preview = audio.previewNote({ pitch: 60, velocity: 90 }, p.tracks[0].id); await Promise.resolve(); audio.stopPreview(); resumes.shift()?.(); await preview
    expect(contexts[0].sources).toHaveLength(0)
    contexts[0].state = 'suspended'
    const held = audio.noteOn('held', 60, 90, p.tracks[0].id); await Promise.resolve(); audio.noteOff('held'); resumes.shift()?.(); await held
    expect(contexts[0].sources).toHaveLength(0); audio.dispose()
  })
  it('previews leave arrangement and active song scheduler unchanged', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune(), original = structuredClone(p)
    await audio.play(p, vi.fn(), vi.fn(), { live: true }); await audio.previewNote({ pitch: 72, velocity: 90 }, p.tracks[0].id)
    expect(contexts[0].sources).toHaveLength(2); expect(audio.updateSong(p)).toBe(true); expect(p).toEqual(original); audio.dispose()
  })
  it('project switches invalidate pending voices even when legacy track IDs are reused', async () => {
    const resumes: (() => void)[] = [], contexts = harness(() => new Promise<void>(resolve => resumes.push(resolve))), audio = new StudioAudio(), p = tune(); audio.setProject(p)
    const preview = audio.previewNote({ pitch: 60, velocity: 90 }, p.tracks[0].id)
    const held = audio.noteOn('held', 60, 90, p.tracks[0].id); await Promise.resolve()
    const other = structuredClone(p); other.id = 'other'; audio.setProject(other)
    resumes.splice(0).forEach(resolve => resolve()); await Promise.all([preview, held]); expect(contexts[0].sources).toHaveLength(0); audio.dispose()
  })
  it('removing a held track stops its voice while mixer-only changes retain it', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune(); audio.setProject(p); await audio.noteOn('held', 60, 90, p.tracks[0].id)
    p.tracks[0].level = 30; audio.setProject(p); expect(contexts[0].sources[0].stop).toHaveBeenCalledTimes(1)
    p.tracks = []; p.patterns = []; p.clips = []; audio.setProject(p); expect(contexts[0].sources[0].stop).toHaveBeenLastCalledWith(0); audio.dispose()
  })
  it('range loops chase initial sustains once, retain tails, and apply live edits beyond the queued frontier', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune(); let pump = () => {}
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval: vi.fn() })
    p.patterns[0].notes = [
      { id: 'held', pitch: 59, startTick: 1800, durationTicks: 300, velocity: 90 },
      { id: 'repeat', pitch: 60, startTick: 1920, durationTicks: 800, velocity: 90 },
    ]
    const update = vi.fn(); await audio.play(p, update, vi.fn(), { live: true, loopRange: { startTick: 1920, endTick: 2400 } })
    const c = contexts[0]; expect(c.sources).toHaveLength(2); expect(c.sources[0].stop).toHaveBeenCalledWith(.12 + 180 / 960 + .41)
    c.currentTime = .45; pump(); expect(c.sources).toHaveLength(3)
    p.patterns[0].notes[1].pitch = 72; expect(audio.updateSong(p)).toBe(true); c.currentTime = .95; pump()
    expect(c.sources).toHaveLength(4); expect(c.sources[3].playbackRate.value).toBeCloseTo(2)
    expect(update.mock.lastCall?.[0]).toBeCloseTo(2236.8); audio.dispose()
  })
  it('WAV shares exact compiled timing and track mixer and snapshots before await', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = addTrack(tune(), 'kick'); p.tracks[0].level = 25; p.tracks[1].muted = true
    p.patterns[1].notes = [{ id: 'kick', pitch: 36, startTick: 100, durationTicks: 60, velocity: 90 }]
    const render = audio.wav(p); p.tracks[0].level = 100; p.patterns[0].notes[0].durationTicks = 1
    const result = await render, c = contexts[0]
    expect(c.gains.slice(0, 2).map(node => node.gain.setValueAtTime.mock.lastCall?.[0])).toEqual([.25, 0])
    expect(c.sources[0].stop).toHaveBeenCalledWith(7106 / 960 + .41); expect(result.bytes.slice(0, 4)).toEqual(new TextEncoder().encode('RIFF')); audio.dispose()
  })
  it('missing acoustic assets fail playback/WAV honestly while MIDI remains available', async () => {
    harness(); const audio = new StudioAudio(), p = tune(); p.tracks[0].soundId = 'strings'
    vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockRejectedValue(new Error('Strings samples unavailable. Use Retry sound.'))
    await expect(audio.play(p, vi.fn(), vi.fn())).rejects.toThrow(/Retry/); await expect(audio.wav(p)).rejects.toThrow(/Retry/)
    expect(studioMidi(p).length).toBeGreaterThan(50); audio.dispose()
  })
  it('missing piano samples never create a substitute voice in monitor, preview, playback or WAV', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune(); audio.setProject(p)
    vi.spyOn(PianoSampleBank.prototype, 'prepare').mockResolvedValue(false)
    await expect(audio.noteOn('missing', 60, 90, p.tracks[0].id)).rejects.toThrow(/Piano samples unavailable/)
    await expect(audio.previewNote({ pitch: 60, velocity: 90 }, p.tracks[0].id)).rejects.toThrow(/Piano samples unavailable/)
    await expect(audio.previewSound('piano')).rejects.toThrow(/Piano samples unavailable/)
    await expect(audio.play(p, vi.fn(), vi.fn())).rejects.toThrow(/Piano samples unavailable/)
    await expect(audio.wav(p)).rejects.toThrow(/Piano samples unavailable/)
    expect(contexts.every(context => context.sources.length === 0)).toBe(true)
    audio.dispose()
  })
  it('invalid loops and projects do not interrupt current playback', async () => {
    harness(); const audio = new StudioAudio(), p = tune(); await audio.play(p, vi.fn(), vi.fn(), { live: true })
    await expect(audio.play(p, vi.fn(), vi.fn(), { loopRange: { startTick: -1, endTick: 480 } })).rejects.toThrow(/range/)
    expect(audio.updateSong(p)).toBe(true); const invalid = structuredClone(p); invalid.tracks[0].level = -1
    expect(() => audio.setProject(invalid)).toThrow(); expect(() => studioMidi(invalid)).toThrow(); audio.dispose()
  })
  it('B14: missing muted, silent and unplaced sampled tracks do not block song or WAV', async () => {
    harness(); const audio = new StudioAudio(); let p = addTrack(tune(), 'strings'); p = addTrack(p, 'plucked-guitar')
    p.patterns[1].notes = [{ id: 'muted-string', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }]
    p.tracks[1].muted = true
    const prepare = vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockRejectedValue(new Error('Missing sample'))
    await audio.play(p, vi.fn(), vi.fn()); await audio.wav(p); expect(prepare).not.toHaveBeenCalled()
    p.tracks[1].muted = false; p.tracks[1].level = 0
    await audio.play(p, vi.fn(), vi.fn()); await audio.wav(p); expect(prepare).not.toHaveBeenCalled()
    p.tracks[1].level = 100
    await expect(audio.play(p, vi.fn(), vi.fn())).rejects.toThrow('Missing sample'); audio.dispose()
  })
  it('B13: explicit recording preparation loads muted destination and is cancellable', async () => {
    harness(); const audio = new StudioAudio(), p = addTrack(tune(), 'strings'); p.tracks[1].muted = true
    let finish!: () => void
    const prepare = vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const controller = new AbortController(), request = audio.prepareTracks(p, [p.tracks[1].id], controller.signal)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled())
    controller.abort(); await expect(request).rejects.toMatchObject({ name: 'AbortError' }); finish(); audio.dispose()
  })
  it('B14: live edits ignore an empty unloaded acoustic track but reject newly audible notes', async () => {
    harness(); const audio = new StudioAudio(), p = addTrack(tune(), 'strings')
    vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockRejectedValue(new Error('Missing sample'))
    await audio.play(p, vi.fn(), vi.fn(), { live: true })
    p.patterns[0].notes[0].pitch = 64
    expect(audio.updateSong(p)).toBe(true)
    p.patterns[1].notes = [{ id: 'new-string', pitch: 60, startTick: 0, durationTicks: 480, velocity: 80 }]
    expect(audio.updateSong(p)).toBe(false); audio.dispose()
  })
  it('resumes a loop phase, chases held notes once, then wraps without replaying pre-loop notes', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune(); let pump = () => {}
    vi.stubGlobal('window', { setInterval: vi.fn((callback: () => void) => { pump = callback; return 1 }), clearInterval: vi.fn() })
    p.patterns[0].notes = [
      { id: 'pre-loop', pitch: 55, startTick: 1800, durationTicks: 600, velocity: 80 },
      { id: 'loop-start', pitch: 60, startTick: 1920, durationTicks: 600, velocity: 80 },
      { id: 'later', pitch: 64, startTick: 2300, durationTicks: 200, velocity: 80 },
    ]
    const update = vi.fn()
    await audio.play(p, update, vi.fn(), { startTick: 2160, loopRange: { startTick: 1920, endTick: 2400 } })
    const c = contexts[0]; expect(update).toHaveBeenLastCalledWith(2160); expect(c.sources).toHaveLength(2)
    expect(c.sources[0].stop.mock.lastCall?.[0]).toBeCloseTo(.12 + 360 / 960 + .41)
    expect(c.sources[1].stop.mock.lastCall?.[0]).toBeCloseTo(.12 + 240 / 960 + .41)
    c.currentTime = .13; pump(); expect(c.sources).toHaveLength(3)
    c.currentTime = .32; pump(); expect(c.sources).toHaveLength(4)
    expect(c.sources[3].playbackRate.value).toBeCloseTo(1)
    expect(update.mock.lastCall?.[0]).toBeCloseTo(2352)
    c.currentTime = .39; pump(); expect(update.mock.lastCall?.[0]).toBeCloseTo(1939.2)
    audio.dispose()
  })
  it('selected part audition excludes other clips and their missing samples through live edits and Solo', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = addTrack(tune(), 'strings')
    p.patterns[1].notes = [{ id: 'outside', pitch: 69, startTick: 0, durationTicks: 480, velocity: 80 }]
    const prepare = vi.spyOn(AcousticSampleBank.prototype, 'prepare').mockRejectedValue(new Error('Missing unselected strings'))
    await audio.play(p, vi.fn(), vi.fn(), { live: true, clipIds: [p.clips[0].id] })
    expect(contexts[0].sources).toHaveLength(1); expect(prepare).not.toHaveBeenCalled()
    expect(audio.setSolo([p.tracks[0].id])).toBe(true); expect(audio.setSolo([])).toBe(true)
    p.patterns[0].notes[0].pitch = 61; expect(audio.updateSong(p)).toBe(true)
    await expect(audio.wav(p)).rejects.toThrow('Missing unselected strings')
    audio.dispose()
  })
  it('rejects missing/duplicate audition IDs without interrupting active playback', async () => {
    harness(); const audio = new StudioAudio(), p = tune(); await audio.play(p, vi.fn(), vi.fn(), { live: true })
    for (const clipIds of [[], ['missing'], [p.clips[0].id, p.clips[0].id]]) await expect(audio.play(p, vi.fn(), vi.fn(), { clipIds })).rejects.toThrow('existing clips')
    expect(audio.updateSong(p)).toBe(true); audio.dispose()
  })
  it('range playback and WAV chase sustain at the shared epoch without cutting its tail', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune(); p.patterns[0].notes = [{ id: 'held', pitch: 60, startTick: 100, durationTicks: 2000, velocity: 90 }]
    const update = vi.fn(); await audio.play(p, update, vi.fn(), { startTick: 480, endTick: 960, startAt: .12 })
    expect(contexts[0].sources[0].start).toHaveBeenCalledWith(.12)
    expect(contexts[0].sources[0].stop.mock.lastCall?.[0]).toBeCloseTo(.12 + 1620 / 960 + .41)
    expect(update).toHaveBeenCalledWith(480)
    await audio.wav(p, { startTick: 480, endTick: 960 })
    expect(contexts[1].sources[0].start).toHaveBeenCalledWith(0)
    expect(contexts[1].length).toBe(Math.ceil((1620 / 960 + .85) * 48000)); audio.dispose()
  })
  it('Solo is audition-only, meters are safe when stopped, and exports retain saved mix', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = addTrack(tune(), 'synth-bass')
    p.patterns[1].notes = [{ id: 'bass', pitch: 40, startTick: 0, durationTicks: 480, velocity: 90 }]
    audio.setSolo([p.tracks[1].id]); await audio.play(p, vi.fn(), vi.fn())
    expect(contexts[0].gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    await audio.wav(p); expect(contexts[1].gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0)
    audio.dispose(); expect(audio.meterSnapshot()).toEqual({ tracks: {}, master: 0, clipping: false })
  })
  it('continuing metronome uses backing epoch and is cancelled by stop', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune()
    await audio.play(p, vi.fn(), vi.fn(), { startAt: .12, metronome: true })
    const click = contexts[0].sources.find(source => source.frequency.value === 1400)
    expect(click?.start).toHaveBeenCalledWith(.12); audio.stop(); expect(click?.stop).toHaveBeenLastCalledWith()
  })
  it('exposing an unloaded sampled track through Solo stops safely and reports preparation needed', async () => {
    harness(); const audio = new StudioAudio(), p = addTrack(tune(), 'strings')
    p.patterns[1].notes = [{ id: 'strings', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }]
    audio.setSolo([p.tracks[0].id]); await audio.play(p, vi.fn(), vi.fn(), { live: true })
    expect(audio.setSolo([])).toBe(false); expect(audio.updateSong(p)).toBe(false); audio.dispose()
  })
  it('track mixer retains channel identity and rejects invalid settings atomically', () => {
    const contexts = harness(), context = new AudioContext(), p = tune(), graph = createTrackMixGraph(context, context.destination, p.tracks)
    const node = graph.channels.get(p.tracks[0].id); p.tracks[0].level = 22; graph.setTracks(p.tracks); expect(graph.channels.get(p.tracks[0].id)).toBe(node)
    p.tracks[0].level = -1; expect(() => graph.setTracks(p.tracks)).toThrow(); expect(contexts[0].gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(.22, 0); graph.dispose()
  })
})

describe('studio MIDI', () => {
  it('creates named tracks, unique melodic channels and channel ten drums without mixer loss', () => {
    let p = addTrack(tune(), 'synth-bass'); p = addTrack(p, 'kick'); p.tracks[1].name = 'My bass'
    p.patterns[1].notes = [{ id: 'bass', pitch: 40, startTick: 81, durationTicks: 600, velocity: 93 }]
    const data = studioMidi(p), view = new DataView(data.buffer)
    expect(view.getUint16(10)).toBe(4); expect(new TextDecoder().decode(data)).toContain('My bass')
    expect([...data]).toEqual(expect.arrayContaining([193, 38])); p.tracks.forEach(track => { track.muted = true; track.level = 0; track.hidden = true })
    expect(studioMidi(p)).toEqual(data)
  })
  it('compiler independent copies appear in MIDI without modifying originals', () => {
    const source = tune(), p = duplicateClip(source, source.clips[0].id)
    expect(compileArrangement(p)).toHaveLength(2)
  })
})


describe('live MIDI latency path', () => {
  it('all-notes-off silences released live notes instead of leaving their release tails sounding', async () => {
    const contexts = harness(), audio = new StudioAudio(), project = tune()
    project.tracks[0].soundId = 'soft-pad'; audio.setProject(project)
    await audio.noteOn('held-pad', 60, 90, project.tracks[0].id)
    contexts[0].currentTime = .2
    audio.noteOff('held-pad')
    expect(contexts[0].sources[0].stop.mock.lastCall?.[0]).toBeGreaterThan(.2)
    audio.silenceKeys()
    expect(contexts[0].sources[0].stop).toHaveBeenLastCalledWith(.2)
    audio.dispose()
  })

  it('ending an old release tail does not remove a newly retriggered key', async () => {
    const contexts = harness(), audio = new StudioAudio(), project = tune()
    project.tracks[0].soundId = 'soft-pad'; audio.setProject(project)
    await audio.noteOn('repeat', 60, 90, project.tracks[0].id)
    audio.noteOff('repeat')
    await audio.noteOn('repeat', 60, 90, project.tracks[0].id)
    const oldSource = contexts[0].sources[0], newSource = contexts[0].sources[3]
    ;(oldSource.onended as unknown as () => void)()
    const oldStops = oldSource.stop.mock.calls.length
    contexts[0].currentTime = .3; audio.silenceKeys()
    expect(newSource.stop).toHaveBeenLastCalledWith(.3)
    expect(oldSource.stop).toHaveBeenCalledTimes(oldStops)
    audio.dispose()
  })
  it('changing a track instrument stops its old released voices', async () => {
    const contexts = harness(), audio = new StudioAudio(), project = tune()
    project.tracks[0].soundId = 'soft-pad'; audio.setProject(project)
    await audio.noteOn('pad', 60, 90, project.tracks[0].id); audio.noteOff('pad')
    contexts[0].currentTime = .25
    project.tracks[0].soundId = 'synth-bass'; audio.setProject(project)
    expect(contexts[0].sources[0].stop).toHaveBeenLastCalledWith(.25)
    audio.dispose()
  })
  it('starts a ready instrument synchronously without resume or sample preparation per note', async () => {
    const contexts = harness(), audio = new StudioAudio(), p = tune()
    p.tracks[0].soundId = 'synth-bass'; audio.setProject(p)
    await audio.unlock()
    const resume = vi.spyOn(contexts[0], 'resume')
    const prepare = vi.spyOn(audio, 'prepareTracks')
    const pending = audio.noteOn('instant', 60, 90, p.tracks[0].id)
    expect(contexts[0].sources).toHaveLength(2)
    expect(contexts[0].sources[0].start).toHaveBeenCalledWith(contexts[0].currentTime)
    expect(resume).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled()
    audio.noteOff('instant'); await pending; audio.dispose()
  })
  it('preloads piano without resuming audio or emitting a note', async () => {
    const resumes = vi.fn(), contexts = harness(async () => { resumes() })
    const prepare = vi.spyOn(PianoSampleBank.prototype, 'prepare').mockResolvedValue(true)
    const audio = new StudioAudio(), p = tune(); audio.setProject(p)
    await audio.preloadTrack(p.tracks[0].id)
    expect(prepare).toHaveBeenCalled(); expect(resumes).not.toHaveBeenCalled()
    expect(contexts[0].sources).toHaveLength(0); audio.dispose()
  })
})
