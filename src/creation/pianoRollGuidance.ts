import type { Note } from './model'

export type PianoGuidanceAction = 'chord-selected' | 'notes-moved' | 'notes-resized'

/** Classify the actual committed musical difference, never button labels or drafts. */
export function pianoGuidanceEdit(before: readonly Note[], after: readonly Note[]): PianoGuidanceAction | null {
  if (before.length !== after.length || !before.length) return null
  const originals = new Map(before.map(note => [note.id, note]))
  let moved = false, resized = false
  for (const note of after) {
    const original = originals.get(note.id)
    if (!original || original.instrument !== note.instrument || original.velocity !== note.velocity) return null
    moved ||= original.pitch !== note.pitch || original.startTick !== note.startTick
    resized ||= original.durationTicks !== note.durationTicks
  }
  return moved && !resized ? 'notes-moved' : resized && !moved ? 'notes-resized' : null
}
