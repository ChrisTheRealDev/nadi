import { TICKS_PER_BAR, type Note } from './model'

export interface PlaybackLoopRange {
  startTick: number
  endTick: number
}

export interface PlaybackOccurrence {
  note: Note
  tick: number
  /** Present only when chasing a note across the initial loop boundary. */
  durationTicks?: number
}

/** Half-open, monotonic scheduling windows never replay a previously queued start. */
export function notesInPlaybackWindow(notes: readonly Note[], from: number, to: number, loop?: number | PlaybackLoopRange): PlaybackOccurrence[] {
  if (to <= from) return []
  if (loop === undefined) return notes.filter(note => note.startTick >= from && note.startTick < to).map(note => ({ note, tick: note.startTick }))
  if (loop === null || (typeof loop !== 'number' && typeof loop !== 'object')) return []
  const range = typeof loop === 'number'
    ? { startTick: loop * TICKS_PER_BAR, endTick: (loop + 1) * TICKS_PER_BAR }
    : loop
  const length = range.endTick - range.startTick
  if (!Number.isSafeInteger(range.startTick) || !Number.isSafeInteger(range.endTick) || range.startTick < 0 || length <= 0) return []
  const pattern = notes.filter(note => note.startTick >= range.startTick && note.startTick < range.endTick)
  const result: PlaybackOccurrence[] = []

  // A range can begin in the middle of a held note. Start only its remaining
  // tail on the first pass; it is not part of the repeating attack pattern.
  if (from <= 0 && to > 0) {
    for (const note of notes) {
      const noteEnd = note.startTick + note.durationTicks
      if (note.startTick < range.startTick && noteEnd > range.startTick) {
        result.push({ note, tick: 0, durationTicks: noteEnd - range.startTick })
      }
    }
  }

  for (let cycle = Math.floor(from / length); cycle * length < to; cycle++) {
    for (const note of pattern) {
      const tick = cycle * length + note.startTick - range.startTick
      if (tick >= from && tick < to) result.push({ note, tick })
    }
  }
  return result
}
