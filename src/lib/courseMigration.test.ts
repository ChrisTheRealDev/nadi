import { describe, expect, it } from 'vitest'
import {
  expectedChords,
  courseReducer,
  createInitialCourseProgress,
  guidedSessionIds,
  melodyBValid,
  normalizeCourseProgress,
  type CourseProgress,
} from './courseProgress'
import {
  melodyPropertyChanges,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
} from './melodyEvents'
import { createProjectContent } from './projectModel'
import { createMockPlaybackReceipt } from '../test/playbackReceiptFixture'

const receipt = (progress: CourseProgress, endBars: 4 | 8) => createMockPlaybackReceipt(progress.project, endBars * TICKS_PER_BAR, { audioEpoch: 2, runId: 3 })

function legacyCourse(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sessions: Object.fromEntries(guidedSessionIds.map((id) => [String(id), {
      stage: 'welcome', learned: [], made: [], checked: [], values: {},
    }])),
    project: {
      bpm: 90,
      meter: '4/4',
      bars: 8,
      chords: [],
      melodyA: [[], [], [], []],
      melodyB: [[], [], [], []],
      velocities: [72, 72, 72, 72],
      chordLevel: 72,
      melodyLevel: 78,
      reverb: 12,
      ...overrides,
    },
    updatedAt: 'legacy-time',
  }
}

describe('Emotive course v1 to v2 migration', () => {
  it('preserves repeated pitches, order, exact inferred timing, and stable IDs', () => {
    const migrated = normalizeCourseProgress(legacyCourse({
      melodyA: [['A', 'A', 'C', 'E', 'G'], [], [], []],
    }), 'fallback')
    const events = migrated.project.melodyEvents

    expect(migrated.version).toBe(2)
    expect(migrated.updatedAt).toBe('legacy-time')
    expect(events.map((event) => event.pitch)).toEqual([69, 69, 72, 76, 79])
    expect(events.map((event) => event.id)).toEqual(['clip-melody-a@note-1', 'clip-melody-a@note-2', 'clip-melody-a@note-3', 'clip-melody-a@note-4', 'clip-melody-a@note-5'])
    expect(events.map((event) => event.startTick)).toEqual([0, 384, 768, 1152, 1536])
    expect(events.map((event) => event.durationTicks)).toEqual([315, 315, 315, 315, 315])
    expect(events.every((event) => event.source === 'legacy' && event.timingInferred)).toBe(true)
    expect(migrated.project.nextMelodyEventId).toBe(6)
  })

  it('cycles legacy velocity slots inside each bar and maps one evidence ID per changed slot', () => {
    const migrated = normalizeCourseProgress(legacyCourse({
      melodyA: [['A', 'B', 'C', 'D', 'E'], ['F', 'G'], [], []],
      velocities: [54, 68, 86, 72],
    }))
    const firstBar = migrated.project.melodyEvents.filter((event) => event.startTick < TICKS_PER_BAR)
    const secondBar = migrated.project.melodyEvents.filter((event) => event.startTick >= TICKS_PER_BAR)

    expect(firstBar.map((event) => event.velocity)).toEqual([54, 68, 86, 72, 54])
    expect(secondBar.map((event) => event.velocity)).toEqual([54, 68])
    expect(migrated.sessions['8'].values.velocityEditedEventIds).toHaveLength(3)

    const oneSlot = normalizeCourseProgress(legacyCourse({
      melodyA: [['A', 'B', 'C', 'D'], [], [], []],
      velocities: [54, 72, 72, 72],
    }))
    expect(oneSlot.sessions['8'].values.velocityEditedEventIds).toHaveLength(1)
  })

  it('links inferred B notes to A origins without inventing rhythm changes', () => {
    const base = {
      melodyA: [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']],
      melodyB: [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']],
    }
    const identical = normalizeCourseProgress(legacyCourse(base))
    expect(melodyPropertyChanges(identical.project.melodyEvents)).toBe(0)
    expect(melodyBValid(identical.project)).toBe(false)

    const oneChange = normalizeCourseProgress(legacyCourse({ ...base, melodyB: [['B', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']] }))
    expect(melodyPropertyChanges(oneChange.project.melodyEvents)).toBe(1)

    const twoChanges = normalizeCourseProgress(legacyCourse({ ...base, melodyB: [['B', 'D'], ['F', 'A'], ['C', 'E'], ['G', 'A']] }))
    expect(melodyPropertyChanges(twoChanges.project.melodyEvents)).toBe(2)
    expect(melodyBValid(twoChanges.project)).toBe(true)
  })

  it('sanitizes corrupt v2 events individually and repairs duplicate IDs', () => {
    const current = createInitialCourseProgress('v2-time')
    const normalized = normalizeCourseProgress({
      ...current,
      project: {
        ...current.project,
        content: undefined,
        nextMelodyEventId: 1,
        melodyEvents: [
          { id: 'note-4', pitch: 69, startTick: 0, durationTicks: 240, velocity: 72, trackId: 'melody', patternId: 'melody-b', source: 'draw' },
          { id: 'note-4', pitch: 72, startTick: 240, durationTicks: 240, velocity: 80, trackId: 'melody', patternId: 'melody-a', source: 'draw' },
          { id: 'bad', pitch: 200, startTick: 480, durationTicks: 240, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' },
          { id: 'overflow', pitch: 76, startTick: 1800, durationTicks: 480, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' },
        ],
      },
    })

    expect(normalized.project.melodyEvents).toHaveLength(2)
    expect(new Set(normalized.project.melodyEvents.map((event) => event.id)).size).toBe(2)
    expect(normalized.project.melodyEvents.every((event) => event.patternId === 'melody-a')).toBe(true)
    expect(normalized.project.nextMelodyEventId).toBeGreaterThan(4)
  })

  it('counts one origin-preserving pitch replacement as one variation', () => {
    let progress: CourseProgress = createInitialCourseProgress('t0')
    progress.sessions['6'].stage = 'make'
    const notes = [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']]
    notes.forEach((bar, barIndex) => bar.forEach((note) => {
      progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: barIndex, note })
    }))
    progress.sessions['7'].stage = 'make'
    progress = courseReducer(progress, { type: 'DUPLICATE_MELODY' })
    progress = courseReducer(progress, { type: 'MAKE_UNIQUE_CLIP', clipId: 'clip-melody-b' })
    const firstB = progress.project.melodyEvents.find((event) => event.patternId === 'melody-b')
    progress = courseReducer(progress, { type: 'SET_MELODY_PITCH', half: 'B', eventId: firstB!.id, note: 'B' })

    expect(melodyPropertyChanges(progress.project.melodyEvents)).toBe(1)
    expect(melodyBValid(progress.project)).toBe(false)
  })

  it('counts a delete-and-replace at the same position as one variation', () => {
    let progress: CourseProgress = createInitialCourseProgress('t0')
    progress.sessions['6'].stage = 'make'
    const notes = [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']]
    notes.forEach((bar, barIndex) => bar.forEach((note) => {
      progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: barIndex, note })
    }))
    progress.sessions['7'].stage = 'make'
    progress = courseReducer(progress, { type: 'DUPLICATE_MELODY' })
    progress = courseReducer(progress, { type: 'MAKE_UNIQUE_CLIP', clipId: 'clip-melody-b' })
    const firstB = progress.project.melodyEvents.find((event) => event.patternId === 'melody-b')!
    progress = courseReducer(progress, { type: 'REMOVE_MELODY_NOTE', half: 'B', bar: 0, eventId: firstB.id })
    progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'B', bar: 0, note: 'B' })
    expect(melodyPropertyChanges(progress.project.melodyEvents)).toBe(1)
  })

  it('clears inferred timing when the learner authors a real timing edit', () => {
    const migrated = normalizeCourseProgress(legacyCourse({ melodyB: [['A'], [], [], []] }))
    migrated.sessions['7'].stage = 'make'
    const event = migrated.project.melodyEvents[0]
    const changed = courseReducer(migrated, {
      type: 'SET_MELODY_TIMING',
      half: 'B',
      eventId: event.id,
      startTick: 4 * TICKS_PER_BAR + TICKS_PER_BEAT,
    })
    expect(changed.project.melodyEvents[0].timingInferred).toBeUndefined()
  })

  it('keeps huge numeric-looking IDs opaque and allocates distinct safe IDs', () => {
    const current = createInitialCourseProgress('v2')
    current.sessions['6'].stage = 'make'
    current.project.melodyEvents = [{
      id: 'note-9007199254740992', pitch: 69, startTick: 0, durationTicks: 240,
      velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw',
    }]
    current.project.content = createProjectContent(current.project)
    let normalized = normalizeCourseProgress(current)
    normalized = courseReducer(normalized, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'C' })
    normalized = courseReducer(normalized, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'E' })
    const ids = normalized.project.melodyEvents.map((event) => event.id)
    expect(normalized.project.nextMelodyEventId).toBeLessThanOrEqual(1_000_000)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(['duplicate', 'cross-bar'])('ignores %s projection forgery and downgrades forged Session 7 evidence', (kind) => {
    const base = normalizeCourseProgress(legacyCourse({
      melodyA: [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']],
      melodyB: [['B', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']],
    }))
    const firstA = base.project.melodyEvents.find((event) => event.patternId === 'melody-a')!
    const secondA = base.project.melodyEvents.filter((event) => event.patternId === 'melody-a')[2]
    const bEvents = base.project.melodyEvents.filter((event) => event.patternId === 'melody-b')
    bEvents[1].originId = kind === 'duplicate' ? bEvents[0].originId : secondA.id
    base.sessions['7'] = {
      stage: 'evidence',
      learned: ['compared-halves', 'heard-variation', 'heard-resolution'],
      made: ['duplicated-phrase'],
      checked: ['identified-change', 'resolved-ending'],
      values: { intention: 'one changed note', reviewedArrangement: true },
      checkpoint: { name: 'eight-bar-builder-complete', savedAt: 'forged' },
    }
    const normalized = normalizeCourseProgress(base)
    expect(normalized.sessions['7'].stage).not.toBe('evidence')
    expect(normalized.sessions['7'].checkpoint).toBeUndefined()
    expect(normalized.project.melodyEvents.find((event) => event.id === bEvents[1].id)?.originId).toBe(`clip-melody-a@note-2`)
    expect(firstA.id).toBeTruthy()
  })

  it('preserves a valid legacy Session 8 checkpoint when short bars used only two velocity slots', () => {
    const raw: Record<string, unknown> = legacyCourse({
      chords: expectedChords,
      melodyA: [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'A']],
      melodyB: [['B', 'D'], ['F', 'A'], ['C', 'E'], ['G', 'A']],
      velocities: [54, 68, 86, 72],
    })
    ;(raw.sessions as Record<string, unknown>)['8'] = {
      stage: 'evidence',
      learned: ['heard-velocity', 'introduced-space-control', 'read-safe-range'],
      made: [],
      checked: ['velocity-is-touch', 'reverb-is-space', 'meter-is-safe'],
      values: {
        fullPlayback: true,
        velocityReflection: 'touch changed the phrase',
        variationReflection: 'the ending became calmer',
      },
      checkpoint: { name: 'first-track-complete', savedAt: 'legacy-done' },
    }
    const migrated = normalizeCourseProgress(raw)
    expect(migrated.sessions['8'].stage).toBe('check')
    expect(migrated.sessions['8'].checkpoint).toBeUndefined()
    expect(normalizeCourseProgress(migrated).sessions['8'].stage).toBe('check')
  })

  it('does not award revisions or velocity evidence for no-op and non-finite actions', () => {
    const progress = normalizeCourseProgress(legacyCourse({ melodyA: [['A'], [], [], []] }))
    progress.sessions['6'].stage = 'make'
    progress.sessions['6'].values.playedBack = true
    const event = progress.project.melodyEvents[0]
    expect(courseReducer(progress, { type: 'SET_MELODY_PITCH', half: 'A', eventId: event.id, note: 'A' })).toBe(progress)
    expect(courseReducer(progress, { type: 'SET_MELODY_TIMING', half: 'A', eventId: event.id, startTick: event.startTick, durationTicks: event.durationTicks })).toBe(progress)

    progress.sessions['8'].stage = 'make'
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(courseReducer(progress, { type: 'SET_EVENT_VELOCITY', eventId: event.id, value })).toBe(progress)
      expect(courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'C', velocity: value })).toBe(progress)
    }
    expect(progress.sessions['8'].values.velocityEditedEventIds).toBeUndefined()
  })

  it('edits timing dimensions independently and keeps MIDI edits in the nearest register', () => {
    const progress = normalizeCourseProgress(legacyCourse({ melodyA: [['A', 'C', 'E'], [], [], []] }))
    progress.sessions['6'].stage = 'make'
    const event = progress.project.melodyEvents[1]
    const durationOnly = courseReducer(progress, {
      type: 'SET_MELODY_TIMING', half: 'A', eventId: event.id, durationTicks: TICKS_PER_BEAT,
    })
    const durationEvent = durationOnly.project.melodyEvents.find((item) => item.id === event.id)!
    expect(durationEvent.startTick).toBe(event.startTick)
    expect(durationEvent.durationTicks).toBe(TICKS_PER_BEAT)

    durationEvent.pitch = 57
    const pitchChanged = courseReducer(durationOnly, { type: 'SET_MELODY_PITCH', half: 'A', eventId: event.id, note: 'C' })
    expect(pitchChanged.project.melodyEvents.find((item) => item.id === event.id)?.pitch).toBe(60)
  })

  it('does not overwrite an authored variation or accept a stale playback callback', () => {
    let progress = createInitialCourseProgress('v2')
    progress.sessions['6'].stage = 'make'
    progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'A' })
    progress.sessions['7'].stage = 'make'
    progress = courseReducer(progress, { type: 'DUPLICATE_MELODY' })
    progress = courseReducer(progress, { type: 'MAKE_UNIQUE_CLIP', clipId: 'clip-melody-b' })
    const bEvent = progress.project.melodyEvents.find((event) => event.patternId === 'melody-b')!
    progress = courseReducer(progress, { type: 'SET_MELODY_PITCH', half: 'B', eventId: bEvent.id, note: 'C' })
    expect(courseReducer(progress, { type: 'DUPLICATE_MELODY' })).toBe(progress)

    progress.sessions['8'].stage = 'make'
    const heardRevision = progress.project.revision
    const edited = courseReducer(progress, { type: 'SET_EVENT_VELOCITY', eventId: bEvent.id, value: 54 })
    const stale = receipt(progress, 8)
    stale.projectRevision = heardRevision
    expect(courseReducer(edited, { type: 'CONFIRM_PROJECT_PLAYBACK', session: 8, receipt: stale, currentAudioEpoch: 2 })).toBe(edited)
    expect(edited.sessions['8'].values.fullPlayback).toBe(false)
  })
})
