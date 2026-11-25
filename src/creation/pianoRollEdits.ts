import { MAX_BARS, MAX_NOTES, TICKS_PER_BAR, type Note } from './model'

export interface PianoRollEditResult { notes: Note[]; bars: number }
export type PianoRollEditProposal = PianoRollEditResult | { error: string }

const PROJECT_END = MAX_BARS * TICKS_PER_BAR

function validNote(note: Note): boolean {
  return Number.isSafeInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 127
    && Number.isSafeInteger(note.startTick) && note.startTick >= 0
    && Number.isSafeInteger(note.durationTicks) && note.durationTicks >= 1
    && Number.isSafeInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127
    && note.startTick + note.durationTicks <= PROJECT_END
}

function result(notes: Note[], bars: number): PianoRollEditResult {
  const end = notes.reduce((maximum, note) => Math.max(maximum, note.startTick + note.durationTicks), 1)
  return { notes, bars: Math.max(bars, Math.ceil(end / TICKS_PER_BAR)) }
}

export function addPianoNote(notes: Note[], note: Note, bars: number): PianoRollEditProposal {
  if (notes.length >= MAX_NOTES) return { error: 'The project note limit has been reached.' }
  if (!validNote(note)) return { error: `That note would go outside the MIDI range or ${MAX_BARS}-bar project limit.` }
  if (notes.some(existing => existing.id === note.id)) return { error: 'That note could not be added because its ID is already in use.' }
  return result([...notes, note], bars)
}

export function pastePianoNotes(notes: Note[], clipboard: Note[], startTick: number, bars: number, id: () => string): PianoRollEditProposal {
  if (!clipboard.length) return { error: 'Copy one or more notes first.' }
  if (!Number.isSafeInteger(startTick) || startTick < 0 || notes.length + clipboard.length > MAX_NOTES) return { error: 'Paste exceeds the position or project note limit.' }
  const origin = Math.min(...clipboard.map(note => note.startTick))
  const added = clipboard.map(note => ({ ...note, id: id(), instrument: 'piano' as const, startTick: startTick + note.startTick - origin }))
  const all = [...notes, ...added]
  if (!added.every(validNote) || new Set(all.map(note => note.id)).size !== all.length) return { error: 'Paste would cross the project limit or reuse a note ID.' }
  return result(all, bars)
}

export function patchPianoSelection(notes: Note[], selectedIds: ReadonlySet<string>, patch: Partial<Pick<Note, 'durationTicks' | 'velocity'>>, bars: number): PianoRollEditProposal {
  const next = notes.map(note => selectedIds.has(note.id) && note.instrument === 'piano' ? { ...note, ...patch } : note)
  if (!next.every(validNote)) return { error: 'That edit would make a note invalid or cross the project limit.' }
  return result(next, bars)
}

/** Applies one delta to every selected note. The whole operation is rejected if any note would cross a boundary. */
export function movePianoNotes(notes: Note[], selectedIds: ReadonlySet<string>, pitchDelta: number, tickDelta: number, bars: number): PianoRollEditProposal {
  if (!Number.isSafeInteger(pitchDelta) || !Number.isSafeInteger(tickDelta)) return { error: 'That move is not a whole MIDI step.' }
  let changed = false
  const next = notes.map(note => {
    if (!selectedIds.has(note.id) || note.instrument !== 'piano') return note
    changed = changed || pitchDelta !== 0 || tickDelta !== 0
    return { ...note, pitch: note.pitch + pitchDelta, startTick: note.startTick + tickDelta }
  })
  if (!changed) return result(notes, bars)
  if (!next.every(validNote)) return { error: `That move would go outside the MIDI range or ${MAX_BARS}-bar project limit.` }
  return result(next, bars)
}

export function resizePianoNote(notes: Note[], noteId: string, durationDelta: number, bars: number): PianoRollEditProposal {
  if (!Number.isSafeInteger(durationDelta)) return { error: 'That length is not a whole tick.' }
  let found = false
  const next = notes.map(note => {
    if (note.id !== noteId || note.instrument !== 'piano') return note
    found = true
    return { ...note, durationTicks: note.durationTicks + durationDelta }
  })
  if (!found) return { error: 'That note is no longer available.' }
  if (!next.every(validNote)) return { error: `That resize would make the note empty or cross the ${MAX_BARS}-bar project limit.` }
  return result(next, bars)
}

export function deletePianoNotes(notes: Note[], selectedIds: ReadonlySet<string>, bars: number): PianoRollEditResult {
  return { notes: notes.filter(note => !selectedIds.has(note.id)), bars }
}

/** Exact edits never silently quantize or shorten a note. Invalid edits are atomic no-ops. */
export function proposeNoteEdit(note: Note, patch: Partial<Pick<Note, 'pitch' | 'startTick' | 'durationTicks' | 'velocity'>>, bars: number): { note: Note; bars: number } | null {
  const next = { ...note, ...patch }
  if (![next.pitch, next.startTick, next.durationTicks, next.velocity].every(Number.isSafeInteger)
    || next.pitch < 0 || next.pitch > 127 || next.startTick < 0 || next.durationTicks < 1
    || next.velocity < 1 || next.velocity > 127 || next.startTick + next.durationTicks > MAX_BARS * TICKS_PER_BAR) return null
  if (next.pitch === note.pitch && next.startTick === note.startTick && next.durationTicks === note.durationTicks && next.velocity === note.velocity) return null
  return { note: next, bars: Math.max(bars, Math.ceil((next.startTick + next.durationTicks) / TICKS_PER_BAR)) }
}
