import { describe, expect, it } from 'vitest'
import { createStudioProject, TICKS_PER_BAR } from './model'
import { buildMiraPassage, validateMiraPassage } from './miraPassage'

function fixture() {
  const project = createStudioProject()
  project.name = 'private project'; project.tracks[0].name = 'private track'; project.patterns[0].name = 'private part'
  project.patterns[0].notes = [{ id: 'private-note', pitch: 61, startTick: 1937, durationTicks: 2197, velocity: 83 }]
  return { project, trackId: project.tracks[0].id, clipId: project.clips[0].id }
}
describe('explicit bounded Mira passage', () => {
  it('preserves exact off-grid data and excludes names and identifiers from payload', () => {
    const args = fixture(), before = structuredClone(args.project)
    const result = buildMiraPassage({ ...args, selectedNoteIds: ['private-note'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.passage).toMatchObject({ source: 'selected', rangeStartTick: 1920, rangeEndTick: 3840, notes: [{ pitch: 61, startTick: 1937, durationTicks: 2197, velocity: 83 }] })
    expect(validateMiraPassage(result.snapshot.passage)).toBe(true)
    expect(JSON.stringify(result.snapshot.passage)).not.toMatch(/private|projectId|trackId|clipId|patternId|noteIds|name/)
    result.snapshot.passage.notes[0].pitch = 70
    expect(args.project).toEqual(before)
  })
  it('includes notes crossing either shown boundary without trimming or quantizing', () => {
    const args = fixture()
    args.project.patterns[0].notes.push({ id: 'before-window', pitch: 55, startTick: 1891, durationTicks: 2400, velocity: 79 })
    const result = buildMiraPassage({ ...args, shownRange: { startTick: 1920, endTick: 3840 } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.passage.notes).toEqual(args.project.patterns[0].notes.map(({ pitch, startTick, durationTicks, velocity }) => ({ pitch, startTick, durationTicks, velocity })))
      expect(validateMiraPassage(result.snapshot.passage)).toBe(true)
    }
  })
  it('rejects empty, stale, cross-part, overlong and over-count selections without truncating', () => {
    const args = fixture()
    expect(buildMiraPassage({ ...args, selectedNoteIds: ['other-part-note'] }).ok).toBe(false)
    expect(buildMiraPassage({ ...args, clipId: 'missing', selectedNoteIds: ['private-note'] }).ok).toBe(false)
    expect(buildMiraPassage({ ...args, shownRange: { startTick: 0, endTick: 100 } }).ok).toBe(false)
    args.project.bars = 8; args.project.patterns[0].lengthTicks = 8 * TICKS_PER_BAR
    args.project.patterns[0].notes.push({ id: 'distant', pitch: 65, startTick: 6 * TICKS_PER_BAR, durationTicks: 111, velocity: 95 })
    expect(buildMiraPassage({ ...args, selectedNoteIds: ['private-note', 'distant'] }).ok).toBe(false)
    expect(buildMiraPassage({ ...args, shownRange: { startTick: 0, endTick: 5 * TICKS_PER_BAR } }).ok).toBe(false)
    args.project.patterns[0].notes = Array.from({ length: 65 }, (_, index) => ({ id: `n${index}`, pitch: 60, startTick: index * 11, durationTicks: 100, velocity: 90 }))
    expect(buildMiraPassage({ ...args, shownRange: { startTick: 0, endTick: TICKS_PER_BAR } }).ok).toBe(false)
  })
  it('strictly rejects injected metadata, extra fields, invalid values and invalid boundaries', () => {
    const result = buildMiraPassage({ ...fixture(), selectedNoteIds: ['private-note'] })
    if (!result.ok) throw new Error(result.error)
    const p = result.snapshot.passage
    for (const patch of [{ name: 'private' }, { soundId: 'user-sample' }, { bpm: Infinity }, { rangeEndTick: 20_000 }, { notes: [] }, { notes: [{ ...p.notes[0], id: 'private' }] }, { notes: [{ ...p.notes[0], velocity: 128 }] }, { notes: [{ ...p.notes[0], startTick: 2000.5 }] }, { notes: [{ ...p.notes[0], durationTicks: 500_000 }] }]) expect(validateMiraPassage({ ...p, ...patch })).toBe(false)
  })
})
