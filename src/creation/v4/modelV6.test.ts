import { describe, expect, it } from 'vitest'
import { compileArrangement, createStudioProject, decodeStudioProject, validateStudioProject } from './model'
import { defaultNotation, DEFAULT_NOTE, DEFAULT_TRACK, DEFAULT_MEASURE } from './notationModel'
import { packStudioProject, unpackStudioProjectWithRecovery } from './archive'
import { createSheetMusic } from './sheetMusic'

function fixture() {
  const p = createStudioProject()
  p.patterns[0].notes = [{ id: 'source-note', pitch: 60, startTick: 137, durationTicks: 2111, velocity: 81 }]
  p.ideas = [
    { id: 'text-original', name: 'Private draft', createdAt: '2026-09-26T00:00:00.000Z', attachedTick: null, original: { kind: 'text', text: 'Unedited original idea' } },
    { id: 'audio-original', name: 'Original bytes', createdAt: '2026-09-26T00:00:00.000Z', attachedTick: 0, original: { kind: 'audio', mimeType: 'audio/wav', byteLength: 3, base64: 'AQID', durationMs: 100 } },
  ]
  return p
}
function v6() {
  const p = fixture(); p.version = 6; p.notation = defaultNotation()
  p.notation.notes['source-note'] = { ...DEFAULT_NOTE, dynamic: 'mf', articulation: 'accent', tuplet: 3 }
  p.notation.tracks[p.tracks[0].id] = { ...DEFAULT_TRACK, staffSplit: 62 }
  p.notation.measures = [{ ...DEFAULT_MEASURE, beats: 6, beatType: 8, keyFifths: -2 }]
  return p
}
describe('v6 preservation and trust boundaries', () => {
  it('keeps v5 strict and does not silently upgrade or alter original timing on decode', () => {
    const p = fixture(), before = structuredClone(p), decoded = decodeStudioProject(p)
    expect(decoded).toEqual(before); expect(decoded).not.toBe(p)
    expect(decoded.version).toBe(5)
    expect(validateStudioProject({ ...p, notation: defaultNotation() })).toBe(false)
    expect(validateStudioProject({ ...p, version: 6 })).toBe(false)
    expect(p).toEqual(before)
  })
  it('round-trips the full v6 archive with original captures and expressive source metadata intact', () => {
    const p = v6(), before = structuredClone(p)
    const recovered = unpackStudioProjectWithRecovery(packStudioProject(p))
    expect(recovered.project).toEqual(before)
    expect(recovered.preUpgradeRaw).toBeUndefined()
    expect(recovered.project.ideas[1].original).toEqual(before.ideas[1].original)
    expect(p).toEqual(before)
    expect(compileArrangement(recovered.project)[0]).toMatchObject({ sourceNoteId: 'source-note', startTick: 137, durationTicks: 2111, pitch: 60, velocity: 81 })
  })
  it('rejects detached notation metadata, invalid signatures, unexpected fields and duplicate rest IDs', () => {
    const p = v6(); expect(validateStudioProject(p)).toBe(true)
    const dangling = structuredClone(p); dangling.notation!.notes['missing-note'] = { ...DEFAULT_NOTE }
    expect(validateStudioProject(dangling)).toBe(false)
    const unknownTrack = structuredClone(p); unknownTrack.notation!.tracks['missing-track'] = { ...DEFAULT_TRACK }
    expect(validateStudioProject(unknownTrack)).toBe(false)
    const badMeter = structuredClone(p); badMeter.notation!.measures[0].beats = 0
    expect(validateStudioProject(badMeter)).toBe(false)
    expect(validateStudioProject({ ...p, notation: { ...p.notation, ignored: true } })).toBe(false)
    const rests = structuredClone(p), rest = { id: 'r', trackId: p.tracks[0].id, startTick: 3000, durationTicks: 480, voice: 1 }
    rests.notation!.rests = [rest, { ...rest }]
    expect(validateStudioProject(rests)).toBe(false)
  })
  it('exports exact timing and mappings to source identities without changing the composition', () => {
    const p = v6(), before = structuredClone(p)
    const score = createSheetMusic(p, { grid: 1, spelling: 'flats' })
    expect(score.roundedNotes).toBe(0)
    expect(score.xml).toContain('<beats>6</beats><beat-type>8</beat-type>')
    expect(score.xml).toContain('<mf/>')
    expect(score.xml).toContain('<accent/>')
    expect(score.mapping.length).toBeGreaterThan(0)
    expect(score.mapping.every(value => value.noteId === 'source-note' && value.clipId === p.clips[0].id)).toBe(true)
    expect(p).toEqual(before)
  })
})
