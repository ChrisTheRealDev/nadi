/** Notation describes the same absolute 480 PPQ musical timeline as the studio. */
export interface MeasureNotation { beats: number; beatType: 2 | 4 | 8 | 16; keyFifths: number; newSystem: boolean; newPage: boolean }
export interface NoteNotation { voice: number; staff: 0 | 1 | 2; dynamic: 'none' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'; articulation: 'none' | 'staccato' | 'tenuto' | 'accent'; slur: 'none' | 'start' | 'stop'; tuplet: 1 | 3 | 5 }
export interface TrackNotation { clef: 'auto' | 'treble' | 'bass' | 'alto' | 'tenor'; staffSplit: number; performerMode: 'default' | 'solo' | 'ensemble' | 'electronic' }
export interface ScoreRest { id: string; trackId: string; startTick: number; durationTicks: number; voice: number }
export interface NotationState { measures: MeasureNotation[]; notes: Record<string, NoteNotation>; tracks: Record<string, TrackNotation>; rests: ScoreRest[] }
export interface NotatedProject { bars: number; notation?: NotationState }
export const DEFAULT_MEASURE: MeasureNotation = { beats: 4, beatType: 4, keyFifths: 0, newSystem: false, newPage: false }
export const DEFAULT_NOTE: NoteNotation = { voice: 1, staff: 0, dynamic: 'none', articulation: 'none', slur: 'none', tuplet: 1 }
export const DEFAULT_TRACK: TrackNotation = { clef: 'auto', staffSplit: 60, performerMode: 'default' }
export function defaultNotation(): NotationState { return { measures: [], notes: {}, tracks: {}, rests: [] } }
export function scoreMeasure(project: NotatedProject, index: number): MeasureNotation {
  const measures = project.notation?.measures ?? []
  if (measures[index]) return measures[index]
  // Meter/key continue; print breaks apply only to their explicitly marked measure.
  return { ...(measures.at(-1) ?? DEFAULT_MEASURE), newSystem: false, newPage: false }
}
export function scoreMeasureTicks(project: NotatedProject, index: number): number { const m = scoreMeasure(project, index); return m.beats * 1920 / m.beatType }
export function scoreMeasureStartTick(project: NotatedProject, index: number): number { let tick = 0; for (let i = 0; i < index; i++) tick += scoreMeasureTicks(project, i); return tick }
export function scoreMeterAtTick(project: NotatedProject, tick: number) {
  let index = 0, startTick = 0, endTick = scoreMeasureTicks(project, 0)
  while (tick >= endTick && index < 8192) { startTick = endTick; index++; endTick += scoreMeasureTicks(project, index) }
  return { ...scoreMeasure(project, index), index, startTick, endTick }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k)) && allowed.every(k => Object.hasOwn(v, k))
export function validateNotationState(value: unknown, project: { bars: number; tracks: { id: string }[]; patterns: { notes: { id: string }[] }[] }): value is NotationState {
  if (!object(value) || !keys(value, ['measures', 'notes', 'tracks', 'rests']) || !Array.isArray(value.measures) || value.measures.length > 8192 || !object(value.notes) || !object(value.tracks) || !Array.isArray(value.rests) || value.rests.length > 20000) return false
  for (const m of value.measures) if (!object(m) || !keys(m, ['beats', 'beatType', 'keyFifths', 'newSystem', 'newPage']) || !int(m.beats, 1, 16) || ![2, 4, 8, 16].includes(m.beatType as number) || !int(m.keyFifths, -7, 7) || typeof m.newSystem !== 'boolean' || typeof m.newPage !== 'boolean') return false
  const noteIds = new Set(project.patterns.flatMap(p => p.notes.map(n => n.id))), trackIds = new Set(project.tracks.map(t => t.id))
  // Stale metadata is rejected rather than allowed to grow without bounds.
  for (const [id, n] of Object.entries(value.notes)) if (!noteIds.has(id) || !object(n) || !keys(n, ['voice', 'staff', 'dynamic', 'articulation', 'slur', 'tuplet']) || !int(n.voice, 1, 8) || ![0, 1, 2].includes(n.staff as number) || !['none', 'pp', 'p', 'mp', 'mf', 'f', 'ff'].includes(n.dynamic as string) || !['none', 'staccato', 'tenuto', 'accent'].includes(n.articulation as string) || !['none', 'start', 'stop'].includes(n.slur as string) || ![1, 3, 5].includes(n.tuplet as number)) return false
  for (const [id, t] of Object.entries(value.tracks)) if (!trackIds.has(id) || !object(t) || !keys(t, ['clef', 'staffSplit', 'performerMode']) || !['auto', 'treble', 'bass', 'alto', 'tenor'].includes(t.clef as string) || !int(t.staffSplit, 0, 127) || !['default', 'solo', 'ensemble', 'electronic'].includes(t.performerMode as string)) return false
  const restIds = new Set<string>()
  for (const r of value.rests) {
    if (!object(r) || !keys(r, ['id', 'trackId', 'startTick', 'durationTicks', 'voice']) || typeof r.id !== 'string' || !r.id || r.id.length > 120 || restIds.has(r.id) || !trackIds.has(r.trackId as string) || !int(r.startTick, 0, project.bars * 1920 - 1) || !int(r.durationTicks, 1, project.bars * 1920) || (r.startTick as number) + (r.durationTicks as number) > project.bars * 1920 || !int(r.voice, 1, 8)) return false
    restIds.add(r.id)
  }
  return true
}
