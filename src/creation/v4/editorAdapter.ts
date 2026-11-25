import { createDefaultMix, type CreationProject, type Note } from '../model'
import { assertStudioProject, editorInstrument, type StudioProject, type PatternNote } from './model'
import { updatePatternNotes } from './operations'

export function applyEditorProjection(project: StudioProject, patternId: string | undefined, before: CreationProject, after: CreationProject): StudioProject {
  if (before.revision !== project.revision || after.revision !== project.revision) throw new Error('The project changed during that edit. Please try again.')
  let result = { ...project, name: after.name, bpm: after.bpm }
  const notesChanged = JSON.stringify(before.notes) !== JSON.stringify(after.notes)
  const lengthChanged = before.bars !== after.bars
  if (patternId && (notesChanged || lengthChanged)) result = updatePatternNotes(result, patternId, patternNotes(after.notes), lengthChanged ? after.bars * 1920 : undefined)
  // Metadata-only edits must cross the same graph boundary as note edits.
  assertStudioProject(result)
  return result
}

/** Render-only compatibility boundary. Never save or export this projection. */
export function editorProjection(project: StudioProject, trackId?: string, patternId?: string): CreationProject {
  const track = project.tracks.find(item => item.id === trackId)
  const pattern = project.patterns.find(item => item.id === patternId && item.trackId === trackId)
  const instrument = track ? editorInstrument(track.soundId) : 'piano'
  const notes: Note[] = (pattern?.notes ?? []).map(note => ({ ...note, instrument }))
  const bars = pattern ? Math.max(1, Math.ceil(Math.max(pattern.lengthTicks, ...notes.map(note => note.startTick + note.durationTicks)) / 1920)) : project.bars
  const mix = createDefaultMix()
  if (track) mix[instrument] = { level: track.level, muted: track.muted }
  return { format: 'nadi-creation', version: 3, id: project.id, revision: project.revision, name: project.name, bpm: project.bpm, bars, notes, mix, ideas: project.ideas, guidance: project.guidance }
}

export function patternNotes(notes: Note[]): PatternNote[] {
  return notes.map(({ id, pitch, startTick, durationTicks, velocity }) => ({ id, pitch, startTick, durationTicks, velocity }))
}

export function preserveOriginals(before: StudioProject, after: StudioProject): boolean {
  return before.ideas.every(previous => {
    const next = after.ideas.find(idea => idea.id === previous.id)
    return next !== undefined && next.createdAt === previous.createdAt && JSON.stringify(next.original) === JSON.stringify(previous.original)
  })
}

export function restoreGraphHistory(snapshot: StudioProject, current: StudioProject): StudioProject {
  if (snapshot.id !== current.id) throw new TypeError('History belongs to a different project.')
  const next = structuredClone(snapshot)
  const known = new Set(next.ideas.map(idea => idea.id))
  next.ideas.push(...structuredClone(current.ideas.filter(idea => !known.has(idea.id))))
  next.revision = current.revision + 1
  next.guidance = structuredClone(current.guidance)
  next.bars = Math.max(next.bars, ...next.ideas.map(idea => Math.ceil((idea.attachedTick ?? 0) / 1920)))
  if (!preserveOriginals(current, next)) throw new TypeError('History cannot rewrite an original capture.')
  assertStudioProject(next)
  return next
}
