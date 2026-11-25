import { exactObject } from '../mira/contracts'
import type { MiraPassageNote } from './miraPassage'

export interface MiraExample { notes: MiraPassageNote[] }
export const MIRA_EXAMPLE_MAX_NOTES = 16
export const MIRA_EXAMPLE_MAX_TICKS = 3840
export const MIRA_EXAMPLE_ERROR = 'Example unavailable: it did not meet the two-bar, 16-note safety limits.'
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
/** Sound and tempo deliberately come from the approved passage, not generated fields. */
export function validateMiraExample(value: unknown): value is MiraExample {
  return exactObject(value, ['notes']) && Array.isArray(value.notes) && value.notes.length >= 1 && value.notes.length <= MIRA_EXAMPLE_MAX_NOTES
    && value.notes.every(note => exactObject(note, ['pitch', 'startTick', 'durationTicks', 'velocity'])
      && integer(note.pitch, 0, 127) && integer(note.startTick, 0, MIRA_EXAMPLE_MAX_TICKS - 1)
      && integer(note.durationTicks, 1, MIRA_EXAMPLE_MAX_TICKS) && Number(note.startTick) + Number(note.durationTicks) <= MIRA_EXAMPLE_MAX_TICKS
      && integer(note.velocity, 1, 127))
}
