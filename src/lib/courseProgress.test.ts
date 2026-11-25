import { describe, expect, it } from 'vitest'
import {
  canFinalizeGuidedSession,
  courseReducer,
  createInitialCourseProgress,
  expectedChords,
  isGuidedSessionComplete,
  normalizeCourseProgress,
  type CourseAction,
  type GuidedCheckArtifact,
  type CourseProgress,
} from './courseProgress'
import type { GuidedSessionId } from '../types'
import { createProjectContent } from './projectModel'
import { createMockPlaybackReceipt } from '../test/playbackReceiptFixture'
import { session2ArtifactFingerprint, type CapturedNoteOccurrence } from './learningChecks'

const receipt = (progress: CourseProgress, endBars: 4 | 8) => createMockPlaybackReceipt(progress.project, endBars * 1_920)
const audition = (beats: CapturedNoteOccurrence[], attemptId: string) => ({ receipt: { renderState: 'tone-audition-completed' as const, runId: 1, audioEpoch: 2, bpm: 90, meter: '4/4' as const, scheduledNoteCount: 4, timelineSeconds: 8 / 3, tailSeconds: 1 as const, sequenceStartedAtAudioTime: 1, scheduledEndAudioTime: 14 / 3, completedAtAudioTime: 14 / 3, artifact: { kind: 'artifact' as const, attemptId, generation: 1, fingerprint: session2ArtifactFingerprint(beats), lengthTicks: 1_920 }, acknowledgedAt: 'mock-completed' }, currentAudioEpochAtValidation: 2 })

function reduce(progress: CourseProgress, actions: CourseAction[]) {
  return actions.reduce(courseReducer, progress)
}

function learn(progress: CourseProgress, session: GuidedSessionId, keys: string[]) {
  return reduce(progress, [
    { type: 'START', session },
    ...keys.map((key): CourseAction => ({ type: 'MARK', session, area: 'learned', key })),
    { type: 'GO_MAKE', session },
  ])
}

describe('cumulative Emotive Piano course', () => {
  it('requires learning, making, and an independent check for Session 2', () => {
    let progress = learn(createInitialCourseProgress('t0'), 2, [
      'heard-accent', 'used-transport', 'counted-four',
    ])
    progress = reduce(progress, [
      ...Array.from({ length: 8 }, (): CourseAction => ({ type: 'INCREMENT', session: 2, key: 'pulseTaps', max: 8 })),
      { type: 'MARK', session: 2, area: 'made', key: 'heard-two-bars' },
      { type: 'MARK', session: 2, area: 'made', key: 'tapped-pulse' },
      { type: 'SET_VALUE', session: 2, key: 'barStartChoice', value: 'beat-5' },
      { type: 'MARK', session: 2, area: 'made', key: 'identified-next-bar' },
      { type: 'GO_CHECK', session: 2 },
      ...Array.from({ length: 4 }, (): CourseAction => ({ type: 'INCREMENT', session: 2, key: 'checkBeats', max: 4 })),
      { type: 'MARK', session: 2, area: 'checked', key: 'counted-bar' },
      { type: 'MARK', session: 2, area: 'checked', key: 'transport-check' },
    ])
    for (const next of ['notice', 'explain', 'try', 'choose', 'apply', 'independent-check'] as const) progress = courseReducer(progress, { type: 'ADVANCE_LEARNING_STAGE', session: 2, next })
    const attempt = progress.sessions['2'].learning!.current
    const beats = [0, 1, 2, 3].map((order) => ({ order, pitch: 60, source: 'screen' as const, learnerAuthored: true as const, startTick: order * 480, velocity: order === 0 ? 110 : 70 }))
    progress = courseReducer(progress, { type: 'SUBMIT_GUIDED_CHECK', session: 2, artifact: { session: 2, check: {
      attemptId: attempt.id, generation: attempt.generation, tapTimesMs: [0, 500, 1_000, 1_500], chosenDownbeat: 1,
      freshBar: { explainedDownbeat: 'Beat one begins the fresh bar.', beats, audition: audition(beats, attempt.id) },
    } } })
    progress = courseReducer(progress, { type: 'RECORD_LEARNING_REFLECTION', session: 2, reflection: 'I rebuilt beat one as the stronger start.' })
    progress = courseReducer(progress, { type: 'EARN_GUIDED_EVIDENCE', session: 2 })
    expect(canFinalizeGuidedSession(progress, 2)).toBe(true)
    progress = courseReducer(progress, { type: 'FINALIZE', session: 2, now: 'done' })
    expect(isGuidedSessionComplete(progress, 2)).toBe(true)
    expect(progress.sessions['2'].checkpoint?.name).toBe('beat-and-bar-complete')
    const reloaded = normalizeCourseProgress(JSON.parse(JSON.stringify(progress)), 'reload')
    expect(isGuidedSessionComplete(reloaded, 2)).toBe(true)
    expect(reloaded.sessions['2'].learning?.current.reflection).toBe('I rebuilt beat one as the stronger start.')
    const corruptions: Array<(raw: CourseProgress) => void> = [
      (raw) => { raw.sessions['2'].learning!.current.artifact = { session: 2 } as unknown as GuidedCheckArtifact },
      (raw) => { raw.sessions['2'].learning!.current.support = [{ level: 'nudge', at: 'bad' }] },
      (raw) => { raw.sessions['2'].learning!.current.origin = 'legacy-unverified-proxy' },
      (raw) => { raw.sessions['2'].learning!.earned[0].projectSnapshot.revision += 1 },
    ]
    for (const corrupt of corruptions) {
      const raw = JSON.parse(JSON.stringify(progress)) as CourseProgress
      corrupt(raw)
      const rejected = normalizeCourseProgress(raw)
      expect(rejected.sessions['2'].learning).toBeUndefined()
      expect(isGuidedSessionComplete(rejected, 2)).toBe(false)
    }
  })

  it('round-trips every learning-cycle stage and rejects corrupt nested learning state', () => {
    let progress = courseReducer(createInitialCourseProgress('start'), { type: 'START', session: 2 })
    for (const next of ['notice', 'explain', 'try', 'choose', 'apply', 'independent-check'] as const) {
      progress = courseReducer(progress, { type: 'ADVANCE_LEARNING_STAGE', session: 2, next })
      expect(normalizeCourseProgress(JSON.parse(JSON.stringify(progress))).sessions['2'].learning?.current.stage).toBe(next)
    }
    const corrupt = JSON.parse(JSON.stringify(progress))
    corrupt.sessions['2'].learning.current.support = [null]
    expect(normalizeCourseProgress(corrupt).sessions['2'].learning).toBeUndefined()
  })

  it('does not finish Session 2 until the learner identifies beat 1 of bar 2', () => {
    let progress = learn(createInitialCourseProgress('t0'), 2, [
      'heard-accent', 'used-transport', 'counted-four',
    ])
    progress = reduce(progress, [
      { type: 'MARK', session: 2, area: 'made', key: 'heard-two-bars' },
      ...Array.from({ length: 8 }, (): CourseAction => ({ type: 'INCREMENT', session: 2, key: 'pulseTaps', max: 8 })),
      { type: 'MARK', session: 2, area: 'made', key: 'tapped-pulse' },
      { type: 'SET_VALUE', session: 2, key: 'barStartChoice', value: 'wrong' },
    ])
    expect(progress.sessions['2'].stage).toBe('make')
    expect(courseReducer(progress, { type: 'GO_CHECK', session: 2 })).toBe(progress)

    progress = reduce(progress, [
      { type: 'SET_VALUE', session: 2, key: 'barStartChoice', value: 'beat-5' },
      { type: 'MARK', session: 2, area: 'made', key: 'identified-next-bar' },
      { type: 'GO_CHECK', session: 2 },
    ])
    expect(progress.sessions['2'].stage).toBe('check')
  })

  it('does not award evidence merely for opening a Studio Check', () => {
    let progress = createInitialCourseProgress('t0')
    progress = courseReducer(progress, { type: 'FINALIZE', session: 4, now: 'fake' })
    expect(progress.sessions['4'].stage).toBe('welcome')
    expect(progress.sessions['4'].checkpoint).toBeUndefined()
  })

  it('builds one cumulative chord, melody, arrangement, and expression project', () => {
    let progress = createInitialCourseProgress('t0')

    progress = learn(progress, 5, ['read-piano-roll', 'heard-snap', 'understood-duration'])
    for (let bar = 0; bar < expectedChords.length; bar += 1) {
      progress = courseReducer(progress, { type: 'SET_CHORD', bar, chord: expectedChords[bar] })
    }
    progress = reduce(progress, [
      { type: 'PRACTICE_CLIP_EDIT', operation: 'move' },
      { type: 'PRACTICE_CLIP_EDIT', operation: 'resize' },
      { type: 'PRACTICE_CLIP_EDIT', operation: 'duplicate' },
      { type: 'PRACTICE_CLIP_EDIT', operation: 'undo' },
      { type: 'CONFIRM_PROJECT_PLAYBACK', session: 5, receipt: receipt(progress, 4), currentAudioEpoch: 1 },
      { type: 'GO_CHECK', session: 5 },
      { type: 'MARK', session: 5, area: 'checked', key: 'time-horizontal' },
      { type: 'MARK', session: 5, area: 'checked', key: 'pitch-vertical' },
      { type: 'MARK', session: 5, area: 'checked', key: 'one-bar-duration' },
      { type: 'FINALIZE', session: 5 },
    ])
    expect(isGuidedSessionComplete(progress, 5)).toBe(false)

    progress = learn(progress, 6, ['heard-motifs', 'heard-chord-tones', 'chose-entry'])
    const melody = [['A', 'C'], ['F', 'A'], ['C', 'E'], ['G', 'B']]
    melody.forEach((bar, barIndex) => bar.forEach((note) => {
      progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: barIndex, note })
    }))
    progress = reduce(progress, [
      { type: 'ADD_MELODY_NOTE', half: 'A', bar: 3, note: 'D' },
      { type: 'SET_VALUE', session: 6, key: 'reflection', value: 'The space in bar two' },
    ])
    progress = reduce(progress, [
      { type: 'CONFIRM_PROJECT_PLAYBACK', session: 6, receipt: receipt(progress, 4), currentAudioEpoch: 1 },
      { type: 'GO_CHECK', session: 6 },
      { type: 'SET_VALUE', session: 6, key: 'checkStarts', value: ['A', 'F', 'C', 'G'] },
      { type: 'FINALIZE', session: 6 },
    ])
    expect(isGuidedSessionComplete(progress, 6)).toBe(false)

    progress = learn(progress, 7, ['compared-halves', 'heard-variation', 'heard-resolution'])
    progress = reduce(progress, [
      { type: 'DUPLICATE_MELODY' },
      { type: 'MAKE_UNIQUE_CLIP', clipId: 'clip-melody-b' },
      { type: 'REMOVE_MELODY_NOTE', half: 'B', bar: 0 },
      { type: 'REMOVE_MELODY_NOTE', half: 'B', bar: 3 },
      { type: 'REMOVE_MELODY_NOTE', half: 'B', bar: 3 },
      { type: 'ADD_MELODY_NOTE', half: 'B', bar: 3, note: 'A' },
      { type: 'SET_VALUE', session: 7, key: 'intention', value: 'the ending so it rests' },
    ])
    progress = reduce(progress, [
      { type: 'CONFIRM_PROJECT_PLAYBACK', session: 7, receipt: receipt(progress, 8), currentAudioEpoch: 1 },
      { type: 'GO_CHECK', session: 7 },
      { type: 'MARK', session: 7, area: 'checked', key: 'identified-change' },
      { type: 'MARK', session: 7, area: 'checked', key: 'resolved-ending' },
      { type: 'FINALIZE', session: 7 },
    ])
    expect(isGuidedSessionComplete(progress, 7)).toBe(false)

    progress = learn(progress, 8, ['heard-velocity', 'introduced-space-control', 'read-safe-range'])
    const velocityIds = progress.project.melodyEvents.slice(0, 3).map((event) => event.id)
    progress = reduce(progress, [
      { type: 'SET_EVENT_VELOCITY', eventId: velocityIds[0], value: 54 },
      { type: 'SET_EVENT_VELOCITY', eventId: velocityIds[1], value: 68 },
      { type: 'SET_EVENT_VELOCITY', eventId: velocityIds[2], value: 86 },
      { type: 'SET_VALUE', session: 8, key: 'velocityReflection', value: 'how firmly the notes speak' },
      { type: 'SET_VALUE', session: 8, key: 'variationReflection', value: 'the ending became calmer' },
    ])
    progress = reduce(progress, [
      { type: 'CONFIRM_PROJECT_PLAYBACK', session: 8, receipt: receipt(progress, 8), currentAudioEpoch: 1 },
      { type: 'GO_CHECK', session: 8 },
      { type: 'MARK', session: 8, area: 'checked', key: 'velocity-is-touch' },
      { type: 'MARK', session: 8, area: 'checked', key: 'reverb-is-space' },
      { type: 'MARK', session: 8, area: 'checked', key: 'meter-is-safe' },
      { type: 'FINALIZE', session: 8, now: 'track-done' },
    ])
    expect(isGuidedSessionComplete(progress, 8)).toBe(false)
    expect(progress.sessions['8'].checkpoint).toBeUndefined()
  })

  it('rejects a forged final checkpoint with missing project evidence', () => {
    const initial = createInitialCourseProgress('t0')
    const forged = {
      ...initial,
      sessions: {
        ...initial.sessions,
        '8': {
          ...initial.sessions['8'],
          stage: 'evidence',
          checkpoint: { name: 'first-track-complete', savedAt: 'fake' },
        },
      },
    }
    const normalized = normalizeCourseProgress(forged, 'fallback')
    expect(normalized.sessions['8'].stage).not.toBe('evidence')
    expect(normalized.sessions['8'].checkpoint).toBeUndefined()
  })

  it('resets one session without erasing another checkpoint', () => {
    let progress = createInitialCourseProgress('t0')
    progress.sessions['2'].checkpoint = { name: 'beat-and-bar-complete', savedAt: 'saved' }
    progress = courseReducer(progress, { type: 'RESET_SESSION', session: 6, now: 'reset' })
    expect(progress.sessions['2'].checkpoint?.name).toBe('beat-and-bar-complete')
    expect(progress.project.melodyEvents).toEqual([])
  })

  it('records Session 5 edit evidence only through ordered state changes', () => {
    let progress = learn(createInitialCourseProgress('t0'), 5, [
      'read-piano-roll', 'heard-snap', 'understood-duration',
    ])
    progress = courseReducer(progress, { type: 'PRACTICE_CLIP_EDIT', operation: 'duplicate' })
    expect(progress.sessions['5'].values.editOperations).toBeUndefined()

    progress = reduce(progress, [
      { type: 'PRACTICE_CLIP_EDIT', operation: 'move' },
      { type: 'PRACTICE_CLIP_EDIT', operation: 'resize' },
      { type: 'PRACTICE_CLIP_EDIT', operation: 'duplicate' },
      { type: 'PRACTICE_CLIP_EDIT', operation: 'undo' },
    ])
    expect(progress.sessions['5'].values).toMatchObject({
      editOperations: ['move', 'resize', 'duplicate', 'undo'],
      editBar: 1,
      editLength: 2,
      editCopies: 1,
    })
  })

  it('blocks project edits outside their session make stage', () => {
    let progress = createInitialCourseProgress('t0')
    progress = courseReducer(progress, { type: 'SET_CHORD', bar: 0, chord: 'Am' })
    progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'A' })
    progress = courseReducer(progress, { type: 'SET_MIX', key: 'reverb', value: 40 })
    expect(progress.project.chords).toEqual([])
    expect(progress.project.melodyEvents).toEqual([])
    expect(progress.project.reverb).toBe(12)
  })

  it('invalidates downstream drafts and evidence when a shared project layer resets', () => {
    let progress = createInitialCourseProgress('t0')
    const projectId = progress.project.id
    progress.sessions['6'].stage = 'evidence'
    progress.sessions['6'].checkpoint = { name: 'phrase-maker-complete', savedAt: 'saved-6' }
    progress.sessions['7'].stage = 'evidence'
    progress.sessions['7'].checkpoint = { name: 'eight-bar-builder-complete', savedAt: 'saved-7' }
    progress.sessions['8'].stage = 'evidence'
    progress.sessions['8'].checkpoint = { name: 'first-track-complete', savedAt: 'saved-8' }
    progress = courseReducer(progress, { type: 'RESET_SESSION', session: 6, now: 'reset' })
    expect(progress.sessions['6'].stage).toBe('welcome')
    expect(progress.sessions['7'].checkpoint).toBeUndefined()
    expect(progress.sessions['8'].checkpoint).toBeUndefined()
    expect(progress.project.melodyEvents).toEqual([])
    expect(progress.project.id).toBe(projectId)
  })

  it('assigns one opaque project identity and preserves it through normalization', () => {
    const progress = createInitialCourseProgress('t0')
    expect(progress.project.id).toMatch(/^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/)
    expect(normalizeCourseProgress(progress, 'later').project.id).toBe(progress.project.id)
  })

  it('requires a new full playback after changing the final mix', () => {
    const progress = createInitialCourseProgress('t0')
    progress.sessions['8'].stage = 'make'
    progress.sessions['8'].values.fullPlayback = true
    const changed = courseReducer(progress, { type: 'SET_MIX', key: 'chordLevel', value: 60 })
    expect(changed.sessions['8'].values.fullPlayback).toBe(false)
  })

  it('clears expression velocities when Session 7 is reset', () => {
    const progress = createInitialCourseProgress('t0')
    progress.project.melodyEvents = [{
      id: 'note-1', pitch: 69, startTick: 0, durationTicks: 240, velocity: 54,
      trackId: 'melody', patternId: 'melody-a', source: 'draw',
    }]
    progress.project.content = createProjectContent(progress.project)
    const reset = courseReducer(progress, { type: 'RESET_SESSION', session: 7 })
    expect(reset.project.melodyEvents[0].velocity).toBe(72)
    expect(reset.project.revision).toBe(1)
  })
})
