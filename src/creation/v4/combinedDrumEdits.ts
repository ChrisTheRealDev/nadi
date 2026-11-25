import type { Note } from '../model'
import { isMelodicSound, TICKS_PER_BAR, type Clip, type StudioProject } from './model'
import { updatePatternNotes } from './operations'

export function drumClipsInRange(project: StudioProject, trackId: string, startBar: number, visibleBars: number): Clip[] {
  const start = startBar * TICKS_PER_BAR, end = start + visibleBars * TICKS_PER_BAR
  return project.clips.filter(clip => {
    const pattern = project.patterns.find(item => item.id === clip.patternId)
    return clip.trackId === trackId && pattern && clip.startTick < end && clip.startTick + pattern.lengthTicks > start
  })
}

export function projectDrumClip(project: StudioProject, clipId: string): Note[] {
  const clip = project.clips.find(item => item.id === clipId), track = project.tracks.find(item => item.id === clip?.trackId)
  const pattern = project.patterns.find(item => item.id === clip?.patternId)
  if (!clip || !track || !pattern || isMelodicSound(track.soundId)) throw new Error('Choose a placed percussion part.')
  return pattern.notes.map(note => ({ ...note, instrument: track.soundId as 'kick' | 'snare' | 'hat', startTick: note.startTick + clip.startTick }))
}

/** A full projection is inverted exactly; notes outside the shown bars stay in it. */
export function applyDrumClip(project: StudioProject, clipId: string, notes: Note[]): StudioProject {
  const clip = project.clips.find(item => item.id === clipId), track = project.tracks.find(item => item.id === clip?.trackId)
  const pattern = project.patterns.find(item => item.id === clip?.patternId)
  if (!clip || !track || !pattern || isMelodicSound(track.soundId)) throw new Error('The chosen drum part is no longer available.')
  if (notes.some(note => note.instrument !== track.soundId || note.startTick < clip.startTick || note.startTick >= clip.startTick + pattern.lengthTicks)) throw new RangeError('That step is outside this part. Select or create a part covering that song position; no hits were changed.')
  return updatePatternNotes(project, pattern.id, notes.map(({ id, pitch, startTick, durationTicks, velocity }) => ({ id, pitch, startTick: startTick - clip.startTick, durationTicks, velocity })), pattern.lengthTicks)
}
