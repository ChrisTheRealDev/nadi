import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesToBase64 } from '../ideaRecorder'
import { createAudioIdea } from '../ideas'
import { StudioAudio } from './audio'
import { HISTORY_BYTE_LIMIT, StudioHistory } from './history'
import { createStudioProject, MAX_NOTES, MAX_PROJECT_BYTES, validateStudioProject, type StudioProject } from './model'
import { projectCapacity } from './operations'

const LIVE_ITERATIONS = 20
const HISTORY_ITERATIONS = 3
const encoder = new TextEncoder()

function fakeAudioContext() {
  const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} })
  let attacks = 0
  class Context {
    state = 'running'; currentTime = 0; sampleRate = 48_000
    destination = { connect() {}, disconnect() {} } as unknown as AudioNode
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} } as unknown as GainNode }
    createOscillator() {
      attacks++
      return { frequency: parameter(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null } as unknown as OscillatorNode
    }
    addEventListener() {}
    async resume() {}
    async close() { this.state = 'closed' }
  }
  vi.stubGlobal('AudioContext', Context)
  return { attacks: () => attacks }
}

function fixture(kind: 'small' | 'maximum-notes' | 'original-heavy'): StudioProject {
  const project = createStudioProject()
  project.tracks[0].soundId = 'synth-bass' // no sample download; this measures project and voice ownership only
  project.patterns[0].notes = Array.from({ length: kind === 'maximum-notes' ? MAX_NOTES : 4 }, (_, index) => ({
    id: `note-${index}`, pitch: 60, startTick: index % 1920, durationTicks: 1, velocity: 80,
  }))
  if (kind === 'original-heavy') {
    const bytes = new Uint8Array(900_000)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
    const base64 = bytesToBase64(bytes)
    project.ideas = [
      createAudioIdea(base64, 'audio/webm', bytes.length, 1000, 'Original one'),
      createAudioIdea(base64, 'audio/webm', bytes.length, 1000, 'Original two'),
    ]
  }
  expect(validateStudioProject(project)).toBe(true)
  return project
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bounded source performance gate', () => {
  it.each(['small', 'maximum-notes', 'original-heavy'] as const)('%s: measures boundary, live input, and history without timing thresholds', async kind => {
    const project = fixture(kind), capacity = projectCapacity(project), mock = fakeAudioContext(), audio = new StudioAudio()
    const projectBytes = encoder.encode(JSON.stringify(project)).byteLength
    expect(capacity.projectBytes).toBe(projectBytes)
    expect(projectBytes).toBeLessThanOrEqual(MAX_PROJECT_BYTES)
    expect(capacity.expandedNotes).toBe(kind === 'maximum-notes' ? MAX_NOTES : 4)
    expect(capacity.originalAudioBytes).toBe(kind === 'original-heavy' ? 1_800_000 : 0)
    if (kind === 'maximum-notes') {
      const overflow = structuredClone(project)
      overflow.patterns[0].notes.push({ id: 'overflow', pitch: 60, startTick: 0, durationTicks: 1, velocity: 80 })
      expect(validateStudioProject(overflow)).toBe(false)
    }
    if (kind === 'original-heavy') {
      const overflow = structuredClone(project), extra = new Uint8Array(300_000)
      overflow.ideas.push(createAudioIdea(bytesToBase64(extra), 'audio/webm', extra.length, 1000, 'Over total audio limit'))
      expect(validateStudioProject(overflow)).toBe(false)
    }

    const boundaryStart = performance.now()
    audio.setProject(project)
    const boundaryMs = performance.now() - boundaryStart

    // Warm the mock context outside the measured loop. No browser device, key, or asset is touched.
    await audio.noteOn('warm', 60, 90, project.tracks[0].id); audio.noteOff('warm')
    const liveStart = performance.now()
    for (let index = 0; index < LIVE_ITERATIONS; index++) {
      const key = `bench-${index}`
      await audio.noteOn(key, 60, 90, project.tracks[0].id)
      audio.noteOff(key)
    }
    const liveMs = performance.now() - liveStart
    expect(mock.attacks()).toBe(2 * (LIVE_ITERATIONS + 1)) // two synth-bass oscillators per accepted voice
    audio.dispose()

    const history = new StudioHistory(), pushStart = performance.now()
    for (let index = 0; index < HISTORY_ITERATIONS; index++) history.push(project, { label: `Benchmark edit ${index}` })
    const historyPushMs = performance.now() - pushStart
    const accountingStart = performance.now(), accountedBytes = history.bytes
    const historyAccountingMs = performance.now() - accountingStart
    expect(history.size).toBe(HISTORY_ITERATIONS)
    expect(history.availability.undo).toBe(true)
    expect(accountedBytes).toBeLessThanOrEqual(HISTORY_BYTE_LIMIT)
    if (kind === 'original-heavy') expect(accountedBytes).toBeLessThan(projectBytes * HISTORY_ITERATIONS) // originals are interned

    console.info('SOURCE_PERF_GATE', JSON.stringify({ kind, projectBytes, storedNotes: capacity.storedNotes, expandedNotes: capacity.expandedNotes,
      originalAudioBytes: capacity.originalAudioBytes, liveIterations: LIVE_ITERATIONS, historyIterations: HISTORY_ITERATIONS,
      setProjectMs: +boundaryMs.toFixed(2), liveTotalMs: +liveMs.toFixed(2), liveMeanMs: +(liveMs / LIVE_ITERATIONS).toFixed(3),
      historyPushTotalMs: +historyPushMs.toFixed(2), historyMeanMs: +(historyPushMs / HISTORY_ITERATIONS).toFixed(2),
      historyBytes: accountedBytes, historyAccountingMs: +historyAccountingMs.toFixed(2) }))
  })
})
