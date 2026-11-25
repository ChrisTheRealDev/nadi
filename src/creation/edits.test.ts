import { describe, expect, it } from 'vitest'
import { duplicateBarToEnd, repeatBarNext } from './edits'
import { createProject, MAX_BARS, MAX_NOTES, TICKS_PER_BAR, type Note } from './model'

describe('creation edits', () => {
  it('repeats directly into bar 2 without changing four-bar length, timing, originals or mix', () => {
    const p = createProject()
    p.notes = [{ id: 'n', instrument: 'piano', pitch: 60, startTick: 137, durationTicks: 2400, velocity: 87 }]
    const before = structuredClone(p)
    const next = repeatBarNext(p, 0, () => 'copy')
    expect(next.bars).toBe(4)
    expect(next.notes[1]).toEqual({ ...p.notes[0], id: 'copy', startTick: 2057 })
    expect(next.mix).toEqual(p.mix); expect(next.ideas).toEqual(p.ideas); expect(p).toEqual(before)
    next.notes[1].pitch = 72
    expect(next.notes[0].pitch).toBe(60)
  })
  it('refuses occupied or empty-source next-bar copies atomically', () => {
    const p = createProject()
    p.notes = [0, 1920].map((startTick, i) => ({ id: `n${i}`, instrument: 'piano', pitch: 60, startTick, durationTicks: 480, velocity: 90 }))
    const before = structuredClone(p)
    expect(() => repeatBarNext(p, 0)).toThrow(/already has notes/)
    expect(() => repeatBarNext(p, 2)).toThrow(/no new notes/)
    expect(() => repeatBarNext(p, 0.5)).toThrow()
    expect(p).toEqual(before)
  })
  it('allows a next-bar repeat inside a 256-bar project but rejects expansion beyond the limit', () => {
    const p = createProject(); p.bars = MAX_BARS
    p.notes = [{ id: 'n', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }]
    expect(repeatBarNext(p, 0).bars).toBe(MAX_BARS)
    p.notes[0].startTick = (MAX_BARS - 1) * TICKS_PER_BAR
    expect(() => repeatBarNext(p, MAX_BARS - 1)).toThrow(/256-bar/)
  })
  it('duplicates notes that start in a bar to the end with fresh IDs', () => {
    const project = createProject()
    project.notes = [
      { id: 'before', instrument: 'piano', pitch: 60, startTick: 10, durationTicks: 480, velocity: 80 },
      { id: 'source-piano', instrument: 'piano', pitch: 64, startTick: TICKS_PER_BAR + 240, durationTicks: 720, velocity: 91 },
      { id: 'source-kick', instrument: 'kick', pitch: 36, startTick: TICKS_PER_BAR * 2 - 1, durationTicks: 1, velocity: 110 },
      { id: 'after', instrument: 'snare', pitch: 38, startTick: TICKS_PER_BAR * 2, durationTicks: 120, velocity: 99 },
    ]
    const before = structuredClone(project)

    const result = duplicateBarToEnd(project, 1, (note) => `copy-${note.id}`)

    expect(project).toEqual(before)
    expect(result.bars).toBe(5)
    expect(result.notes.slice(4)).toEqual([
      { ...project.notes[1], id: 'copy-source-piano', startTick: TICKS_PER_BAR * 4 + 240 },
      { ...project.notes[2], id: 'copy-source-kick', startTick: TICKS_PER_BAR * 5 - 1 },
    ])
    expect(result.notes[1]).not.toBe(project.notes[1])
  })

  it('preserves a sustained note and expands enough bars for its tail', () => {
    const project = createProject()
    project.notes = [{
      id: 'long', instrument: 'piano', pitch: 60, startTick: TICKS_PER_BAR + 100,
      durationTicks: TICKS_PER_BAR * 3 - 100, velocity: 85,
    }]

    const result = duplicateBarToEnd(project, 1, () => 'long-copy')

    expect(result.notes[1]).toMatchObject({ startTick: TICKS_PER_BAR * 4 + 100, durationTicks: TICKS_PER_BAR * 3 - 100 })
    expect(result.bars).toBe(7)
  })

  it('throws atomically for invalid indices, duplicate IDs, and size limits', () => {
    const project = createProject()
    project.notes = [{ id: 'source', instrument: 'hat', pitch: 42, startTick: 0, durationTicks: 120, velocity: 70 }]
    const before = structuredClone(project)
    expect(() => duplicateBarToEnd(project, -1)).toThrow(RangeError)
    expect(() => duplicateBarToEnd(project, 0, () => 'source')).toThrow(/fresh, unique IDs/)
    expect(project).toEqual(before)

    const maxBars = createProject()
    maxBars.bars = MAX_BARS
    maxBars.notes = [{ id: 'last-limit', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }]
    expect(() => duplicateBarToEnd(maxBars, 0)).toThrow(/256-bar/)

    const maxNotes = createProject()
    maxNotes.notes = Array.from({ length: MAX_NOTES }, (_, index): Note => ({
      id: `n-${index}`,
      instrument: 'kick',
      pitch: 36,
      startTick: index === 0 ? 0 : TICKS_PER_BAR,
      durationTicks: 1,
      velocity: 80,
    }))
    expect(() => duplicateBarToEnd(maxNotes, 0)).toThrow(/10,000-note/)
    expect(maxNotes.notes).toHaveLength(MAX_NOTES)
  })
  it('refuses to duplicate an empty source without extending or changing the project', () => {
    const project = createProject(), before = structuredClone(project)
    expect(() => duplicateBarToEnd(project, 0)).toThrow(/no new notes/)
    expect(project).toEqual(before)
  })
})
