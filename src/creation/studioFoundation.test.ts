import { describe, expect, it } from 'vitest'
import { createProject } from './model'
import { createMidiIdea, createTextIdea, validateIdeaOriginal } from './ideas'
import { appendStudioOriginal, finishStudioOriginal, restoreStudioHistory, type StudioOriginalBuffer } from './studioFoundation'

describe('studio original performance preservation', () => {
  it('excludes count-in and retains raw release, sustain, bend and velocity independently of edited notes', () => {
    const buffer: StudioOriginalBuffer = { startedAtMs: 1000, events: [] }
    expect(appendStudioOriginal(buffer, { type: 'note-on', pitch: 60, velocity: 31, channel: 2, source: 'midi' }, 999)).toBe('before-start')
    appendStudioOriginal(buffer, { type: 'note-on', pitch: 60, velocity: 73, channel: 2, source: 'midi' }, 1137)
    appendStudioOriginal(buffer, { type: 'controller', controller: 64, value: 127, channel: 2, source: 'midi' }, 1200)
    appendStudioOriginal(buffer, { type: 'pitch-bend', value: 9500, channel: 2, source: 'midi' }, 1250)
    appendStudioOriginal(buffer, { type: 'note-off', pitch: 60, velocity: 17, channel: 2, source: 'midi' }, 1300)
    const original = finishStudioOriginal(buffer, 1700)
    expect(original.events.map(event => event.atMs)).toEqual([137, 200, 250, 300])
    expect(original.events[3]).toMatchObject({ type: 'note-off', velocity: 17 })
    expect(original.durationMs).toBe(700)
    expect(validateIdeaOriginal(original)).toBe(true)
    buffer.events[0].atMs = 0
    expect(original.events[0].atMs).toBe(137)
  })

  it('retains screen provenance and stops at the declared capture boundary', () => {
    const buffer: StudioOriginalBuffer = { startedAtMs: 500, events: [] }
    appendStudioOriginal(buffer, { type: 'note-on', pitch: 57, velocity: 90, channel: 0, source: 'screen' }, 700)
    appendStudioOriginal(buffer, { type: 'note-off', pitch: 57, velocity: 0, channel: 0, source: 'screen' }, 699)
    expect(buffer.events[1].atMs).toBe(199)
    expect(appendStudioOriginal(buffer, { type: 'pitch-bend', value: 8192, channel: 0, source: 'midi' }, 60501)).toBe('limit')
    const original = finishStudioOriginal(buffer, 70000)
    expect(original.durationMs).toBe(60000)
    expect(original.events).toHaveLength(2)
    expect(validateIdeaOriginal(original)).toBe(true)
  })

  it('retains late timestamps and includes the latest event when finalizing both capture routes', () => {
    const buffer: StudioOriginalBuffer = { startedAtMs: 100, events: [] }
    appendStudioOriginal(buffer, { type: 'note-off', pitch: 60, velocity: 0, channel: 0, source: 'midi' }, 301.25)
    appendStudioOriginal(buffer, { type: 'note-on', pitch: 60, velocity: 80, channel: 0, source: 'midi' }, 201.5)
    const original = finishStudioOriginal(buffer, 300)
    expect(original.events.map(event => event.atMs)).toEqual([201.25, 101.5])
    expect(original.durationMs).toBe(201.25)
    expect(validateIdeaOriginal(original)).toBe(true)
  })

  it('undoes music and metadata while retaining later permanent captures', () => {
    const snapshot = createProject(), existing = createTextIdea(' exact original\n', 'First')
    snapshot.ideas = [existing]
    const current = structuredClone(snapshot), later = createMidiIdea([], 100, 'Later')
    current.ideas = [{ ...existing, name: 'Renamed' }, { ...later, attachedTick: 8 * 1920 }]
    current.bars = 8
    current.notes = [{ id: 'edit', instrument: 'piano', pitch: 60, velocity: 80, startTick: 0, durationTicks: 480 }]
    const next = restoreStudioHistory(snapshot, current)
    expect(next.notes).toEqual([])
    expect(next.ideas[0].name).toBe('First')
    expect(next.ideas[1]).toEqual(current.ideas[1])
    expect(next.bars).toBe(8)
    expect(next.revision).toBe(current.revision + 1)
    expect(snapshot.ideas).toEqual([existing])
  })
})
