import type { StudioProject } from './model'
import type { HistoryDescription } from './history'
import type { WorkbenchAction } from './Workbench'

/** Prefer the user's command to a graph diff when one action has several effects. */
export function describeWorkbenchAction(action: WorkbenchAction, before: StudioProject, after: StudioProject): HistoryDescription {
  const clipId = 'clipId' in action ? action.clipId : undefined
  const clip = after.clips.find(item => item.id === clipId) ?? before.clips.find(item => item.id === clipId)
  const trackId = 'trackId' in action ? action.trackId : clip?.trackId
  const track = after.tracks.find(item => item.id === trackId) ?? before.tracks.find(item => item.id === trackId)
  const panel = track && ['kick', 'snare', 'hat'].includes(track.soundId) ? 'drums' : 'arrangement'
  if (action.type === 'track-production') return { label: action.patch.expression !== undefined ? 'Draw expression' : action.patch.pan !== undefined ? 'Change pan' : action.patch.spaceBypass !== undefined ? 'Bypass Space' : 'Change Space', affectedIds: [action.trackId], context: { panel: 'mixer', trackId: action.trackId } }
  if (action.type === 'clip-independent') return { label: 'Make clip independent', affectedIds: [action.clipId], context: { panel, trackId, clipId: action.clipId } }
  if (action.type === 'clip-duplicate') return { label: action.linked ? 'Repeat linked clip' : 'Duplicate clip independently', affectedIds: after.clips.filter(item => !before.clips.some(old => old.id === item.id)).map(item => item.id), context: { panel: 'arrangement', trackId } }
  if (action.type === 'clips-duplicate') return { label: `Duplicate ${action.clipIds.length} clip(s) independently`, affectedIds: after.clips.filter(item => !before.clips.some(old => old.id === item.id)).map(item => item.id), context: { panel: 'arrangement' } }
  if (action.type === 'clip-place') return { label: 'Place linked part', affectedIds: after.clips.filter(item => !before.clips.some(old => old.id === item.id)).map(item => item.id), context: { panel: 'arrangement', trackId: after.patterns.find(item => item.id === action.patternId)?.trackId } }
  if (action.type === 'clip-paste' || action.type === 'clips-paste') return { label: 'Paste independent clip(s)', affectedIds: after.clips.filter(item => !before.clips.some(old => old.id === item.id)).map(item => item.id), context: { panel: 'arrangement', trackId } }
  if (action.type === 'clip-move' || action.type === 'clips-move') return { label: action.type === 'clip-move' ? 'Move clip' : `Move ${action.clipIds.length} clip(s)`, affectedIds: action.type === 'clip-move' ? [action.clipId] : action.clipIds, context: { panel: 'arrangement', trackId, clipId } }
  if (action.type === 'clip-delete' || action.type === 'clips-delete') return { label: action.type === 'clip-delete' ? 'Delete clip' : `Delete ${action.clipIds.length} clip(s)`, affectedIds: action.type === 'clip-delete' ? [action.clipId] : action.clipIds, context: { panel: 'arrangement', trackId, clipId } }
  return describeStudioEdit(before, after)
}

export function describeStudioEdit(before: StudioProject, after: StudioProject): HistoryDescription {
  if (before.name !== after.name) return { label: 'Rename project', affectedIds: [before.id] }
  if (before.bpm !== after.bpm) return { label: 'Change tempo', affectedIds: [before.id] }
  const track = after.tracks.find(item => JSON.stringify(item) !== JSON.stringify(before.tracks.find(old => old.id === item.id)))
  if (track) {
    const old = before.tracks.find(item => item.id === track.id)
    if (old && (old.pan !== track.pan || old.space !== track.space || old.spaceBypass !== track.spaceBypass || JSON.stringify(old.expression) !== JSON.stringify(track.expression))) return { label: old.pan !== track.pan ? 'Change pan' : old.space !== track.space ? 'Change Space' : old.spaceBypass !== track.spaceBypass ? 'Bypass Space' : 'Draw expression', affectedIds: [track.id], context: { panel: 'mixer', trackId: track.id } }
    const label = !old ? 'Add instrument' : old.name !== track.name ? 'Rename track' : old.color !== track.color ? 'Change track colour' : old.level !== track.level ? 'Change volume' : old.muted !== track.muted ? 'Change mute' : old.soundId !== track.soundId ? 'Change sound' : 'Change track visibility'
    return { label, affectedIds: [track.id], context: { panel: old && (old.level !== track.level || old.muted !== track.muted) ? 'mixer' : 'sounds', trackId: track.id } }
  }
  const removed = before.tracks.filter(item => !after.tracks.some(next => next.id === item.id))
  if (removed.length) return { label: 'Delete track', affectedIds: removed.map(item => item.id), context: { panel: 'sounds', trackId: removed[0].id } }
  if (JSON.stringify(before.clips) !== JSON.stringify(after.clips)) {
    const changed = after.clips.filter(clip => JSON.stringify(clip) !== JSON.stringify(before.clips.find(old => old.id === clip.id)))
    const lost = before.clips.filter(clip => !after.clips.some(item => item.id === clip.id))
    const sample = changed[0] ?? lost[0]
    const same = sample && before.clips.find(item => item.id === sample.id)
    if (sample && same && sample.patternId !== same.patternId && sample.startTick === same.startTick) return { label: 'Make clip independent', affectedIds: [sample.id], context: { panel: ['kick', 'snare', 'hat'].includes(after.tracks.find(item => item.id === sample.trackId)?.soundId ?? '') ? 'drums' : 'notes', trackId: sample.trackId, clipId: sample.id } }
    const action = lost.length ? 'Delete' : changed.some(clip => !before.clips.some(old => old.id === clip.id)) ? 'Add' : 'Move'
    return { label: `${action} ${changed.length || lost.length} clip(s)`, affectedIds: [...changed, ...lost].map(item => item.id), context: { panel: 'arrangement', trackId: sample?.trackId, clipId: sample?.id } }
  }
  const removedParts = before.patterns.filter(item => !after.patterns.some(next => next.id === item.id))
  if (removedParts.length) return { label: `Remove ${removedParts.length} unused part(s)`, affectedIds: removedParts.map(item => item.id), context: { panel: 'arrangement', trackId: removedParts[0].trackId } }
  const part = after.patterns.find(item => JSON.stringify(item) !== JSON.stringify(before.patterns.find(old => old.id === item.id)))
  if (part) {
    const old = before.patterns.find(item => item.id === part.id), clip = after.clips.find(item => item.patternId === part.id)
    const sound = after.tracks.find(item => item.id === part.trackId)?.soundId
    const drum = ['kick', 'snare', 'hat'].includes(sound ?? '')
    const changed = part.notes.filter(note => JSON.stringify(note) !== JSON.stringify(old?.notes.find(item => item.id === note.id)))
    const deleted = old?.notes.filter(note => !part.notes.some(item => item.id === note.id)) ?? []
    const label = old?.name !== part.name ? 'Rename part' : deleted.length ? `Delete ${deleted.length} note(s)` : changed.some(note => !old?.notes.some(item => item.id === note.id)) ? `Add ${changed.length} note(s)` : `Change ${changed.length} note(s)`
    const ids = [...changed, ...deleted].map(item => item.id)
    return { label, affectedIds: ids, context: { panel: drum ? 'drums' : 'notes', trackId: part.trackId, clipId: clip?.id, noteIds: ids } }
  }
  return { label: before.bars !== after.bars ? 'Change project length' : 'Edit Idea Pad', context: { panel: before.bars !== after.bars ? 'arrangement' : 'ideas' } }
}
