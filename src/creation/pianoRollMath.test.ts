import { describe, expect, it } from 'vitest'
import type { Note } from './model'
import { MIDI_PITCH_COUNT, PIANO_ROLL_ROW_HEIGHT, moveNote, pitchFromPointer, placementTick, rowTop, snapDelta, snapTick, tickFromPointer } from './pianoRollMath'

const note: Note = { id: 'one', instrument: 'piano', pitch: 60, startTick: 481, durationTicks: 2400, velocity: 90 }

describe('piano roll editing geometry', () => {
  it('snaps only pointer placement to sixteenth-note ticks', () => {
    expect(placementTick(0, 1920)).toBe(0)
    expect(placementTick(.26, 1920)).toBe(480)
    expect(placementTick(1, 1920)).toBe(1800)
  })

  it('moves exact recorded timing without quantizing or truncating duration', () => {
    expect(moveNote(note, 0, 1, 7680)).toMatchObject({ startTick: 482, durationTicks: 2400 })
    expect(moveNote(note, 0, 6000, 7680)).toMatchObject({ startTick: 5280, durationTicks: 2400 })
  })

  it('keeps keyboard moves inside MIDI and project boundaries', () => {
    expect(moveNote(note, -200, -900, 7680)).toMatchObject({ pitch: 0, startTick: 0 })
    expect(moveNote(note, 200, 99999, 7680)).toMatchObject({ pitch: 127, startTick: 5280 })
    expect(MIDI_PITCH_COUNT).toBe(128)
    expect(rowTop(127)).toBe(0)
    expect(rowTop(0)).toBe(127 * PIANO_ROLL_ROW_HEIGHT)
  })

  it('snaps deltas without quantizing an off-grid note origin', () => {
    expect(snapDelta(181, 120)).toBe(240)
    expect(note.startTick + snapDelta(181, 120)).toBe(721)
    expect(snapDelta(181, null)).toBe(181)
    expect(snapTick(481, 120, 'floor')).toBe(480)
  })

  it('maps the four-bar pointer surface to absolute ticks and all MIDI rows', () => {
    expect(tickFromPointer(552, 52, 1000, 3840, 7680)).toBe(7680)
    expect(tickFromPointer(-10, 52, 1000, 3840, 7680)).toBe(3840)
    expect(pitchFromPointer(0, 0)).toBe(127)
    expect(pitchFromPointer(127 * PIANO_ROLL_ROW_HEIGHT + 1, 0)).toBe(0)
  })
})
