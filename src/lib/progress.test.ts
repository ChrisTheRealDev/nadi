import { describe, expect, it } from 'vitest'
import {
  canCompleteSession,
  createInitialProgress,
  isSessionComplete,
  normalizeProgress,
  progressReducer,
  sessionEvidenceLevel,
  type ProgressAction,
} from './progress'
import type { SessionProgress } from '../types'

function reduce(
  progress: SessionProgress,
  actions: ProgressAction[],
): SessionProgress {
  return actions.reduce(progressReducer, progress)
}

function reachPractice() {
  return reduce(createInitialProgress('t0'), [
    { type: 'START_RECALL' },
    { type: 'RECALL_TAP', now: 't1' },
    { type: 'RECALL_TAP', now: 't2' },
    { type: 'RECALL_TAP', now: 't3' },
    { type: 'RECALL_TAP', now: 't4' },
    { type: 'HEARD_COMPARISON', mode: 'minor', now: 't5' },
    { type: 'HEARD_COMPARISON', mode: 'major', now: 't6' },
    { type: 'CHOOSE_COMPARISON', choice: 'minor', now: 't7' },
    { type: 'HEARD_LESSON', mode: 'separate', now: 't8' },
    { type: 'HEARD_LESSON', mode: 'together', now: 't9' },
    { type: 'GO_PRACTICE' },
  ])
}

describe('Session 3 progress', () => {
  it('does not allow phase skipping or false finalisation', () => {
    let progress = createInitialProgress('t0')
    progress = progressReducer(progress, { type: 'GO_APPLY' })
    progress = progressReducer(progress, { type: 'FINALIZE', now: 'fake' })
    expect(progress.stage).toBe('welcome')
    expect(progress.checkpoint).toBeUndefined()
    expect(canCompleteSession(progress)).toBe(false)
  })

  it('requires actual practice, grid edits, playback, and a fresh check', () => {
    let progress = reachPractice()
    progress = reduce(progress, [
      { type: 'PRACTICE_NOTE', note: 57, source: 'screen', now: 'p1' },
      { type: 'PRACTICE_NOTE', note: 60, source: 'screen', now: 'p2' },
      { type: 'PRACTICE_NOTE', note: 64, source: 'screen', now: 'p3' },
      { type: 'GO_APPLY' },
      { type: 'APPLY_TOGGLE', note: 57, now: 'a1' },
      { type: 'APPLY_TOGGLE', note: 60, now: 'a2' },
      { type: 'APPLY_TOGGLE', note: 64, now: 'a3' },
    ])
    expect(progress.stage).toBe('apply')
    progress = progressReducer(progress, { type: 'GO_CHECK' })
    expect(progress.stage).toBe('apply')

    progress = reduce(progress, [
      { type: 'APPLY_PLAYED' },
      { type: 'GO_CHECK' },
      { type: 'CHECK_NOTE', note: 69, source: 'computer', now: 'c1' },
      { type: 'CHECK_NOTE', note: 72, source: 'computer', now: 'c2' },
      { type: 'CHECK_NOTE', note: 76, source: 'computer', now: 'c3' },
    ])
    expect(progress.stage).toBe('check')
    expect(canCompleteSession(progress)).toBe(true)
    expect(isSessionComplete(progress)).toBe(false)
    expect(sessionEvidenceLevel(progress)).toBe('demonstrated')
    expect(progress.evidence.check.notes).toEqual([69, 72, 76])

    progress = progressReducer(progress, { type: 'FINALIZE', now: 'done' })
    expect(progress.stage).toBe('evidence')
    expect(progress.checkpoint).toEqual({
      name: 'harmony-a-complete',
      savedAt: 'done',
    })
    expect(isSessionComplete(progress)).toBe(true)
    expect(sessionEvidenceLevel(progress)).toBe('independent')
  })

  it('records help as guidance without blocking completion', () => {
    let progress = reachPractice()
    progress = reduce(progress, [
      { type: 'PRACTICE_NOTE', note: 57, source: 'midi', now: 'p1' },
      { type: 'PRACTICE_NOTE', note: 60, source: 'midi', now: 'p2' },
      { type: 'PRACTICE_NOTE', note: 64, source: 'midi', now: 'p3' },
      { type: 'GO_APPLY' },
      { type: 'APPLY_TOGGLE', note: 57, now: 'a1' },
      { type: 'APPLY_TOGGLE', note: 60, now: 'a2' },
      { type: 'APPLY_TOGGLE', note: 64, now: 'a3' },
      { type: 'APPLY_PLAYED', now: 'a4' },
      { type: 'GO_CHECK' },
      { type: 'CHECK_HINT' },
      { type: 'CHECK_NOTE', note: 57, source: 'midi', now: 'c1' },
      { type: 'CHECK_NOTE', note: 60, source: 'midi', now: 'c2' },
      { type: 'CHECK_NOTE', note: 64, source: 'midi', now: 'c3' },
      { type: 'FINALIZE', now: 'done' },
    ])
    expect(progress.stage).toBe('evidence')
    expect(sessionEvidenceLevel(progress)).toBe('with-guidance')
  })

  it('downgrades an injected evidence stage when required facts are absent', () => {
    const injected = {
      ...createInitialProgress('t0'),
      stage: 'evidence',
      checkpoint: { name: 'harmony-a-complete', savedAt: 'fake' },
    }
    const normalised = normalizeProgress(injected, 'fallback')
    expect(normalised.stage).toBe('recall')
    expect(normalised.checkpoint).toBeUndefined()
    expect(canCompleteSession(normalised)).toBe(false)
  })

  it('rejects a checkpoint when corrupt storage contains only check evidence', () => {
    const injected = {
      ...createInitialProgress('t0'),
      stage: 'evidence',
      evidence: {
        ...createInitialProgress('t0').evidence,
        check: {
          notes: [57, 60, 64],
          inputEvents: 3,
          hintsUsed: 0,
          completedAt: 'fake-check',
        },
      },
      checkpoint: { name: 'harmony-a-complete', savedAt: 'fake-save' },
    }
    const normalised = normalizeProgress(injected, 'fallback')
    expect(normalised.stage).toBe('recall')
    expect(normalised.checkpoint).toBeUndefined()
    expect(canCompleteSession(normalised)).toBe(false)
  })

  it('requires playback again after any grid edit', () => {
    let progress = reachPractice()
    progress = reduce(progress, [
      { type: 'PRACTICE_NOTE', note: 57, source: 'screen' },
      { type: 'PRACTICE_NOTE', note: 60, source: 'screen' },
      { type: 'PRACTICE_NOTE', note: 64, source: 'screen' },
      { type: 'GO_APPLY' },
      { type: 'APPLY_TOGGLE', note: 57 },
      { type: 'APPLY_TOGGLE', note: 60 },
      { type: 'APPLY_TOGGLE', note: 64 },
      { type: 'APPLY_PLAYED' },
      { type: 'APPLY_TOGGLE', note: 64 },
      { type: 'APPLY_TOGGLE', note: 64 },
    ])
    expect(progress.evidence.apply.playedBack).toBe(false)
    expect(progress.evidence.apply.completedAt).toBeUndefined()
    expect(progressReducer(progress, { type: 'GO_CHECK' }).stage).toBe('apply')
  })

  it('does not downgrade a completed independent check when help is clicked later', () => {
    let progress = reachPractice()
    progress = reduce(progress, [
      { type: 'PRACTICE_NOTE', note: 57, source: 'screen' },
      { type: 'PRACTICE_NOTE', note: 60, source: 'screen' },
      { type: 'PRACTICE_NOTE', note: 64, source: 'screen' },
      { type: 'GO_APPLY' },
      { type: 'APPLY_TOGGLE', note: 57 },
      { type: 'APPLY_TOGGLE', note: 60 },
      { type: 'APPLY_TOGGLE', note: 64 },
      { type: 'APPLY_PLAYED' },
      { type: 'GO_CHECK' },
      { type: 'CHECK_NOTE', note: 57, source: 'screen' },
      { type: 'CHECK_NOTE', note: 60, source: 'screen' },
      { type: 'CHECK_NOTE', note: 64, source: 'screen' },
      { type: 'CHECK_HINT' },
      { type: 'FINALIZE' },
    ])
    expect(progress.evidence.check.hintsUsed).toBe(0)
    expect(sessionEvidenceLevel(progress)).toBe('independent')
  })
})
