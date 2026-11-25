import { TICKS_PER_BAR, TICKS_PER_BEAT, type CreationProject, type Note } from './model'

export interface PianoSelection { projectId: string; noteId: string }

/** One selection drives both the visible inspector and Mira's minimal facts. */
export function resolvePianoSelection(project: Pick<CreationProject, 'id' | 'notes'>, selection: PianoSelection | null, selectedBar: number, editor: 'piano' | 'drums'): string | null {
  if (editor !== 'piano' || !selection || selection.projectId !== project.id) return null
  const barStart = selectedBar * TICKS_PER_BAR
  return project.notes.some(note => note.id === selection.noteId && note.instrument === 'piano' && note.startTick < barStart + TICKS_PER_BAR && note.startTick + note.durationTicks > barStart) ? selection.noteId : null
}

/** Fixed anchor, not a transitive cluster. Never quantizes an expressive performance. */
export const CHORD_ONSET_TOLERANCE = TICKS_PER_BEAT / 8
export function chordNoteIds(notes: readonly Note[], anchorId: string | null): Set<string> {
  const anchor = notes.find(note => note.id === anchorId && note.instrument === 'piano')
  if (!anchor) return new Set()
  return new Set(notes.filter(note => note.instrument === 'piano'
    && Math.abs(note.startTick - anchor.startTick) <= CHORD_ONSET_TOLERANCE).map(note => note.id))
}
