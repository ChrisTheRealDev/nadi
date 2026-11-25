import { compileArrangement, type CompiledNote, type StudioProject, type Track } from './model'

export interface StudioRange { startTick?: number; endTick?: number }
export function audibleTracks(tracks: readonly Track[], solo: ReadonlySet<string> = new Set()): Track[] {
  return tracks.filter(track => !track.muted && track.level > 0 && (solo.size === 0 || solo.has(track.id)))
}
export function resolveStudioRange(project: StudioProject, options: StudioRange = {}) {
  const startTick = options.startTick ?? 0, endTick = options.endTick ?? project.bars * 1920
  if (!Number.isSafeInteger(startTick) || !Number.isSafeInteger(endTick) || startTick < 0 || endTick <= startTick || endTick > project.bars * 1920) throw new RangeError('Choose a valid song range.')
  return { startTick, endTick }
}
/** Range starts chase existing sustains once; newly attacked notes retain their full tails. */
export function notesForRange(notes: readonly CompiledNote[], startTick: number, endTick: number): CompiledNote[] {
  return notes.filter(note => note.startTick < endTick && note.startTick + note.durationTicks > startTick).map(note => ({
    ...note, startTick: Math.max(0, note.startTick - startTick),
    durationTicks: note.durationTicks - Math.max(0, startTick - note.startTick),
  }))
}
export function audibleArrangement(project: StudioProject, solo: ReadonlySet<string> = new Set()) {
  const ids = new Set(audibleTracks(project.tracks, solo).map(track => track.id))
  return compileArrangement(project).filter(note => ids.has(note.trackId))
}
