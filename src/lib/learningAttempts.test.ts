import { describe, expect, it } from 'vitest'
import {
  advanceLearningStage,
  archiveAndRestartLearningAttempt,
  bestLearningEvidence,
  clearExampleForFreshRetry,
  createLearningAttempt,
  finishLearningAttempt,
  earnLearningRecord,
  addEarnedLearningRecord,
  recordLearningSupport,
  restartAfterExample,
  restartForLowerHelpAttempt,
} from './learningAttempts'

const reference = { projectId: 'project-AbCd1234', revision: 2, contentFingerprint: 'fnv1a32-1234abcd' }

describe('learning attempts', () => {
  it('advances only through the explicit learning cycle without time gates', () => {
    let attempt = createLearningAttempt<never>({ id: 'attempt-1', objectiveId: 'pulse', project: reference, now: 't0' })
    expect(advanceLearningStage(attempt, 'try', 't1')).toBe(attempt)
    for (const stage of ['notice', 'explain', 'try', 'choose', 'apply', 'independent-check', 'reflect'] as const) {
      attempt = advanceLearningStage(attempt, stage, stage)
    }
    expect(attempt.stage).toBe('reflect')
    expect(finishLearningAttempt(attempt, true, 'done').result).toBe('independent')
  })

  it('records support honestly, clears examples for a fresh retry, and never punishes asking', () => {
    let attempt = createLearningAttempt<{ notes: number[] }>({ id: 'attempt-1', objectiveId: 'am', project: reference, now: 't0' })
    attempt = recordLearningSupport(attempt, 'example', 't1')
    attempt = { ...attempt, stage: 'apply', artifact: { notes: [57, 60, 64] } }
    const fresh = clearExampleForFreshRetry(attempt, 't2')
    expect(fresh).toMatchObject({ stage: 'try', generation: 2, exampleClearedAt: 't2', artifact: undefined })
    expect(fresh.support).toEqual([{ level: 'example', at: 't1' }])
    const reflected = { ...fresh, stage: 'reflect' as const }
    expect(finishLearningAttempt(reflected, true, 't3').result).toBe('supported')
    const restarted = restartAfterExample({ current: attempt, completed: [] }, { id: 'attempt-2', project: reference, now: 't4' })
    expect(restarted.current).toMatchObject({ id: 'attempt-2', generation: 1, support: [], result: 'not-yet' })
    expect(restarted.completed[0]).toMatchObject({ id: 'attempt-1', exampleClearedAt: 't4' })
  })

  it('archives cue-supported work before a new lower-help attempt', () => {
    const base = createLearningAttempt<never>({ id: 'attempt-cue', objectiveId: 'pulse', project: reference, now: 't0' })
    const supported = finishLearningAttempt({ ...recordLearningSupport(base, 'cue', 't1'), stage: 'reflect' }, true, 't2')
    const next = restartForLowerHelpAttempt({ current: supported, completed: [], earned: [] }, { id: 'attempt-fresh', project: reference, now: 't3' })
    expect(next.completed[0]).toMatchObject({ id: 'attempt-cue', result: 'supported' })
    expect(next.current).toMatchObject({ id: 'attempt-fresh', support: [], result: 'not-yet' })
  })

  it('preserves earlier independent evidence when a later attempt uses help', () => {
    const base = createLearningAttempt<never>({ id: 'attempt-1', objectiveId: 'chord', project: reference, now: 't0' })
    const independent = finishLearningAttempt({ ...base, stage: 'reflect' }, true, 't1')
    const nextBase = createLearningAttempt<never>({ id: 'attempt-2', objectiveId: 'chord', project: reference, now: 't2' })
    const supported = finishLearningAttempt({ ...recordLearningSupport(nextBase, 'cue', 't3'), stage: 'reflect' }, true, 't4')
    const earned = earnLearningRecord(independent, 't1')!
    const history = archiveAndRestartLearningAttempt(addEarnedLearningRecord({ current: independent, completed: [] }, earned), supported)
    expect(bestLearningEvidence(history)).toBe('independent')
    expect(history.earned).toHaveLength(1)
    supported.project.revision = 99
    expect(earned.projectSnapshot.revision).toBe(2)
  })

  it('never upgrades imported proxy history into current evidence', () => {
    const legacy = createLearningAttempt<never>({ id: 'legacy-1', objectiveId: 'old-clicks', project: reference, now: 't0', origin: 'legacy-unverified-proxy' })
    expect(finishLearningAttempt({ ...legacy, stage: 'reflect' }, true, 't1')).toEqual({ ...legacy, stage: 'reflect' })
    expect(earnLearningRecord(legacy, 't1')).toBeNull()
    expect(bestLearningEvidence({ current: legacy, completed: [] })).toBe('not-yet')
  })
})
