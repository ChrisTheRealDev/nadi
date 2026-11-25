import { describe, expect, it } from 'vitest'
import { createStudioProject, type SoundId, type PatternNote } from './model'
import { analyzePlayability } from './playability'

const note = (id: string, pitch: number, startTick = 0, durationTicks = 480): PatternNote => ({ id, pitch, startTick, durationTicks, velocity: 90 })
function fixture(soundId: SoundId = 'trumpet', notes = [note('a', 60), note('b', 64)]) {
  const project = createStudioProject()
  project.tracks[0].soundId = soundId; project.patterns[0].notes = notes
  return project
}
describe('offline performer guidance', () => {
  it('detects a conventional solo conflict, references the exact notes, and never changes the project', () => {
    const p = fixture(), before = structuredClone(p), result = analyzePlayability(p)
    expect(p).toEqual(before)
    expect(result).toMatchObject({ projectId: p.id, projectRevision: p.revision, checkedNoteOccurrences: 2 })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ rule: 'single-player-overlap', severity: 'conventional-conflict' })
    expect(result.findings[0].affected.map(value => value.noteId)).toEqual(['a', 'b'])
    expect(result.findings[0].alternatives.join(' ')).toContain('separate players')
    expect(Object.isFrozen(result.findings[0].affected[0])).toBe(true)
  })
  it('checks sounding range boundaries inclusively, never written-transposed pitches', () => {
    const p = fixture('french-horn', [note('lo', 35, 0), note('hi', 77, 480)])
    expect(analyzePlayability(p).findings).toEqual([])
    p.patterns[0].notes.push(note('outside', 78, 960))
    const finding = analyzePlayability(p).findings[0]
    expect(finding.rule).toBe('reference-range'); expect(finding.severity).toBe('review')
    expect(finding.affected.map(value => value.noteId)).toEqual(['outside'])
  })
  it('ignores same-pitch unison, touching endpoints and reverb tails', () => {
    expect(analyzePlayability(fixture('flute', [note('a', 65), note('b', 65, 100), note('c', 70, 580)])).findings).toEqual([])
  })
  it('finds overlap across arranged clips and keeps repeated source occurrences distinct', () => {
    const p = fixture('flute', [note('a', 65, 0, 900), note('b', 70, 1000)])
    p.patterns[0].lengthTicks = 1920
    p.clips.push({ ...p.clips[0], id: 'repeat', startTick: 480 })
    const affected = analyzePlayability(p).findings[0].affected
    expect(affected.some(value => value.noteId === 'a' && value.clipId === 'repeat')).toBe(true)
    expect(affected.some(value => value.noteId === 'b' && value.clipId === p.clips[0].id)).toBe(true)
    expect(affected.find(value => value.clipId === 'repeat' && value.noteId === 'a')?.startTick).toBe(480)
  })
  it('does not mix unplaced patterns into the arrangement but checks their internal chords', () => {
    const p = fixture('flute', [note('a', 65)])
    p.patterns.push({ ...p.patterns[0], id: 'unplaced', notes: [note('b', 70)] })
    expect(analyzePlayability(p).findings).toEqual([])
    p.patterns[1].notes.push(note('c', 72))
    expect(analyzePlayability(p).findings[0].affected.every(value => value.clipId === null)).toBe(true)
  })
  it('resolves warnings after an edit and retags the current revision', () => {
    const p = fixture(); expect(analyzePlayability(p).findings).toHaveLength(1)
    p.patterns[0].notes[1].startTick = 480; p.revision++
    expect(analyzePlayability(p)).toMatchObject({ projectRevision: 1, findings: [] })
    p.tracks[0].soundId = 'piano'; p.patterns[0].notes[1].startTick = 0
    expect(analyzePlayability(p).findings).toEqual([])
  })
  it('does not guess acoustic restrictions for synthetic, approximate or ensemble sounds', () => {
    for (const sound of ['soft-pad', 'vocal-air', 'ancient-reed', 'strings'] as const) {
      expect(analyzePlayability(fixture(sound, [note('a', 10), note('b', 127)])).findings.map(value => value.rule)).toEqual(['performer-unspecified'])
    }
    for (const sound of ['viola', 'cello', 'kick', 'snare', 'hat'] as const) {
      expect(analyzePlayability(fixture(sound)).findings.some(value => value.rule === 'single-player-overlap')).toBe(false)
    }
  })
  it('honors explicit ensembles and electronic playback while retaining acoustic range review', () => {
    const p = fixture('trumpet', [note('a', 60), note('b', 127)]), id = p.tracks[0].id
    expect(analyzePlayability(p, { [id]: 'ensemble' }).findings.map(value => value.rule)).toEqual(['reference-range'])
    expect(analyzePlayability(p, { [id]: 'electronic' }).findings).toEqual([])
    p.tracks[0].name = 'three trumpeters'
    expect(analyzePlayability(p).findings.some(value => value.rule === 'single-player-overlap')).toBe(true)
  })
  it('includes hidden and muted parts for performance review and groups repeated problems', () => {
    const p = fixture('flute', Array.from({ length: 100 }, (_, index) => note(String(index), index % 2 ? 110 : 112, index * 10, 480)))
    p.tracks[0].muted = true; p.tracks[0].hidden = true
    const result = analyzePlayability(p)
    expect(result.findings).toHaveLength(2)
    expect(result.findings.every(value => value.affected.length === 100)).toBe(true)
  })
})
