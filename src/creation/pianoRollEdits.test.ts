import { describe, expect, it } from 'vitest'
import { addPianoNote, deletePianoNotes, movePianoNotes, pastePianoNotes, patchPianoSelection, proposeNoteEdit, resizePianoNote } from './pianoRollEdits'
import { copiedNotes, copyNotes } from './noteClipboard'
import { MAX_BARS, TICKS_PER_BAR, type Note } from './model'

const recorded: Note = { id: 'recorded', instrument: 'piano', pitch: 60, startTick: 137, durationTicks: 2291, velocity: 81 }
describe('exact piano roll edits', () => {
  it('copies exact offsets and fresh IDs across editor/project lifetimes', () => {
    const other = { ...recorded, id: 'second', startTick: 204, durationTicks: 63, velocity: 77 }
    copyNotes([recorded, other]); const detached = copiedNotes(); detached[0].pitch = 100
    expect(copiedNotes()[0].pitch).toBe(60)
    let counter = 0
    const pasted = pastePianoNotes([], copiedNotes(), 1920, 4, () => `copy-${counter++}`)
    expect(pasted).toEqual({ notes: [{ ...recorded, id: 'copy-0', startTick: 1920 }, { ...other, id: 'copy-1', startTick: 1987 }], bars: 4 })
  })
  it('rejects whole clipboard batches at bounds, duplicate IDs and capacity', () => {
    const notes = [recorded]
    expect(pastePianoNotes(notes, [recorded], MAX_BARS * TICKS_PER_BAR - 1, 4, () => 'fresh')).toHaveProperty('error')
    expect(pastePianoNotes(notes, [recorded], 0, 4, () => recorded.id)).toHaveProperty('error')
    expect(pastePianoNotes(Array.from({ length: 10000 }, (_, i) => ({ ...recorded, id: `n-${i}` })), [recorded], 0, 4, () => 'fresh')).toHaveProperty('error')
    expect(notes).toEqual([recorded])
  })
  it('applies selection strength/length in one result, without partial changes', () => {
    const last = { ...recorded, id: 'last', startTick: MAX_BARS * TICKS_PER_BAR - 2, durationTicks: 2 }
    const notes = [recorded, last], ids = new Set(notes.map(note => note.id))
    expect(patchPianoSelection(notes, ids, { velocity: 55 }, MAX_BARS)).toEqual({ notes: notes.map(note => ({ ...note, velocity: 55 })), bars: MAX_BARS })
    expect(patchPianoSelection(notes, ids, { durationTicks: 480 }, MAX_BARS)).toHaveProperty('error')
    expect(notes[0].durationTicks).toBe(2291)
  })
  it('changes pitch without quantizing original timing or truncating sustained notes', () => {
    expect(proposeNoteEdit(recorded, { pitch: 127 }, 4)).toEqual({ note: { ...recorded, pitch: 127 }, bars: 4 })
    expect(recorded.startTick).toBe(137)
  })
  it('extends arrangement when a sustained note is moved past its current end', () => {
    expect(proposeNoteEdit(recorded, { startTick: 7551 }, 4)).toEqual({ note: { ...recorded, startTick: 7551 }, bars: 6 })
  })
  it.each([{ pitch: -1 }, { pitch: 128 }, { velocity: 0 }, { velocity: 128 }, { durationTicks: 0 }, { startTick: -1 }, { startTick: .5 }, { durationTicks: NaN }, { startTick: 256 * 1920 }])('rejects invalid edits without changing the note: %j', patch => {
    const original = { ...recorded }
    expect(proposeNoteEdit(recorded, patch, 4)).toBeNull()
    expect(recorded).toEqual(original)
  })
  it('does not create an undo action for unchanged values', () => { expect(proposeNoteEdit(recorded, { startTick: recorded.startTick }, 4)).toBeNull() })

  it('moves a multi-selection atomically while preserving each exact offset', () => {
    const second = { ...recorded, id: 'second', pitch: 64, startTick: 211 }
    const moved = movePianoNotes([recorded, second], new Set(['recorded', 'second']), 2, 120, 4)
    expect(moved).toEqual({ notes: [{ ...recorded, pitch: 62, startTick: 257 }, { ...second, pitch: 66, startTick: 331 }], bars: 4 })
    const rejected = movePianoNotes([recorded, { ...second, pitch: 127 }], new Set(['recorded', 'second']), 1, 0, 4)
    expect(rejected).toMatchObject({ error: expect.stringContaining('MIDI range') })
    expect(recorded).toMatchObject({ pitch: 60, startTick: 137 })
  })

  it('adds, resizes, and deletes without partially applying invalid boundaries', () => {
    const added = addPianoNote([], recorded, 1)
    expect(added).toEqual({ notes: [recorded], bars: 2 })
    expect(resizePianoNote([recorded], recorded.id, -recorded.durationTicks, 4)).toMatchObject({ error: expect.any(String) })
    const atLimit = { ...recorded, startTick: MAX_BARS * TICKS_PER_BAR - recorded.durationTicks }
    expect(resizePianoNote([atLimit], atLimit.id, 1, MAX_BARS)).toMatchObject({ error: expect.stringContaining('project limit') })
    expect(deletePianoNotes([recorded], new Set([recorded.id]), 4)).toEqual({ notes: [], bars: 4 })
  })
})
