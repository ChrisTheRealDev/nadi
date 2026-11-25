import { describe, expect, it } from 'vitest'
import { appendProjectCommand, applyProjectGraphEdit, createProjectContent, emptyProjectHistory, projectContentFingerprint } from './projectModel'
import { capturedChordMatches, currentProject, session1HardwareVerified, session1SignalComplete, session2ArtifactFingerprint, session2Complete, session3Complete, session4ArtifactFingerprint, session4Complete, session5Complete, session6Complete, session7Complete, tapMotorFeedback, type CapturedChordAttempt, type CapturedNoteOccurrence } from './learningChecks'
import { createMockPlaybackReceipt } from '../test/playbackReceiptFixture'
import type { EmotiveProject } from './courseProgress'

const context = (attemptId: string, generation = 1) => ({ attemptId, generation })
const chord = (id: string, notes: number[], generation = 1): CapturedChordAttempt => ({
  ...context(id, generation),
  occurrences: notes.map((pitch, order) => ({ order, pitch, source: 'screen' as const, learnerAuthored: true as const })),
  support: 'none',
})
const artifactAudition = (fingerprint: string, scheduledNoteCount: number, attemptId: string) => ({ receipt: { renderState: 'tone-audition-completed' as const, runId: 1, audioEpoch: 2, bpm: 90, meter: '4/4' as const, scheduledNoteCount, timelineSeconds: 8 / 3, tailSeconds: 1 as const, sequenceStartedAtAudioTime: 1, scheduledEndAudioTime: 14 / 3, completedAtAudioTime: 14 / 3, artifact: { kind: 'artifact' as const, attemptId, generation: 1, fingerprint, lengthTicks: 1_920 }, acknowledgedAt: 'mock-completed' }, currentAudioEpochAtValidation: 2 })
const audition = (beats: CapturedNoteOccurrence[], attemptId = 's2') => artifactAudition(session2ArtifactFingerprint(beats), 4, attemptId)

describe('typed learning checks', () => {
  it('preserves repeated occurrences and rejects malformed or mismatched attempts', () => {
    const attempt = chord('am', [57, 57, 60, 64])
    expect(capturedChordMatches(attempt, 'Am', context('am'))).toBe(true)
    expect(capturedChordMatches({ ...attempt, occurrences: [{ ...attempt.occurrences[0], pitch: 200 }] }, 'Am', context('am'))).toBe(false)
    expect(capturedChordMatches(attempt, 'Am', context('forged'))).toBe(false)
  })

  it('requires an observed signal-path state change and keeps hardware separate', () => {
    const check = { ...context('s1'), audioReady: true, pressReleaseCycles: 3, audioSignals: 3, silenceConfirmed: true, freshRepair: { fault: 'audio-disabled' as const, predictedOutcome: 'Enabling audio should restore sound.', before: { signalCount: 0, silenceAfterRelease: true }, action: 'enable-audio' as const, after: { signalCount: 1, silenceAfterRelease: true } } }
    expect(session1SignalComplete(check, context('s1'))).toBe(true)
    expect(session1SignalComplete({ ...check, freshRepair: { ...check.freshRepair, after: { signalCount: 0, silenceAfterRelease: true } } }, context('s1'))).toBe(false)
    expect(session1HardwareVerified(check)).toBe(false)
    expect(session1HardwareVerified({ ...check, hardwareVerification: { physicalMidiCycles: 3, noteOffsObserved: 3, verifiedAt: 'observed-now' } })).toBe(true)
  })

  it('reports tap timing separately and requires a learner-built accented 4/4 bar', () => {
    expect(tapMotorFeedback([0, 500, 1010, 1490])).toMatchObject({ measured: true, understandingGate: false })
    const beats = [0, 1, 2, 3].map((order) => ({ order, pitch: 60, source: 'computer' as const, learnerAuthored: true as const, startTick: order * 480, velocity: order === 0 ? 110 : 70 }))
    const check = { ...context('s2'), chosenDownbeat: 1 as const, tapTimesMs: [0, 500], freshBar: { beats, explainedDownbeat: 'Beat one begins the bar.', audition: audition(beats) } }
    expect(session2Complete(check, context('s2'))).toBe(true)
    expect(session2Complete({ ...check, freshBar: { ...check.freshBar, beats: beats.map((beat) => ({ ...beat, startTick: 0 })) } }, context('s2'))).toBe(false)
    expect(session2Complete({ ...check, chosenDownbeat: 2 }, context('s2'))).toBe(false)
    expect(session2Complete({ ...check, freshBar: { ...check.freshBar, beats: beats.map((beat, index) => ({ ...beat, startTick: index * 240 })) } }, context('s2'))).toBe(false)
    expect(session2Complete({ ...check, freshBar: { ...check.freshBar, beats: beats.map((beat) => ({ ...beat, velocity: 70 })) } }, context('s2'))).toBe(false)
    expect(session2Complete({ ...check, freshBar: { ...check.freshBar, audition: { ...check.freshBar.audition, currentAudioEpochAtValidation: 3 } } }, context('s2'))).toBe(false)
  })

  it('requires a distinct A-minor construction and repair', () => {
    const check = { construction: chord('build', [57, 60, 64]), freshRepair: chord('repair', [69, 72, 76]), explanation: 'A C E was recorded for review.' }
    expect(session3Complete(check, context('build'), context('repair'))).toBe(true)
    expect(session3Complete({ ...check, freshRepair: { ...check.freshRepair, attemptId: 'build' } }, context('build'), context('build'))).toBe(false)
  })

  it('requires actual F/C/G note captures, a distinct G repair, and a matching audition', () => {
    const draft = { constructions: { F: chord('s4:F', [53, 57, 60]), C: chord('s4:C', [60, 64, 67]), G: chord('s4:G', [55, 59, 62]) }, freshRepair: { ...chord('s4:repair', [55, 59, 62]), target: 'G' as const, challengeOccurrences: chord('s4:repair', [55, 59, 61]).occurrences } }
    const check = { ...draft, moodContext: 'The movement feels open.', explanation: 'Each captured shape uses root third and fifth.', audition: artifactAudition(session4ArtifactFingerprint(draft), 12, 's4') }
    const contexts = { F: context('s4:F'), C: context('s4:C'), G: context('s4:G'), repair: context('s4:repair') }
    expect(session4Complete(check, contexts)).toBe(true)
    expect(session4Complete({ ...check, freshRepair: { ...check.freshRepair, challengeOccurrences: chord('s4:repair', [55, 59, 62]).occurrences } }, contexts)).toBe(false)
    expect(session4Complete({ ...check, freshRepair: { ...check.freshRepair, occurrences: chord('x', [55, 59, 61]).occurrences } }, contexts)).toBe(false)
    expect(session4Complete({ ...check, audition: { ...check.audition, receipt: { ...check.audition.receipt, artifact: { ...check.audition.receipt.artifact, fingerprint: 'fnv1a32-00000000' } } } }, contexts)).toBe(false)
  })

  it('requires project id, revision, and fingerprint together', () => {
    const content = createProjectContent()
    const project = { projectId: 'project-AbCd1234', revision: 1, contentFingerprint: projectContentFingerprint(content) }
    expect(currentProject(project, project, content)).toBe(true)
    expect(currentProject(project, { ...project, revision: 2 }, content)).toBe(false)
    expect(currentProject(project, { ...project, projectId: 'project-other123' }, content)).toBe(false)
  })

  it('requires canonical clip operations, an undone resize, and the exact displaced-clip repair', () => {
    let content = createProjectContent({ chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'] })
    let history = emptyProjectHistory()
    const apply = (label: string, edit: Parameters<typeof applyProjectGraphEdit>[1]) => {
      const before = content
      content = applyProjectGraphEdit(content, edit)
      history = appendProjectCommand(history, label, before, content, label)
      return history.past.at(-1)!
    }
    const duplicate = apply('duplicate', { type: 'duplicate-clip', sourceClipId: 'clip-chord-1', newClipId: 'practice-clip', startTick: 3_840 })
    const move = apply('move', { type: 'move-clip', clipId: 'practice-clip', startTick: 4_800 })
    const resize = apply('resize', { type: 'resize-clip', clipId: 'practice-clip', lengthTicks: 960 })
    history = { ...history, past: history.past.slice(0, -1), future: [resize] }
    content = resize.before
    const challenge = apply('challenge', { type: 'move-clip', clipId: 'clip-chord-8', startTick: 12_960 })
    const repair = apply('repair', { type: 'move-clip', clipId: 'clip-chord-8', startTick: 13_440 })
    const operation = (command: typeof move, clipId: string) => {
      const before = command.before.clips.find((clip) => clip.id === clipId)!
      const after = command.after.clips.find((clip) => clip.id === clipId)!
      return { commandId: command.id, clipId, beforeStartTick: before.startTick, afterStartTick: after.startTick, beforeLengthTicks: before.lengthTicks, afterLengthTicks: after.lengthTicks }
    }
    const project = { projectId: 'project-AbCd1234', revision: 7, contentFingerprint: projectContentFingerprint(content) }
    const receipt = createMockPlaybackReceipt({ id: project.projectId, revision: project.revision, content } as EmotiveProject, 15_360)
    const check = {
      ...context('s5'), project, move: operation(move, 'practice-clip'), resize: operation(resize, 'practice-clip'),
      duplicate: { commandId: duplicate.id, sourceClipId: 'clip-chord-1', createdClipId: 'practice-clip' },
      undo: { undoneCommand: resize, beforeUndoFingerprint: projectContentFingerprint(resize.after), afterUndoFingerprint: projectContentFingerprint(resize.before) },
      freshDisplacedClipRepair: { ...operation(repair, 'clip-chord-8'), ...context('s5:repair'), challengeCommandId: challenge.id, challengeIntendedStartTick: 13_440 },
      explanation: 'The clip returned to its intended bar.', audition: { receipt, currentAudioEpochAtValidation: receipt.audioEpoch },
    }
    expect(session5Complete(check, { main: context('s5'), repair: context('s5:repair') }, project, content, history)).toBe(true)
    expect(session5Complete({ ...check, freshDisplacedClipRepair: { ...check.freshDisplacedClipRepair, challengeIntendedStartTick: 11_520 } }, { main: context('s5'), repair: context('s5:repair') }, project, content, history)).toBe(false)
  })

  it('allows a sparse learner phrase and Keep while resolving real owned note instances', () => {
    let content = createProjectContent()
    content = applyProjectGraphEdit(content, { type: 'add-note', event: { id: 'note-1', pitch: 69, startTick: 0, durationTicks: 480, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' } })
    const project = { projectId: 'project-AbCd1234', revision: 1, contentFingerprint: projectContentFingerprint(content) }
    const instance = 'clip-melody-a@note-1'
    const check = { ...context('s6'), project, intention: 'Leave space.', learnerAuthoredInstanceIds: [instance], freshOneBarAnswer: { ...context('answer'), barStartTick: 0, occurrences: [{ order: 0, pitch: 69, source: 'screen' as const, learnerAuthored: true as const, startTick: 0 }], support: 'cue' as const }, comparisonChoice: 'keep' as const, explanation: 'The decision was recorded for review.' }
    const contexts = { main: context('s6'), answer: context('answer') }
    expect(session6Complete(check, contexts, project, content, emptyProjectHistory())).toBe(true)
    expect(session6Complete({ ...check, learnerAuthoredInstanceIds: ['missing'] }, contexts, project, content, emptyProjectHistory())).toBe(false)
  })

  it('rejects Make Unique alone and accepts one audible identified A-prime change', () => {
    let content = createProjectContent()
    content = applyProjectGraphEdit(content, { type: 'add-note', event: { id: 'note-1', pitch: 60, startTick: 0, durationTicks: 480, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' } })
    content = applyProjectGraphEdit(content, { type: 'duplicate-melody' })
    const sharedClip = content.clips.find((clip) => clip.id === 'clip-melody-b')!
    content = applyProjectGraphEdit(content, { type: 'make-unique', clipId: sharedClip.id })
    let project = { projectId: 'project-AbCd1234', revision: 2, contentFingerprint: projectContentFingerprint(content) }
    const base = { ...context('s7'), project, aPatternId: content.clips.find((clip) => clip.id === 'clip-melody-a')!.patternId, aPrimePatternId: content.clips.find((clip) => clip.id === 'clip-melody-b')!.patternId, changedInstanceIds: [`clip-melody-b@${content.patterns[content.clips.find((clip) => clip.id === 'clip-melody-b')!.patternId].notes[0].id}`], identifiedProperty: 'pitch' as const, explanation: 'Pitch change recorded for review.' }
    expect(session7Complete(base, context('s7'), project, content)).toBe(false)
    const before = content
    content = applyProjectGraphEdit(content, { type: 'set-note-pitch', instanceId: base.changedInstanceIds[0], pitch: 62 })
    project = { ...project, revision: 3, contentFingerprint: projectContentFingerprint(content) }
    expect(session7Complete({ ...base, project }, context('s7'), project, content)).toBe(true)
    expect(appendProjectCommand(emptyProjectHistory(), 'audible change', before, content, 'now').past).toHaveLength(1)
  })
})
