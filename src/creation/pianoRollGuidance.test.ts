import { describe, expect, it } from 'vitest'
import { pianoGuidanceEdit } from './pianoRollGuidance'
import type { Note } from './model'

const notes: Note[] = [60, 64, 67].map((pitch, i) => ({ id: String(i), instrument: 'piano', pitch, startTick: 73, durationTicks: 481, velocity: 90 }))
describe('precise committed note guidance events', () => {
  it('distinguishes a chord move from a length change', () => {
    expect(pianoGuidanceEdit(notes, notes.map(note => ({ ...note, pitch: note.pitch + 1, startTick: note.startTick + 120 })))).toBe('notes-moved')
    expect(pianoGuidanceEdit(notes, notes.map(note => ({ ...note, durationTicks: 960 })))).toBe('notes-resized')
  })
  it('does not classify unchanged, strength, insert, delete or mixed edits as moving/resizing', () => {
    expect(pianoGuidanceEdit(notes, structuredClone(notes))).toBeNull()
    expect(pianoGuidanceEdit(notes, notes.map(note => ({ ...note, velocity: 70 })))).toBeNull()
    expect(pianoGuidanceEdit(notes, notes.slice(1))).toBeNull()
    expect(pianoGuidanceEdit(notes, [...notes, { ...notes[0], id: 'new' }])).toBeNull()
    expect(pianoGuidanceEdit(notes, notes.map(note => ({ ...note, pitch: note.pitch + 1, durationTicks: 960 })))).toBeNull()
  })
})
