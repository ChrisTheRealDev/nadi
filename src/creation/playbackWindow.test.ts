import { describe, expect, it } from 'vitest'
import { notesInPlaybackWindow } from './playbackWindow'
import type { Note } from './model'
const n = (id: string, startTick: number, durationTicks = 480): Note => ({ id, startTick, durationTicks, pitch: 60, instrument: 'piano', velocity: 90 })
describe('live playback windows', () => {
  it('has half-open boundaries, no duplicate attacks and no mutation', () => {
    const notes = [n('a', 0), n('b', 120), n('c', 240)]
    expect(notesInPlaybackWindow(notes, 0, 120).map(x => x.note.id)).toEqual(['a'])
    expect(notesInPlaybackWindow(notes, 120, 240).map(x => x.note.id)).toEqual(['b'])
    expect(notesInPlaybackWindow(notes, 240, 241).map(x => x.note.id)).toEqual(['c'])
    expect(notesInPlaybackWindow(notes, 120, 120)).toEqual([])
  })
  it('repeats only starts in the selected bar, retaining long tails and exact offsets', () => {
    const notes = [n('outside', 0), n('start', 1920, 4000), n('offgrid', 2057), n('next', 3840)]
    const before = structuredClone(notes)
    expect(notesInPlaybackWindow(notes, 0, 1920, 1).map(x => [x.note.id, x.tick])).toEqual([['start', 0], ['offgrid', 137]])
    expect(notesInPlaybackWindow(notes, 1920, 2100, 1).map(x => [x.note.id, x.tick])).toEqual([['start', 1920], ['offgrid', 2057]])
    expect(notesInPlaybackWindow(notes, 0, 1, 1)[0].note.durationTicks).toBe(4000)
    expect(notes).toEqual(before)
  })
  it('loops arbitrary half-open ranges and chases only the initial overlapping tails', () => {
    const notes = [
      n('expired', 0, 100),
      n('chased', 50, 100),
      n('start', 100, 900),
      n('last', 499, 700),
      n('end', 500, 200),
    ]
    const range = { startTick: 100, endTick: 500 }
    expect(notesInPlaybackWindow(notes, 0, 400, range).map(x => [x.note.id, x.tick, x.durationTicks])).toEqual([
      ['chased', 0, 50],
      ['start', 0, undefined],
      ['last', 399, undefined],
    ])
    expect(notesInPlaybackWindow(notes, 400, 800, range).map(x => [x.note.id, x.tick, x.durationTicks])).toEqual([
      ['start', 400, undefined],
      ['last', 799, undefined],
    ])
    expect(notesInPlaybackWindow(notes, 399, 400, range).map(x => x.note.id)).toEqual(['last'])
    expect(notesInPlaybackWindow(notes, 400, 401, range).map(x => x.note.id)).toEqual(['start'])
    expect(notesInPlaybackWindow(notes, 0, 800, range).filter(x => x.note.id === 'chased')).toHaveLength(1)
  })

  it('fails closed for malformed direct scheduler ranges', () => {
    const notes = [n('a', 0)]
    expect(notesInPlaybackWindow(notes, 0, 100, { startTick: -1, endTick: 100 })).toEqual([])
    expect(notesInPlaybackWindow(notes, 0, 100, { startTick: 100, endTick: 100 })).toEqual([])
    expect(notesInPlaybackWindow(notes, 0, 100, { startTick: 0.5, endTick: 100 })).toEqual([])
  })
})
