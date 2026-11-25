import { describe, expect, it } from 'vitest'
import type { Note } from './model'
import { chordNoteIds, CHORD_ONSET_TOLERANCE, resolvePianoSelection } from './pianoRollSelection'
import { movePianoNotes } from './pianoRollEdits'

const legacyNote: Note = { id: 'one', instrument: 'piano', pitch: 60, startTick: 137, durationTicks: 480, velocity: 90 }
const project = { id: 'project-one', notes: [legacyNote] }, selection = { projectId: project.id, noteId: legacyNote.id }
describe('shared piano selection', () => {
  it('restores a real controlled selection after switching drums then piano', () => {
    expect(resolvePianoSelection(project, selection, 0, 'piano')).toBe(legacyNote.id)
    expect(resolvePianoSelection(project, selection, 0, 'drums')).toBeNull()
    expect(resolvePianoSelection(project, selection, 0, 'piano')).toBe(legacyNote.id)
  })
  it('does not select an old note after a root-driven bar change or deletion undo', () => {
    expect(resolvePianoSelection(project, selection, 1, 'piano')).toBeNull()
    expect(resolvePianoSelection({ ...project, notes: [] }, selection, 0, 'piano')).toBeNull()
  })
  it('does not leak selection across project switches with reused note IDs', () => {
    expect(resolvePianoSelection({ ...project, id: 'project-two' }, selection, 0, 'piano')).toBeNull()
  })
  it('can select a visible sustained note continuing from an earlier bar', () => {
    expect(resolvePianoSelection({ ...project, notes: [{ ...legacyNote, durationTicks: 2401 }] }, selection, 1, 'piano')).toBe(legacyNote.id)
  })
})

const note = (id: string, pitch: number, startTick: number): Note => ({ id, instrument: 'piano', pitch, startTick, durationTicks: 480, velocity: 83 })
describe('chord selection', () => {
  it('selects expressive onsets within one eighth beat of a fixed anchor without rewriting music', () => {
    const notes = [note('c', 60, 960), note('e', 64, 984), note('g', 67, 948), note('edge', 72, 1020), note('outside', 74, 1021), note('sustain', 55, 600)]
    const before = structuredClone(notes)
    expect(CHORD_ONSET_TOLERANCE).toBe(60)
    expect([...chordNoteIds(notes, 'c')]).toEqual(['c', 'e', 'g', 'edge'])
    expect(notes).toEqual(before)
  })
  it('does not transitively absorb later notes or select percussion and missing anchors', () => {
    const notes = [note('anchor', 60, 120), note('near', 64, 180), note('later', 67, 240), { ...note('drum', 36, 120), instrument: 'kick' as const }]
    expect([...chordNoteIds(notes, 'anchor')]).toEqual(['anchor', 'near'])
    expect(chordNoteIds(notes, 'missing').size).toBe(0)
    expect(chordNoteIds(notes, 'drum').size).toBe(0)
    expect(chordNoteIds(notes, null).size).toBe(0)
  })
  it('moves every selected chord note by the same exact delta and rejects out-of-bounds groups atomically', () => {
    const notes = [note('low', 0, 137), note('middle', 4, 161), note('high', 7, 125), note('later', 60, 1920)], before = structuredClone(notes)
    const ids = chordNoteIds(notes, 'low'), moved = movePianoNotes(notes, ids, 12, 480, 4)
    expect(moved).not.toHaveProperty('error')
    if ('error' in moved) throw new Error(moved.error)
    expect(moved.notes.map(note => [note.pitch, note.startTick])).toEqual([[12, 617], [16, 641], [19, 605], [60, 1920]])
    expect(movePianoNotes(notes, ids, -1, 480, 4)).toHaveProperty('error')
    expect(movePianoNotes(notes, ids, 0, -126, 4)).toHaveProperty('error')
    expect(notes).toEqual(before)
  })
})
