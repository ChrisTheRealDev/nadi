import { TICKS_PER_BAR, type StudioProject } from './model'
import type { NotesPanelView } from './notesPanelState'

export type LoopOwner = { panel: 'notes'; clipId: string } | { panel: 'drums' }
export interface EditingViews { notes: Record<string, NotesPanelView>; drums: { bar: number; visible: 1 | 2 | 4 } }
export const emptyEditingViews = (): EditingViews => ({ notes: {}, drums: { bar: 0, visible: 4 } })
export function noteViewKey(project: StudioProject, clipId?: string) {
  return `${project.id}:${project.clips.find(clip => clip.id === clipId)?.patternId ?? 'none'}`
}
export function noteView(project: StudioProject, clipId: string | undefined, views: EditingViews): NotesPanelView {
  const clip = project.clips.find(item => item.id === clipId), part = project.patterns.find(item => item.id === clip?.patternId)
  const value = views.notes[noteViewKey(project, clipId)] ?? { bar: 0, visible: 4, primary: null, cursor: 0 }
  const length = part?.lengthTicks ?? TICKS_PER_BAR
  return { ...value, bar: Math.max(0, Math.min(value.bar, Math.ceil(length / TICKS_PER_BAR) - 1)), cursor: Math.max(0, Math.min(value.cursor, length - 1)) }
}
export function patchNoteView(project: StudioProject, clipId: string | undefined, views: EditingViews, patch: Partial<NotesPanelView>): EditingViews {
  return { ...views, notes: { ...views.notes, [noteViewKey(project, clipId)]: { ...noteView(project, clipId, views), ...patch } } }
}
export interface PlaybackIntent { mode: 'song' | 'part'; cursor: number; clipId?: string; range?: { startTick: number; endTick: number }; loop?: LoopOwner; resume?: number }
export interface PlaybackResolution { startTick: number; endTick: number; returnTick: number; loopRange?: { startTick: number; endTick: number }; clipIds?: string[]; label: string }
/** The only part-local to song-time conversion used by transport. Loop wins over other modes. */
export function resolvePlayback(project: StudioProject, views: EditingViews, intent: PlaybackIntent): PlaybackResolution {
  const end = project.bars * TICKS_PER_BAR
  let startTick: number, endTick = end, clipIds: string[] | undefined
  let label = 'Song'
  if (intent.loop?.panel === 'drums') {
    const bar = Math.max(0, Math.min(views.drums.bar, project.bars - 1))
    startTick = bar * TICKS_PER_BAR; endTick = Math.min(end, (bar + views.drums.visible) * TICKS_PER_BAR); label = 'Loop: Drums'
  } else if (intent.loop?.panel === 'notes' || intent.mode === 'part') {
    const clipId = intent.loop?.panel === 'notes' ? intent.loop.clipId : intent.clipId
    const clip = project.clips.find(item => item.id === clipId), part = project.patterns.find(item => item.id === clip?.patternId)
    if (!clip || !part) throw new Error('Choose a placed part before listening to it.')
    startTick = clip.startTick; endTick = Math.min(end, clip.startTick + part.lengthTicks)
    if (intent.loop) {
      const view = noteView(project, clip.id, views), bar = Math.floor(view.bar / view.visible) * view.visible
      startTick += bar * TICKS_PER_BAR; endTick = Math.min(endTick, startTick + view.visible * TICKS_PER_BAR); label = 'Loop: Notes'
    } else { clipIds = [clip.id]; label = 'Selected part' }
  } else if (intent.range) {
    startTick = intent.range.startTick; endTick = intent.range.endTick; label = 'Song range'
  } else startTick = Math.min(Math.max(0, Math.round(intent.cursor)), end - 1)
  if (![startTick, endTick].every(Number.isSafeInteger) || startTick < 0 || endTick > end || startTick >= endTick) throw new Error('Choose a valid listening range.')
  const returnTick = startTick, loopRange = intent.loop ? { startTick, endTick } : undefined
  if (intent.resume !== undefined && intent.resume >= startTick && intent.resume < endTick) startTick = Math.round(intent.resume)
  return { startTick, endTick, returnTick, loopRange, clipIds, label: `${label} · song bars ${Math.floor(returnTick / TICKS_PER_BAR) + 1}–${Math.ceil(endTick / TICKS_PER_BAR)}` }
}
