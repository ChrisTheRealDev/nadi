import { describe, expect, it } from 'vitest'
import { createDefaultMix, createProject, decodeProject, noteName, TICKS_PER_BAR, TICKS_PER_BEAT, validateProject } from './model'

describe('creation project model', () => {
  it('creates the bounded creation-first default without legacy lesson data', () => {
    const project = createProject()

    expect(project).toMatchObject({
      format: 'nadi-creation', version: 3, revision: 0, name: 'Untitled project', bpm: 90, bars: 4,
      notes: [], ideas: [], guidance: { open: false, step: 0, experience: 'new' },
    })
    expect(project.id).not.toBe('')
    expect(validateProject(project)).toBe(true)
    expect(TICKS_PER_BEAT).toBe(480)
    expect(TICKS_PER_BAR).toBe(1920)
  })

  it('migrates exact v1 in memory without changing identity, revision or absolute note timing', () => {
    const current = createProject()
    current.revision = 17
    current.notes = [{ id: 'recorded', instrument: 'piano', pitch: 12, startTick: 73, durationTicks: 7011, velocity: 119 }]
    const { mix: _mix, ideas: _ideas, ...base } = current
    expect(_mix).toEqual(createDefaultMix())
    expect(_ideas).toEqual([])
    const legacy = { ...base, version: 1 }
    const original = structuredClone(legacy)
    const decoded = decodeProject(legacy)
    expect(decoded).toEqual({ ...current, mix: createDefaultMix() })
    expect(legacy).toEqual(original)
    decoded.notes[0].pitch = 60
    decoded.mix.piano.level = 12
    expect(legacy.notes[0].pitch).toBe(12)
    expect(decodeProject(legacy).mix.piano.level).toBe(100)
    expect(validateProject(legacy)).toBe(false)
    expect(() => decodeProject({ ...legacy, mix: createDefaultMix() })).toThrow()
    expect(() => decodeProject({ ...legacy, unexpected: true })).toThrow()
    expect(() => decodeProject({ ...current, version: 4 })).toThrow()
  })

  it('migrates exact v2 without changing sound, timing or help preference', () => {
    const current = createProject(); current.mix.piano.level = 37; current.guidance.open = true
    const { ideas: _ideas, ...base } = current
    expect(_ideas).toEqual([])
    const legacy = { ...base, version: 2 }
    expect(decodeProject(legacy)).toEqual(current)
    expect(() => decodeProject({ ...legacy, ideas: [] })).toThrow()
  })

  it('requires exactly four bounded integer levels and boolean mute settings', () => {
    const project = createProject()
    expect(validateProject({ ...project, mix: { ...project.mix, flute: { level: 100, muted: false } } })).toBe(false)
    for (const level of [-1, 101, .5, NaN, Infinity]) {
      expect(validateProject({ ...project, mix: { ...project.mix, piano: { level, muted: false } } })).toBe(false)
    }
    expect(validateProject({ ...project, mix: { ...project.mix, piano: { level: 50, muted: 'false' } } })).toBe(false)
    expect(validateProject({ ...project, mix: { ...project.mix, piano: { level: 50, muted: true } } })).toBe(true)
  })

  it('accepts unique, in-range notes and rejects notes beyond the project', () => {
    const project = createProject()
    project.notes.push({ id: 'note-1', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 480, velocity: 96 })
    expect(validateProject(project)).toBe(true)

    project.notes[0].startTick = project.bars * TICKS_PER_BAR
    expect(validateProject(project)).toBe(false)
  })

  it('rejects duplicate note ids, non-finite numbers, and unknown fields', () => {
    const project = createProject()
    project.notes = [
      { id: 'same', instrument: 'kick', pitch: 36, startTick: 0, durationTicks: 120, velocity: 100 },
      { id: 'same', instrument: 'hat', pitch: 42, startTick: 120, durationTicks: 120, velocity: 90 },
    ]
    expect(validateProject(project)).toBe(false)
    expect(validateProject({ ...createProject(), bpm: Number.NaN })).toBe(false)
    expect(validateProject({ ...createProject(), lessonProgress: {} })).toBe(false)
  })

  it('formats the full MIDI pitch boundary and rejects invalid pitches', () => {
    expect(noteName(0)).toBe('C-1')
    expect(noteName(60)).toBe('C4')
    expect(noteName(127)).toBe('G9')
    expect(() => noteName(60.5)).toThrow(RangeError)
    expect(() => noteName(128)).toThrow(RangeError)
  })
})
