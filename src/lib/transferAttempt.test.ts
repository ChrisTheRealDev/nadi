import { describe, expect, it } from 'vitest'
import { appendProjectCommand, cloneProjectContent, emptyProjectHistory } from './projectModel'
import {
  createBlankAmFTransferAttempt,
  recordFlTransferStep,
  summarizeFlTransfer,
  transferArtifactComplete,
  type FlTransferStep,
} from './transferAttempt'

const steps: FlTransferStep[] = ['import', 'find-notes', 'place-pattern', 'make-new-edit', 'route', 'set-gain']

describe('two-bar transfer attempt', () => {
  it('is a distinct blank 2-bar project and cannot mutate the final project', () => {
    const attempt = createBlankAmFTransferAttempt({ id: 'transfer-1', projectId: 'project-transfer-1', finalProjectId: 'project-final-1', now: 'now' })
    expect(attempt.projectId).not.toBe(attempt.finalProjectId)
    expect(attempt.content.lengthTicks).toBe(3_840)
    expect(attempt.content.patterns).toEqual({})
    expect(attempt.content.clips).toEqual([])
    expect(() => createBlankAmFTransferAttempt({ id: 'x', projectId: 'same', finalProjectId: 'same', now: 'now' })).toThrow()
  })

  it('requires learner-authored melody over the Am then F backing and rejects inherited proxies', () => {
    const attempt = createBlankAmFTransferAttempt({ id: 'transfer-1', projectId: 'project-transfer-1', finalProjectId: 'project-final-1', now: 'now' })
    const content = cloneProjectContent(attempt.content)
    content.patterns.melody = { id: 'melody', channelId: 'channel-melody', name: 'Transfer melody', lengthTicks: 3_840, notes: [{ id: 'melody-1', channelId: 'channel-melody', pitch: 69, startTick: 0, durationTicks: 480, velocity: 70, source: 'screen' }] }
    content.clips.push({ id: 'clip-melody', patternId: 'melody', laneId: 'lane-melody', startTick: 0, lengthTicks: 3_840, offsetTick: 0 })
    attempt.content = content
    attempt.history = appendProjectCommand(emptyProjectHistory(), 'Learner added transfer melody', createBlankAmFTransferAttempt({ id: 'before', projectId: 'project-transfer-2', finalProjectId: 'project-final-1', now: 'now' }).content, content, 'now')
    expect(transferArtifactComplete(attempt, { learnerAuthoredMelodyInstanceIds: ['clip-melody@melody-1'], authoredCommandIds: ['command-1'], explanation: 'The melody responds to Am then F.' })).toBe(true)
    content.patterns.melody.notes[0].source = 'duplicate'
    expect(transferArtifactComplete(attempt, { learnerAuthoredMelodyInstanceIds: ['clip-melody@melody-1'], authoredCommandIds: ['command-1'], explanation: 'The melody responds to Am then F.' })).toBe(false)
  })

  it('keeps self-report, app observation, educator observation, assistance, and independence distinct', () => {
    let evidence = { steps: {} }
    for (const step of steps) evidence = recordFlTransferStep(evidence, { step, observation: step === 'import' ? 'self-reported' : 'app-observed', support: step === 'route' ? 'cue' : 'none', observedAt: step })
    expect(summarizeFlTransfer(evidence)).toMatchObject({ complete: true, independent: false, assisted: true, selfReportedSteps: ['import'] })
    let independent = { steps: {} }
    for (const step of steps) independent = recordFlTransferStep(independent, { step, observation: step === 'set-gain' ? 'educator-observed' : 'app-observed', support: 'none', observedAt: step })
    expect(summarizeFlTransfer(independent)).toMatchObject({ complete: true, independent: true, assisted: false, educatorObservedSteps: ['set-gain'] })
  })
})
