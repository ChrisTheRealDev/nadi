import { describe, expect, it } from 'vitest'
import { createStudioProject, defaultTrackProduction } from './model'
import { defaultNotation, DEFAULT_NOTE } from './notationModel'
import { createSheetMusic } from './sheetMusic'
import { applyScoreCommand } from './notationCommands'

function fixture() {
  const project = createStudioProject(); project.version = 6; project.notation = defaultNotation()
  project.patterns[0].notes = [{ id: 'low', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }, { id: 'high', pitch: 67, startTick: 0, durationTicks: 480, velocity: 90 }]
  return project
}
describe('independent score preservation review', () => {
  it('retains an explicit rest voice even when that voice has no pitched notes', () => {
    const p = fixture(); p.notation!.rests = [{ id: 'silent-voice', trackId: p.tracks[0].id, startTick: 0, durationTicks: 480, voice: 7 }]
    const score = createSheetMusic(p, { grid: 1, spelling: 'sharps' })
    expect(score.xml).toMatch(/<note><rest\/>[\s\S]*?<voice>7<\/voice>/)
  })
  it('keeps a rest-only performer part in the full score and individual export', () => {
    const p = fixture()
    p.tracks.push({ ...p.tracks[0], ...defaultTrackProduction(), id: 'rest-track', name: 'Resting flute', soundId: 'flute' })
    p.notation!.rests = [{ id: 'rest', trackId: 'rest-track', startTick: 0, durationTicks: 1920, voice: 1 }]
    expect(createSheetMusic(p, { grid: 1, spelling: 'sharps' }).partCount).toBe(2)
    const individual = createSheetMusic(p, { grid: 1, spelling: 'sharps', trackId: 'rest-track' })
    expect(individual.partCount).toBe(1); expect(individual.noteCount).toBe(0); expect(individual.xml).toContain('<rest/>')
  })
  it('exports a dynamic attached to an upper chord tone', () => {
    const p = fixture(); p.notation!.notes.high = { ...DEFAULT_NOTE, dynamic: 'mf' }
    expect(createSheetMusic(p, { grid: 1, spelling: 'sharps' }).xml).toContain('<mf/>')
  })
  it('splits long rests without attaching pitched-note ties or creating rest chords', () => {
    const p = fixture(); p.patterns[0].notes = []
    p.notation!.rests = ['one', 'duplicate'].map(id => ({ id, trackId: p.tracks[0].id, startTick: 0, durationTicks: 2500, voice: 1 }))
    const xml = createSheetMusic(p, { grid: 1, spelling: 'sharps' }).xml
    expect(xml).not.toContain('<tie '); expect(xml).not.toContain('<tied '); expect(xml).not.toContain('<chord/>')
  })
  it('leaves all original music and captures intact after a rejected measure operation', () => {
    const p = fixture()
    p.ideas.push({ id: 'original', name: 'Original idea', createdAt: '2026-09-26T00:00:00.000Z', attachedTick: null, original: { kind: 'text', text: 'Preserve this source' } })
    const original = structuredClone(p)
    expect(() => applyScoreCommand(p, { type: 'delete-measure', index: -1 })).toThrow()
    expect(() => applyScoreCommand(p, { type: 'update', selection: [{ clipId: p.clips[0].id, noteId: 'high' }], patch: { pitch: 200 } })).toThrow()
    expect(p).toEqual(original)
  })
})
