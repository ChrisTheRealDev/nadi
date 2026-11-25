import type { Note } from './model'

export const MIDI_PITCH_COUNT = 128
export const PIANO_ROLL_ROW_HEIGHT = 22
export const PLACEMENT_STEP_TICKS = 120
export type PianoRollSnap = 480 | 240 | 120 | null

export function clampInteger(value: number, minimum: number, maximum: number): number {
  const safeValue = Number.isFinite(value) ? Math.round(value) : minimum
  return Math.min(maximum, Math.max(minimum, safeValue))
}

export function placementTick(pointerRatio: number, ticksPerBar: number): number {
  const rawTick = Math.floor(Math.min(.999999, Math.max(0, pointerRatio)) * ticksPerBar)
  return Math.min(ticksPerBar - PLACEMENT_STEP_TICKS, Math.floor(rawTick / PLACEMENT_STEP_TICKS) * PLACEMENT_STEP_TICKS)
}

/** Quantizes a newly-authored position. Existing notes should use snapDelta instead. */
export function snapTick(tick: number, snap: PianoRollSnap, mode: 'nearest' | 'floor' = 'nearest'): number {
  if (!Number.isFinite(tick)) return 0
  if (snap === null) return Math.round(tick)
  const scaled = tick / snap
  return (mode === 'floor' ? Math.floor(scaled) : Math.round(scaled)) * snap
}

/** Quantizes displacement, never the original tick, so recorded offsets survive a move. */
export function snapDelta(delta: number, snap: PianoRollSnap): number {
  if (!Number.isFinite(delta)) return 0
  return snap === null ? Math.round(delta) : Math.round(delta / snap) * snap
}

export function pitchFromPointer(pointerY: number, surfaceTop: number): number {
  return clampInteger(MIDI_PITCH_COUNT - 1 - Math.floor((pointerY - surfaceTop) / PIANO_ROLL_ROW_HEIGHT), 0, MIDI_PITCH_COUNT - 1)
}

export function tickFromPointer(pointerX: number, gridLeft: number, gridWidth: number, startTick: number, durationTicks: number): number {
  const ratio = gridWidth > 0 ? (pointerX - gridLeft) / gridWidth : 0
  return Math.round(startTick + Math.min(1, Math.max(0, ratio)) * durationTicks)
}

export function moveNote(note: Note, pitchDelta: number, tickDelta: number, projectTicks: number): Note {
  return {
    ...note,
    pitch: clampInteger(note.pitch + pitchDelta, 0, MIDI_PITCH_COUNT - 1),
    startTick: clampInteger(note.startTick + tickDelta, 0, Math.max(0, projectTicks - note.durationTicks)),
  }
}

export function rowTop(pitch: number): number {
  return (MIDI_PITCH_COUNT - 1 - clampInteger(pitch, 0, MIDI_PITCH_COUNT - 1)) * PIANO_ROLL_ROW_HEIGHT
}
