import { describe, expect, it } from 'vitest'
import {
  addCapturedNote,
  chordMatches,
  isAMinor,
  pitchClass,
  sortedChordNames,
  uniquePitchClasses,
} from './chord'

describe('chord logic', () => {
  it('normalises pitch classes across octaves', () => {
    expect(pitchClass(-3)).toBe(9)
    expect(uniquePitchClasses([57, 60, 64, 69, 72])).toEqual([0, 4, 9])
    expect(isAMinor([45, 60, 76])).toBe(true)
  })

  it('allows doubled chord tones but rejects an extra pitch class', () => {
    expect(chordMatches([57, 60, 64, 69], [57, 60, 64])).toBe(true)
    expect(isAMinor([57, 60, 64, 65])).toBe(false)
    expect(isAMinor([57, 61, 64])).toBe(false)
  })

  it('supports step capture without duplicating a pitch class', () => {
    let notes: number[] = []
    notes = addCapturedNote(notes, 57)
    notes = addCapturedNote(notes, 60)
    notes = addCapturedNote(notes, 64)
    notes = addCapturedNote(notes, 69)
    expect(notes).toEqual([69, 60, 64])
    expect(sortedChordNames(notes)).toEqual(['C', 'E', 'A'])
  })
})
