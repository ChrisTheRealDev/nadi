import type { HistoryDescription } from './history'
import { isMelodicSound, type Clip, type StudioProject } from './model'
import type { StudioObservedAction } from './studioHelp'

export type AcceptedEditObservation = Required<Pick<StudioObservedAction, 'projectId'>> & Pick<StudioObservedAction, 'trackId' | 'clipId'> & {
  type: 'mix-changed' | 'note-changed' | 'drum-hit-changed' | 'note-deleted'
}

/** Derive Mira events only from graph data that an accepted edit actually changed. */
export function acceptedEditObservations(before: StudioProject, after: StudioProject, description?: HistoryDescription): AcceptedEditObservation[] {
  if (before.id !== after.id) return []
  const events: AcceptedEditObservation[] = []
  const matchingClip = (clips: Clip[], match: (clip: Clip) => boolean) => {
    const candidates = clips.filter(match)
    const requested = candidates.find(clip => clip.id === description?.context?.clipId)
    return requested?.id ?? (candidates.length === 1 ? candidates[0].id : undefined)
  }
  for (const track of after.tracks) {
    const previous = before.tracks.find(item => item.id === track.id)
    if (!previous || (previous.level === track.level && previous.muted === track.muted)) continue
    events.push({ type: 'mix-changed', projectId: after.id, trackId: track.id, clipId: matchingClip(after.clips, clip => clip.trackId === track.id) })
  }
  for (const part of after.patterns) {
    const previous = before.patterns.find(item => item.id === part.id)
    if (!previous) continue // A copied or newly created part is an arrangement action.
    const oldNotes = new Map(previous.notes.map(note => [note.id, note]))
    const newIds = new Set(part.notes.map(note => note.id))
    const changed = part.notes.some(note => JSON.stringify(note) !== JSON.stringify(oldNotes.get(note.id)))
    const deleted = previous.notes.some(note => !newIds.has(note.id))
    if (!changed && !deleted) continue
    const track = after.tracks.find(item => item.id === part.trackId)
    if (!track) continue
    const clipId = matchingClip(after.clips, clip => clip.patternId === part.id && clip.trackId === part.trackId)
    const scope = { projectId: after.id, trackId: part.trackId, clipId }
    events.push({ type: isMelodicSound(track.soundId) ? 'note-changed' : 'drum-hit-changed', ...scope })
    if (deleted && isMelodicSound(track.soundId)) events.push({ type: 'note-deleted', ...scope })
  }
  return events
}
