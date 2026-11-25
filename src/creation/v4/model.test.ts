import { describe, expect, it } from 'vitest'
import { createProject } from '../model'
import { createTextIdea } from '../ideas'
import { compileArrangement, createStudioProject, decodeStudioProject, MAX_EXPRESSION_POINTS, MAX_NOTES, validateStudioProject, validateStudioProjectV4 } from './model'
import { duplicateClip, updatePatternNotes } from './operations'

describe('v4 studio graph', () => {
  it('starts with an immediately drawable four-bar piano part', () => {
    const project = createStudioProject()
    expect(validateStudioProject(project)).toBe(true)
    expect(project.tracks).toHaveLength(1)
    expect(project.patterns[0]).toMatchObject({ trackId: project.tracks[0].id, lengthTicks: 7680, notes: [] })
    expect(project.clips[0]).toMatchObject({ trackId: project.tracks[0].id, patternId: project.patterns[0].id, startTick: 0 })
    expect(compileArrangement(project)).toEqual([])
  })

  it.each([1, 2, 3])('migrates v%i exact notes, mix, revision and captures without touching input', version => {
    const legacy = createProject()
    legacy.revision = 23
    legacy.notes = [
      { id: 'free-time', instrument: 'piano', pitch: 0, startTick: 73, durationTicks: 7011, velocity: 119 },
      { id: 'off-grid-drum', instrument: 'hat', pitch: 61, startTick: 125, durationTicks: 59, velocity: 81 },
    ]
    legacy.mix.piano = { level: 37, muted: true }
    legacy.ideas = [createTextIdea('Keep this original')]
    const raw: Record<string, unknown> = { ...structuredClone(legacy), version }
    if (version < 3) delete raw.ideas
    if (version === 1) delete raw.mix
    const before = structuredClone(raw), migrated = decodeStudioProject(raw)
    expect(raw).toEqual(before)
    expect(migrated).toMatchObject({ version: 5, id: legacy.id, revision: 23, bars: 4 })
    expect(migrated.tracks).toHaveLength(4)
    expect(migrated.patterns).toHaveLength(4)
    expect(migrated.clips.every(clip => clip.startTick === 0)).toBe(true)
    expect(migrated.tracks[0]).toMatchObject(version === 1 ? { level: 100, muted: false } : { level: 37, muted: true })
    expect(migrated.ideas).toEqual(version < 3 ? [] : legacy.ideas)
    expect(compileArrangement(migrated).map(note => ({ id: note.sourceNoteId, instrument: note.instrument, pitch: note.pitch, startTick: note.startTick, durationTicks: note.durationTicks, velocity: note.velocity }))).toEqual(legacy.notes)
    expect(decodeStudioProject(raw)).toEqual(migrated)
  })

  it('compiles overlapping linked occurrences with distinct stable identity and full tails', () => {
    let project = createStudioProject()
    project = updatePatternNotes(project, project.patterns[0].id, [{ id: 'tail', pitch: 60, startTick: 100, durationTicks: 2300, velocity: 90 }], 1920)
    project = duplicateClip(project, project.clips[0].id, true, 333)
    project.tracks[0].hidden = true; project.tracks[0].muted = true
    const events = compileArrangement(project)
    expect(events.map(note => note.startTick)).toEqual([100, 433])
    expect(events.every(note => note.durationTicks === 2300)).toBe(true)
    expect(new Set(events.map(note => note.id)).size).toBe(2)
    expect(compileArrangement(structuredClone(project))).toEqual(events)
  })

  it('rejects unknown versions, fields, missing references and cross-track patterns', () => {
    const project = createStudioProject()
    expect(validateStudioProject({ ...project, unexpected: true })).toBe(false)
    expect(() => decodeStudioProject({ ...project, version: 6 })).toThrow()
    for (const mutation of [
      (p: typeof project) => { p.clips[0].patternId = 'absent' },
      (p: typeof project) => { p.clips[0].trackId = 'absent' },
      (p: typeof project) => { p.patterns[0].trackId = 'absent' },
      (p: typeof project) => { p.tracks[0].soundVersion = 2 as 1 },
      (p: typeof project) => { p.tracks[0].color = 'url(evil)' },
      (p: typeof project) => { p.clips.push({ ...p.clips[0] }) },
    ]) {
      const invalid = structuredClone(project); mutation(invalid)
      expect(validateStudioProject(invalid)).toBe(false)
      expect(() => compileArrangement(invalid)).toThrow()
    }
  })

  it('strictly migrates v4 with neutral production settings and exactly unchanged music and originals', () => {
    const current = createStudioProject()
    current.patterns[0].notes = [{ id: 'exact', pitch: 67, startTick: 137, durationTicks: 2111, velocity: 81 }]
    current.tracks[0].level = 37; current.tracks[0].muted = true
    current.ideas = [createTextIdea('untouched source')]
    const old = { ...current, version: 4, tracks: current.tracks.map(track => Object.fromEntries(Object.entries(track).filter(([key]) => !['pan', 'space', 'spaceBypass', 'expression'].includes(key)))) }
    const before = structuredClone(old), upgraded = decodeStudioProject(old)
    expect(validateStudioProjectV4(old)).toBe(true)
    expect(validateStudioProject(old)).toBe(false)
    expect(upgraded).toEqual(current)
    expect(old).toEqual(before)
    expect(compileArrangement(upgraded)).toEqual(compileArrangement(current))
    expect(upgraded.tracks[0]).toMatchObject({ pan: 0, space: 0, spaceBypass: false, expression: [] })
    expect(() => decodeStudioProject({ ...old, tracks: [{ ...old.tracks[0], pan: 0 }] })).toThrow()
    expect(() => decodeStudioProject({ ...old, tracks: [{ ...old.tracks[0], soundVersion: 2 }] })).toThrow()
  })

  it('validates strict bounded production fields, integer expression timing and unique order', () => {
    const project = createStudioProject()
    project.tracks[0] = { ...project.tracks[0], pan: -.4, space: .7, spaceBypass: true, expression: [{ tick: 0, value: .2 }, { tick: 7680, value: 1 }] }
    expect(validateStudioProject(project)).toBe(true)
    const invalid = [
      { pan: NaN }, { pan: 1.01 }, { space: -.1 }, { spaceBypass: 1 },
      { expression: [{ tick: .5, value: 1 }] }, { expression: [{ tick: 7681, value: 1 }] },
      { expression: [{ tick: 0, value: 1.1 }] }, { expression: [{ tick: 0, value: 1, other: 0 }] },
      { expression: [{ tick: 2, value: 1 }, { tick: 1, value: .2 }] },
      { expression: [{ tick: 0, value: 1 }, { tick: 0, value: .2 }] },
      { expression: Array.from({ length: MAX_EXPRESSION_POINTS + 1 }, (_, tick) => ({ tick, value: 1 })) },
    ]
    for (const patch of invalid) expect(validateStudioProject({ ...project, tracks: [{ ...project.tracks[0], ...patch }] })).toBe(false)
    const withoutPan = Object.fromEntries(Object.entries(project.tracks[0]).filter(([key]) => key !== 'pan'))
    expect(validateStudioProject({ ...project, tracks: [withoutPan] })).toBe(false)
  })

  it('bounds both stored notes and expanded linked occurrences before compilation', () => {
    const project = createStudioProject()
    project.patterns[0].notes = Array.from({ length: MAX_NOTES }, (_, index) => ({ id: `n${index}`, pitch: 60, startTick: 0, durationTicks: 1, velocity: 80 }))
    expect(validateStudioProject(project)).toBe(true)
    project.clips.push({ ...project.clips[0], id: 'linked' })
    expect(validateStudioProject(project)).toBe(false)
    project.clips.pop(); project.patterns[0].notes.push({ id: 'overflow', pitch: 60, startTick: 0, durationTicks: 1, velocity: 80 })
    expect(validateStudioProject(project)).toBe(false)
  })
})
