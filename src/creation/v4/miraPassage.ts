import { exactObject } from '../mira/contracts'
import { MAX_BARS, TICKS_PER_BAR, isSoundId, type SoundId, type StudioProject } from './model'

export const MIRA_PASSAGE_MAX_NOTES = 64
export const MIRA_PASSAGE_MAX_TICKS = 4 * TICKS_PER_BAR
export interface MiraPassageNote { pitch: number; startTick: number; durationTicks: number; velocity: number }
/** All timing is exact and relative to the source part, never quantized. */
export interface MiraPassage {
  source: 'selected' | 'shown'; soundId: SoundId; bpm: number; timingUnit: 'ticks'; ticksPerBeat: 480; ticksPerBar: 1920
  rangeStartTick: number; rangeEndTick: number; notes: MiraPassageNote[]
}
/** Local approval context. Never serialize this object into the provider request. */
export interface MiraPassageSnapshot {
  projectId: string; revision: number; trackId: string; clipId: string; patternId: string
  trackName: string; partName: string; noteIds: string[]; passage: MiraPassage
}
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
export function validateMiraPassage(value: unknown): value is MiraPassage {
  if (!exactObject(value, ['source', 'soundId', 'bpm', 'timingUnit', 'ticksPerBeat', 'ticksPerBar', 'rangeStartTick', 'rangeEndTick', 'notes'])
    || !['selected', 'shown'].includes(String(value.source)) || !isSoundId(value.soundId) || typeof value.bpm !== 'number' || !Number.isFinite(value.bpm) || value.bpm < 30 || value.bpm > 300
    || value.timingUnit !== 'ticks' || value.ticksPerBeat !== 480 || value.ticksPerBar !== 1920
    || !integer(value.rangeStartTick, 0, MAX_BARS * TICKS_PER_BAR - 1) || !integer(value.rangeEndTick, value.rangeStartTick + 1, MAX_BARS * TICKS_PER_BAR)
    || value.rangeEndTick - value.rangeStartTick > MIRA_PASSAGE_MAX_TICKS || !Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > MIRA_PASSAGE_MAX_NOTES) return false
  return value.notes.every(note => exactObject(note, ['pitch', 'startTick', 'durationTicks', 'velocity'])
    && integer(note.pitch, 0, 127) && integer(note.startTick, 0, Number(value.rangeEndTick) - 1)
    && integer(note.durationTicks, 1, MAX_BARS * TICKS_PER_BAR) && Number(note.startTick) + Number(note.durationTicks) <= MAX_BARS * TICKS_PER_BAR
    && Number(note.startTick) + Number(note.durationTicks) > Number(value.rangeStartTick)
    && (value.source !== 'selected' || Number(note.startTick) >= Number(value.rangeStartTick))
    && integer(note.velocity, 1, 127))
}

export function buildMiraPassage({ project, trackId, clipId, selectedNoteIds = [], shownRange }: {
  project: StudioProject; trackId?: string | null; clipId?: string | null; selectedNoteIds?: readonly string[]
  shownRange?: { startTick: number; endTick: number }
}): { ok: true; snapshot: MiraPassageSnapshot } | { ok: false; error: string } {
  const track = project.tracks.find(item => item.id === trackId)
  const clip = project.clips.find(item => item.id === clipId && item.trackId === trackId)
  const pattern = project.patterns.find(item => item.id === clip?.patternId && item.trackId === trackId)
  if (!track || !clip || !pattern) return { ok: false, error: 'Choose one part before attaching a passage.' }
  const selected = new Set(selectedNoteIds)
  if (!selected.size && !shownRange) return { ok: false, error: 'Select at least one note, or choose Use shown bars instead.' }
  if (selected.size !== selectedNoteIds.length || [...selected].some(id => !pattern.notes.some(note => note.id === id))) return { ok: false, error: 'The note selection changed. Select the notes again.' }
  const source = selected.size ? 'selected' : 'shown'
  if (source === 'shown' && (!shownRange || !integer(shownRange.startTick, 0, pattern.lengthTicks - 1) || !integer(shownRange.endTick, shownRange.startTick + 1, pattern.lengthTicks))) return { ok: false, error: 'Choose a valid shown range in this part.' }
  const notes = pattern.notes.filter(note => source === 'selected' ? selected.has(note.id) : note.startTick < shownRange!.endTick && note.startTick + note.durationTicks > shownRange!.startTick)
  if (!notes.length) return { ok: false, error: 'There are no notes in this passage yet.' }
  if (notes.length > MIRA_PASSAGE_MAX_NOTES) return { ok: false, error: 'Choose at most 64 notes. Nothing was attached.' }
  const rangeStartTick = source === 'selected' ? Math.floor(Math.min(...notes.map(note => note.startTick)) / TICKS_PER_BAR) * TICKS_PER_BAR : shownRange!.startTick
  const rangeEndTick = source === 'selected' ? (Math.floor(Math.max(...notes.map(note => note.startTick)) / TICKS_PER_BAR) + 1) * TICKS_PER_BAR : shownRange!.endTick
  if (rangeEndTick - rangeStartTick > MIRA_PASSAGE_MAX_TICKS) return { ok: false, error: 'Choose a passage spanning at most four bars. Nothing was attached.' }
  const passage: MiraPassage = { source, soundId: track.soundId, bpm: project.bpm, timingUnit: 'ticks', ticksPerBeat: 480, ticksPerBar: 1920, rangeStartTick, rangeEndTick,
    notes: notes.map(({ pitch, startTick, durationTicks, velocity }) => ({ pitch, startTick, durationTicks, velocity })) }
  if (!validateMiraPassage(passage)) return { ok: false, error: 'This passage is invalid. Nothing was attached.' }
  return { ok: true, snapshot: { projectId: project.id, revision: project.revision, trackId: track.id, clipId: clip.id, patternId: pattern.id, trackName: track.name, partName: pattern.name, noteIds: notes.map(note => note.id), passage } }
}
