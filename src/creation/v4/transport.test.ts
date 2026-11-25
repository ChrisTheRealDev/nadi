import { describe, expect, it } from 'vitest'
import { createStudioProject, compileArrangement } from './model'
import { addTrack } from './operations'
import { audibleArrangement, audibleTracks, notesForRange, resolveStudioRange } from './transport'

describe('studio transport ranges', () => {
  it('chases already held notes, excludes finished/future notes, and never cuts tails', () => {
    const p = createStudioProject()
    p.patterns[0].notes = [
      { id: 'held', pitch: 60, startTick: 0, durationTicks: 1000, velocity: 90 },
      { id: 'finished', pitch: 60, startTick: 0, durationTicks: 400, velocity: 90 },
      { id: 'long', pitch: 60, startTick: 600, durationTicks: 1500, velocity: 90 },
      { id: 'future', pitch: 60, startTick: 800, durationTicks: 100, velocity: 90 },
    ]
    const notes = notesForRange(compileArrangement(p), 400, 800)
    expect(notes.map(note => [note.sourceNoteId, note.startTick, note.durationTicks])).toEqual([['held', 0, 600], ['long', 200, 1500]])
    expect(p.patterns[0].notes[0].durationTicks).toBe(1000)
  })
  it('solo, mute and zero gain determine audibility; hiding does not', () => {
    const p = addTrack(createStudioProject(), 'synth-bass')
    p.tracks[0].hidden = true
    expect(audibleTracks(p.tracks)).toHaveLength(2)
    expect(audibleTracks(p.tracks, new Set([p.tracks[0].id])).map(track => track.id)).toEqual([p.tracks[0].id])
    p.tracks[0].muted = true; p.tracks[1].level = 0
    expect(audibleTracks(p.tracks)).toEqual([]); expect(audibleArrangement(p)).toEqual([])
  })
  it('rejects invalid range before starting audio', () => {
    const p = createStudioProject()
    for (const options of [{ startTick: -1 }, { endTick: 0 }, { endTick: Infinity }, { startTick: .5 }, { endTick: 10000000 }]) expect(() => resolveStudioRange(p, options)).toThrow()
    expect(resolveStudioRange(p, { startTick: 73, endTick: 799 })).toEqual({ startTick: 73, endTick: 799 })
  })
})
