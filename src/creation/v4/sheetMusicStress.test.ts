import { describe, expect, it } from 'vitest'
import { createStudioProject, defaultTrackProduction, validateStudioProject } from './model'
import { defaultNotation, DEFAULT_MEASURE } from './notationModel'
import { createSheetMusic } from './sheetMusic'

function sustained(count: number, tinyMeter = false) {
  const project = createStudioProject()
  project.bars = 256
  project.tracks[0].soundId = 'synth-bass'
  project.patterns[0].lengthTicks = 256 * 1920
  project.patterns[0].notes = Array.from({ length: count }, (_, index) => ({
    id: `n-${index}`, pitch: 60, startTick: 0, durationTicks: 256 * 1920 - index, velocity: 80,
  }))
  if (tinyMeter) {
    project.version = 6
    project.notation = defaultNotation()
    project.notation.measures = [{ ...DEFAULT_MEASURE, beats: 1, beatType: 16 }]
  }
  return project
}

describe('bounded adversarial score projection', () => {
  it('retains a bounded sustained score without changing musical data', () => {
    const project = sustained(32), before = structuredClone(project)
    const result = createSheetMusic(project, { grid: 1, spelling: 'sharps' })
    expect(result).toMatchObject({ noteCount: 32, bars: 256 })
    expect(result.mapping).toHaveLength(8284)
    expect(project).toEqual(before)
  })

  it.each([[128, false], [32, true], [10000, true]] as const)('rejects tied-note amplification: %i notes, tiny meter %s', (count, tinyMeter) => {
    const project = sustained(count, tinyMeter)
    expect(validateStudioProject(project)).toBe(true)
    const before = structuredClone(project)
    const start = performance.now()
    expect(() => createSheetMusic(project, { grid: 1, spelling: 'sharps' })).toThrow('Your composition is unchanged')
    console.info('SCORE_STRESS_GUARDED', JSON.stringify({ count, tinyMeter, milliseconds: +(performance.now() - start).toFixed(2) }))
    expect(project).toEqual(before)
  })

  it('bounds the quadratic allocation of overlapping voices before XML generation', () => {
    const project = sustained(2000)
    project.bars = 2; project.patterns[0].lengthTicks = 3840
    project.patterns[0].notes.forEach((note, index) => { note.durationTicks = 3840 - index })
    expect(validateStudioProject(project)).toBe(true)
    expect(() => createSheetMusic(project, { grid: 1, spelling: 'sharps' })).toThrow('too much notation')
  })

  it('bounds empty measures added to every independent voice', () => {
    const project = sustained(128)
    project.patterns[0].notes.forEach((note, index) => { note.durationTicks = index + 1 })
    project.patterns[0].notes.push({ id: 'last', pitch: 60, startTick: 491519, durationTicks: 1, velocity: 80 })
    expect(validateStudioProject(project)).toBe(true)
    expect(() => createSheetMusic(project, { grid: 1, spelling: 'sharps' })).toThrow('too much notation')
  })

  it('counts rhythmic subdivisions and chord tones, not only source notes', () => {
    const project = sustained(10000)
    project.bars = 1; project.patterns[0].lengthTicks = 1920
    project.patterns[0].notes.forEach(note => { note.durationTicks = 479 })
    expect(validateStudioProject(project)).toBe(true)
    expect(() => createSheetMusic(project, { grid: 1, spelling: 'sharps' })).toThrow('too much notation')
    project.patterns[0].notes.forEach(note => { note.durationTicks = 480 })
    expect(createSheetMusic(project, { grid: 1, spelling: 'sharps' }).mapping).toHaveLength(10000)
  })

  it('applies budgets to notation rests even without arranged notes', () => {
    const project = sustained(0, true)
    project.notation!.rests = Array.from({ length: 20000 }, (_, index) => ({ id: `r-${index}`, trackId: project.tracks[0].id, startTick: 0, durationTicks: 491520 - index, voice: 1 }))
    expect(validateStudioProject(project)).toBe(true)
    expect(() => createSheetMusic(project, { grid: 1, spelling: 'sharps' })).toThrow('too much notation')
  })

  it('allows selecting a simple part beside an oversized score', () => {
    const project = sustained(128)
    project.tracks.push({ id: 'simple', name: 'Simple part', color: '#ffffff', soundId: 'hat', soundVersion: 1, level: 100, muted: false, hidden: false, ...defaultTrackProduction() })
    project.patterns.push({ id: 'simple-pattern', trackId: 'simple', name: 'Simple', lengthTicks: 1920, notes: [{ id: 'simple-note', pitch: 42, startTick: 0, durationTicks: 480, velocity: 80 }] })
    project.clips.push({ id: 'simple-clip', patternId: 'simple-pattern', trackId: 'simple', startTick: 0 })
    expect(() => createSheetMusic(project, { grid: 1, spelling: 'sharps' })).toThrow('Choose a single instrument part')
    expect(createSheetMusic(project, { trackId: 'simple', grid: 1, spelling: 'sharps' })).toMatchObject({ noteCount: 1, bars: 1, partCount: 1 })
  })
})
