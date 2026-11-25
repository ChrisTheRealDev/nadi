import { isAcknowledgedAuditionCompletionReceipt, isAcknowledgedPlaybackReceipt, type AuditionCompletionReceipt, type PlaybackReceipt } from './audio'
import type { LearningProjectReference, LearningSupportLevel } from './learningAttempts'
import type { ProjectCommand, ProjectCommandHistory, ProjectContent, ProjectPatternNote } from './projectModel'
import { projectContentFingerprint } from './projectModel'

export interface AttemptContext { attemptId: string; generation: number }
export interface CapturedNoteOccurrence { order: number; pitch: number; source: 'midi' | 'screen' | 'computer'; learnerAuthored: true; startTick?: number; velocity?: number }
export interface CapturedChordAttempt extends AttemptContext { takeId?: string; occurrences: CapturedNoteOccurrence[]; support: LearningSupportLevel }
export interface Session1SignalCheck extends AttemptContext {
  audioReady: boolean; pressReleaseCycles: number; audioSignals: number; silenceConfirmed: boolean
  freshRepair: { fault: 'audio-disabled' | 'input-route' | 'held-note'; predictedOutcome: string; before: { signalCount: number; silenceAfterRelease: boolean }; action: 'enable-audio' | 'use-screen-or-computer' | 'release-all-notes'; after: { signalCount: number; silenceAfterRelease: boolean } }
  hardwareVerification?: { physicalMidiCycles: number; noteOffsObserved: number; verifiedAt: string }
}
export interface Session2Check extends AttemptContext { tapTimesMs: number[]; chosenDownbeat: 1 | 2 | 3 | 4; freshBar: { beats: CapturedNoteOccurrence[]; explainedDownbeat: string; audition: { receipt: AuditionCompletionReceipt; currentAudioEpochAtValidation: number } } }
export interface Session3Check { construction: CapturedChordAttempt; freshRepair: CapturedChordAttempt; explanation: string }
export interface Session4Check {
  constructions: Record<'F' | 'C' | 'G', CapturedChordAttempt>
  freshRepair: CapturedChordAttempt & {
    target: 'F' | 'C' | 'G'
    challengeOccurrences: CapturedNoteOccurrence[]
  }
  moodContext: string
  explanation: string
  audition: { receipt: AuditionCompletionReceipt; currentAudioEpochAtValidation: number }
}
export interface CanonicalClipOperation { commandId: string; clipId: string; beforeStartTick: number; afterStartTick: number; beforeLengthTicks: number; afterLengthTicks: number }
export interface CanonicalUndoEvidence { undoneCommand: ProjectCommand; beforeUndoFingerprint: string; afterUndoFingerprint: string }
export interface Session5Check extends AttemptContext {
  project: LearningProjectReference; move: CanonicalClipOperation; resize: CanonicalClipOperation
  duplicate: { commandId: string; sourceClipId: string; createdClipId: string }; undo: CanonicalUndoEvidence
  freshDisplacedClipRepair: CanonicalClipOperation & AttemptContext & { challengeCommandId: string; challengeIntendedStartTick: number }; explanation: string
  audition: ValidatedPlaybackEvidence
}
export interface Session6Check extends AttemptContext {
  project: LearningProjectReference; intention: string; learnerAuthoredInstanceIds: string[]
  freshOneBarAnswer: { attemptId: string; generation: number; barStartTick: number; occurrences: CapturedNoteOccurrence[]; support: LearningSupportLevel }
  comparisonChoice: 'keep' | 'revise'; revision?: { commandId: string; instanceId: string }; explanation: string
}
export interface Session7Check extends AttemptContext {
  project: LearningProjectReference; aPatternId: string; aPrimePatternId: string; changedInstanceIds: string[]
  identifiedProperty: 'pitch' | 'rhythm' | 'register' | 'duration' | 'velocity' | 'space'; explanation: string
}
export interface SamplePeakMeasurement { kind: 'sample-peak'; project: LearningProjectReference; peakDbfs: number; measuredAt: string }
export interface ValidatedPlaybackEvidence { receipt: PlaybackReceipt; currentAudioEpochAtValidation: number }
export interface Session8Check extends AttemptContext {
  project: LearningProjectReference; controlExplanation: { velocity: string; gain: string; reverb: string; samplePeak: string }
  dryAudition: ValidatedPlaybackEvidence; wetAudition: ValidatedPlaybackEvidence; samplePeak: SamplePeakMeasurement
  freshMixRepair: { commandId: string; control: 'gain' | 'reverb'; before: number; after: number }
  finalAudition: ValidatedPlaybackEvidence; exportRequested: boolean
}
export interface TapMotorFeedback { intervalsMs: number[]; meanIntervalMs: number | null; maximumDeviationMs: number | null; measured: boolean; understandingGate: false }

const chordPitchClasses: Record<'Am' | 'F' | 'C' | 'G', number[]> = { Am: [0, 4, 9], F: [0, 5, 9], C: [0, 4, 7], G: [2, 7, 11] }

export function tapMotorFeedback(tapTimesMs: readonly number[]): TapMotorFeedback {
  if (tapTimesMs.length < 2 || tapTimesMs.some((time, index) => !Number.isFinite(time) || time < 0 || (index > 0 && time <= tapTimesMs[index - 1]))) return { intervalsMs: [], meanIntervalMs: null, maximumDeviationMs: null, measured: false, understandingGate: false }
  const intervalsMs = tapTimesMs.slice(1).map((time, index) => time - tapTimesMs[index])
  const meanIntervalMs = intervalsMs.reduce((sum, interval) => sum + interval, 0) / intervalsMs.length
  return { intervalsMs, meanIntervalMs, maximumDeviationMs: Math.max(...intervalsMs.map((interval) => Math.abs(interval - meanIntervalMs))), measured: true, understandingGate: false }
}

export function capturedChordMatches(attempt: CapturedChordAttempt, chord: keyof typeof chordPitchClasses, context: AttemptContext): boolean {
  if (!validAttempt(attempt, context) || !validOccurrences(attempt.occurrences) || attempt.occurrences.length < 3 || !validSupport(attempt.support)) return false
  const captured = [...new Set(attempt.occurrences.map((event) => modulo12(event.pitch)))].sort((a, b) => a - b)
  return arraysEqual(captured, chordPitchClasses[chord])
}

export function session1SignalComplete(check: Session1SignalCheck, context: AttemptContext): boolean {
  if (!validAttempt(check, context) || !check.audioReady || check.pressReleaseCycles < 3 || check.audioSignals < 3 || !check.silenceConfirmed || !recordedText(check.freshRepair.predictedOutcome)) return false
  const repair = check.freshRepair
  if (repair.fault === 'audio-disabled') return repair.action === 'enable-audio' && repair.before.signalCount === 0 && repair.after.signalCount > 0
  if (repair.fault === 'input-route') return repair.action === 'use-screen-or-computer' && repair.before.signalCount === 0 && repair.after.signalCount > 0
  return repair.action === 'release-all-notes' && !repair.before.silenceAfterRelease && repair.after.silenceAfterRelease
}
export function session1HardwareVerified(check: Session1SignalCheck): boolean { const hardware = check.hardwareVerification; return Boolean(hardware && hardware.physicalMidiCycles >= 3 && hardware.noteOffsObserved >= 3 && recordedText(hardware.verifiedAt)) }
export function session2Complete(check: Session2Check, context: AttemptContext): boolean {
  if (!validAttempt(check, context) || check.chosenDownbeat !== 1 || !recordedText(check.freshBar.explainedDownbeat) || !validOccurrences(check.freshBar.beats)) return false
  const beats = [...check.freshBar.beats].sort((a, b) => a.order - b.order)
  if (!(beats.length === 4 && beats.every((beat, index) => beat.startTick === index * 480 && typeof beat.velocity === 'number' && beat.velocity >= 1 && beat.velocity <= 127) && beats[0].velocity! > Math.max(...beats.slice(1).map((beat) => beat.velocity!)))) return false
  const receipt = check.freshBar.audition?.receipt
  return isAcknowledgedAuditionCompletionReceipt(receipt) && receipt.audioEpoch === check.freshBar.audition.currentAudioEpochAtValidation && receipt.bpm === 90 && receipt.meter === '4/4' &&
    receipt.scheduledNoteCount === 4 && receipt.artifact.kind === 'artifact' && receipt.artifact.attemptId === check.attemptId && receipt.artifact.generation === check.generation &&
    receipt.artifact.lengthTicks === 1_920 && receipt.artifact.fingerprint === session2ArtifactFingerprint(beats)
}

export function session2ArtifactFingerprint(beats: readonly CapturedNoteOccurrence[]): string {
  const serialized = JSON.stringify([...beats].sort((a, b) => a.order - b.order).map(({ order, pitch, source, learnerAuthored, startTick, velocity }) => ({ order, pitch, source, learnerAuthored, startTick, velocity })))
  return fnv1a32(serialized)
}
function fnv1a32(serialized: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) { hash ^= serialized.charCodeAt(index); hash = Math.imul(hash, 0x01000193) }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
export function session3Complete(check: Session3Check, constructionContext: AttemptContext, repairContext: AttemptContext): boolean { return capturedChordMatches(check.construction, 'Am', constructionContext) && capturedChordMatches(check.freshRepair, 'Am', repairContext) && check.construction.attemptId !== check.freshRepair.attemptId && recordedText(check.explanation) }
export function session4Complete(check: Session4Check, contexts: Record<'F' | 'C' | 'G', AttemptContext> & { repair: AttemptContext }): boolean {
  const challenge = check.freshRepair.challengeOccurrences
  const deliberateBrokenG = validOccurrences(challenge) && challenge.length === 3 && arraysEqual(challenge.map((event) => event.pitch), [55, 59, 61])
  if (!(capturedChordMatches(check.constructions.F, 'F', contexts.F) && capturedChordMatches(check.constructions.C, 'C', contexts.C) && capturedChordMatches(check.constructions.G, 'G', contexts.G) && check.freshRepair.target === 'G' && deliberateBrokenG && !capturedChordMatches({ ...check.freshRepair, occurrences: challenge }, 'G', contexts.repair) && capturedChordMatches(check.freshRepair, 'G', contexts.repair) && !Object.values(check.constructions).some((attempt) => attempt.attemptId === check.freshRepair.attemptId) && recordedText(check.moodContext) && recordedText(check.explanation))) return false
  const receipt = check.audition?.receipt
  const rootAttemptId = contexts.F.attemptId.endsWith(':F') ? contexts.F.attemptId.slice(0, -2) : ''
  return isAcknowledgedAuditionCompletionReceipt(receipt) && receipt.audioEpoch === check.audition.currentAudioEpochAtValidation && receipt.bpm === 90 && receipt.scheduledNoteCount === 12 && receipt.artifact.kind === 'artifact' && receipt.artifact.attemptId === rootAttemptId && receipt.artifact.generation === contexts.F.generation && receipt.artifact.lengthTicks === 1_920 && receipt.artifact.fingerprint === session4ArtifactFingerprint(check)
}
export function session4ArtifactFingerprint(check: Pick<Session4Check, 'constructions' | 'freshRepair'>): string {
  const keys = ['F', 'C', 'G', 'repair'] as const
  return fnv1a32(JSON.stringify(keys.map((key) => {
    const chord = key === 'repair' ? check.freshRepair : check.constructions[key]
    return {
      occurrences: chord.occurrences.map(({ order, pitch, source, learnerAuthored }) => ({ order, pitch, source, learnerAuthored })),
      ...(key === 'repair' ? { challengeOccurrences: check.freshRepair.challengeOccurrences.map(({ order, pitch, source, learnerAuthored }) => ({ order, pitch, source, learnerAuthored })) } : {}),
    }
  })))
}

export function session5Complete(check: Session5Check, contexts: { main: AttemptContext; repair: AttemptContext }, actual: LearningProjectReference, content: ProjectContent, history: ProjectCommandHistory): boolean {
  if (!validAttempt(check, contexts.main) || !validAttempt(check.freshDisplacedClipRepair, contexts.repair) || !currentProject(check.project, actual, content) || content.lengthTicks !== 15_360 || !hasEightBarArrangement(content) || !recordedText(check.explanation)) return false
  const ids = [check.move.commandId, check.resize.commandId, check.duplicate.commandId, check.freshDisplacedClipRepair.challengeCommandId, check.freshDisplacedClipRepair.commandId]
  if (new Set(ids).size !== ids.length) return false
  const move = history.past.find((command) => command.id === check.move.commandId); const resize = check.undo.undoneCommand
  const duplicate = history.past.find((command) => command.id === check.duplicate.commandId); const challenge = history.past.find((command) => command.id === check.freshDisplacedClipRepair.challengeCommandId); const repair = history.past.find((command) => command.id === check.freshDisplacedClipRepair.commandId)
  const undone = check.undo.undoneCommand
  return Boolean(move && verifiesClipOperation(move, check.move, 'move') && resize && verifiesClipOperation(resize, check.resize, 'resize') && duplicate && verifiesDuplicate(duplicate, check.duplicate) &&
    undone.id === check.resize.commandId && projectContentFingerprint(undone.after) === check.undo.beforeUndoFingerprint && projectContentFingerprint(undone.before) === check.undo.afterUndoFingerprint &&
    check.undo.beforeUndoFingerprint !== check.undo.afterUndoFingerprint && challenge && verifiesClipOperation(challenge, { ...check.freshDisplacedClipRepair, beforeStartTick: check.freshDisplacedClipRepair.challengeIntendedStartTick, afterStartTick: check.freshDisplacedClipRepair.beforeStartTick }, 'move') &&
    repair && verifiesClipOperation(repair, check.freshDisplacedClipRepair, 'move') && check.freshDisplacedClipRepair.afterStartTick === check.freshDisplacedClipRepair.challengeIntendedStartTick &&
    validPlayback(check.audition, check.project, content, 15_360))
}

export function session6Complete(check: Session6Check, contexts: { main: AttemptContext; answer: AttemptContext }, actual: LearningProjectReference, content: ProjectContent, history: ProjectCommandHistory): boolean {
  if (!validAttempt(check, contexts.main) || !currentProject(check.project, actual, content) || !recordedText(check.intention) || !recordedText(check.explanation)) return false
  if (!check.learnerAuthoredInstanceIds.length || !check.learnerAuthoredInstanceIds.every((id) => learnerOwnedInstance(content, id))) return false
  const answer = check.freshOneBarAnswer
  if (!validAttempt(answer, contexts.answer) || !validOccurrences(answer.occurrences) || !answer.occurrences.length || !validSupport(answer.support)) return false
  if (answer.occurrences.some((note) => note.startTick === undefined || note.startTick < answer.barStartTick || note.startTick >= answer.barStartTick + 1_920)) return false
  if (check.comparisonChoice === 'keep') return check.revision === undefined
  const command = check.revision && history.past.find((item) => item.id === check.revision?.commandId)
  return Boolean(command && check.revision && learnerOwnedInstance(command.before, check.revision.instanceId) && changedInstance(command, check.revision.instanceId))
}

export function session7Complete(check: Session7Check, context: AttemptContext, actual: LearningProjectReference, content: ProjectContent): boolean {
  if (!validAttempt(check, context) || !currentProject(check.project, actual, content) || !check.changedInstanceIds.length || !recordedText(check.explanation)) return false
  const a = content.patterns[check.aPatternId]; const aPrime = content.patterns[check.aPrimePatternId]
  if (!a || !aPrime || a.id === aPrime.id || !check.changedInstanceIds.every((id) => learnerOwnedInstance(content, id))) return false
  const changes = audiblePropertiesChanged(a.notes, aPrime.notes)
  return changes.has(check.identifiedProperty) && check.changedInstanceIds.every((id) => changedInstanceSupportsProperty(content, id, a.notes, check.identifiedProperty))
}

export function session8Complete(check: Session8Check, context: AttemptContext, actual: LearningProjectReference, content: ProjectContent, history: ProjectCommandHistory): boolean {
  if (!validAttempt(check, context) || !currentProject(check.project, actual, content) || !Object.values(check.controlExplanation).every(recordedText)) return false
  if (!validPlayback(check.dryAudition, check.project, content, 15_360) || !validPlayback(check.wetAudition, check.project, content, 15_360) || !validPlayback(check.finalAudition, check.project, content, 15_360)) return false
  if (check.dryAudition.receipt.runId === check.wetAudition.receipt.runId || check.dryAudition.receipt.renderConfiguration.channels['channel-melody']?.reverbSend !== 0 || Number(check.wetAudition.receipt.renderConfiguration.channels['channel-melody']?.reverbSend) <= 0) return false
  if (check.samplePeak.kind !== 'sample-peak' || !Number.isFinite(check.samplePeak.peakDbfs) || check.samplePeak.peakDbfs > 0 || !sameReference(check.samplePeak.project, check.project)) return false
  const command = history.past.find((item) => item.id === check.freshMixRepair.commandId)
  return Boolean(command && check.freshMixRepair.before !== check.freshMixRepair.after && verifiesMixCommand(command, check.freshMixRepair))
}

export function currentProject(reference: LearningProjectReference, actual: LearningProjectReference, content: ProjectContent): boolean { return sameReference(reference, actual) && actual.contentFingerprint === projectContentFingerprint(content) }

function validPlayback(evidence: ValidatedPlaybackEvidence, project: LearningProjectReference, content: ProjectContent, endTick: number): boolean {
  const receipt = evidence.receipt
  if (!isAcknowledgedPlaybackReceipt(receipt)) return false
  return receipt.projectId === project.projectId && receipt.projectRevision === project.revision && receipt.projectContentFingerprint === project.contentFingerprint && receipt.audioEpoch === evidence.currentAudioEpochAtValidation && receipt.sequenceStartTick >= 0 && receipt.sequenceEndTick === endTick && receipt.renderConfiguration.bpm === content.bpm && receipt.renderConfiguration.meter === content.meter
}
function validAttempt(value: AttemptContext, expected: AttemptContext): boolean { return value.attemptId === expected.attemptId && value.generation === expected.generation && /^[A-Za-z0-9:._-]{1,100}$/.test(value.attemptId) && Number.isSafeInteger(value.generation) && value.generation >= 1 }
function validOccurrences(events: CapturedNoteOccurrence[]): boolean { return events.length <= 128 && events.every((event, index) => event.learnerAuthored === true && Number.isInteger(event.order) && event.order === index && Number.isInteger(event.pitch) && event.pitch >= 0 && event.pitch <= 127 && ['midi', 'screen', 'computer'].includes(event.source) && (event.startTick === undefined || (Number.isInteger(event.startTick) && event.startTick >= 0 && event.startTick < 15_360)) && (event.velocity === undefined || (Number.isInteger(event.velocity) && event.velocity >= 1 && event.velocity <= 127))) }
function validSupport(value: unknown): value is LearningSupportLevel { return ['none', 'nudge', 'cue', 'example'].includes(String(value)) }
function hasEightBarArrangement(content: ProjectContent): boolean {
  return Array.from({ length: 8 }, (_, bar) => bar * 1_920).every((startTick) => content.clips.some((clip) => {
    const pattern = content.patterns[clip.patternId]
    return clip.startTick === startTick && clip.lengthTicks >= 1_920 && pattern?.notes.some((note) => note.channelId === 'channel-chords' &&
      note.startTick < clip.offsetTick + clip.lengthTicks && note.startTick + note.durationTicks > clip.offsetTick)
  }))
}
function verifiesClipOperation(command: ProjectCommand, evidence: CanonicalClipOperation, kind: 'move' | 'resize'): boolean { const before = command.before.clips.find((clip) => clip.id === evidence.clipId); const after = command.after.clips.find((clip) => clip.id === evidence.clipId); if (!before || !after || before.patternId !== after.patternId || before.startTick !== evidence.beforeStartTick || after.startTick !== evidence.afterStartTick || before.lengthTicks !== evidence.beforeLengthTicks || after.lengthTicks !== evidence.afterLengthTicks) return false; return kind === 'move' ? before.startTick !== after.startTick && before.lengthTicks === after.lengthTicks : before.startTick === after.startTick && before.lengthTicks !== after.lengthTicks }
function verifiesDuplicate(command: ProjectCommand, evidence: Session5Check['duplicate']): boolean { const source = command.before.clips.find((clip) => clip.id === evidence.sourceClipId); const createdBefore = command.before.clips.find((clip) => clip.id === evidence.createdClipId); const created = command.after.clips.find((clip) => clip.id === evidence.createdClipId); return Boolean(source && !createdBefore && created && created.patternId === source.patternId && created.originClipId === source.id) }
function verifiesMixCommand(command: ProjectCommand, evidence: Session8Check['freshMixRepair']): boolean { const before = command.before.channels['channel-melody']; const after = command.after.channels['channel-melody']; return evidence.control === 'gain' ? before.gain === evidence.before && after.gain === evidence.after && before.reverbSend === after.reverbSend : before.reverbSend === evidence.before && after.reverbSend === evidence.after && before.gain === after.gain }
function learnerOwnedInstance(content: ProjectContent, instanceId: string): boolean { const separator = instanceId.indexOf('@'); const clip = separator > 0 ? content.clips.find((item) => item.id === instanceId.slice(0, separator)) : content.clips.find((item) => content.patterns[item.patternId]?.notes.some((note) => note.id === instanceId)); const noteId = separator > 0 ? instanceId.slice(separator + 1) : instanceId; const note = clip && content.patterns[clip.patternId]?.notes.find((item) => item.id === noteId); return Boolean(note && ['draw', 'screen', 'computer', 'midi'].includes(note.source)) }
function changedInstance(command: ProjectCommand, instanceId: string): boolean {
  const before = resolveNote(command.before, instanceId)
  const after = resolveNote(command.after, instanceId)
  return Boolean(before && after && ['draw', 'screen', 'computer', 'midi'].includes(before.source) &&
    (before.pitch !== after.pitch || before.startTick !== after.startTick || before.durationTicks !== after.durationTicks || before.velocity !== after.velocity))
}
function audiblePropertiesChanged(a: ProjectPatternNote[], b: ProjectPatternNote[]): Set<Session7Check['identifiedProperty']> {
  const result = new Set<Session7Check['identifiedProperty']>(); const left = [...a].sort(noteOrder); const right = [...b].sort(noteOrder)
  if (left.length !== right.length) result.add('space')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index]; const y = right[index]; if (!x || !y) continue
    if (x.pitch !== y.pitch) result.add('pitch')
    if (modulo12(x.pitch) === modulo12(y.pitch) && Math.floor(x.pitch / 12) !== Math.floor(y.pitch / 12)) result.add('register')
    if (x.startTick !== y.startTick) result.add('rhythm')
    if (x.durationTicks !== y.durationTicks) result.add('duration')
    if (x.velocity !== y.velocity) result.add('velocity')
  }
  return result
}
function changedInstanceSupportsProperty(content: ProjectContent, instanceId: string, originals: ProjectPatternNote[], property: Session7Check['identifiedProperty']): boolean {
  const changed = resolveNote(content, instanceId)
  if (!changed) return false
  const original = originals.find((note) => note.id === changed.originNoteId) ?? originals.find((note) => note.id === changed.id)
  if (property === 'space') return !original || originals.length !== content.patterns[content.clips.find((clip) => instanceId.startsWith(`${clip.id}@`))?.patternId ?? '']?.notes.length
  if (!original) return false
  if (property === 'pitch') return original.pitch !== changed.pitch
  if (property === 'register') return modulo12(original.pitch) === modulo12(changed.pitch) && Math.floor(original.pitch / 12) !== Math.floor(changed.pitch / 12)
  if (property === 'rhythm') return original.startTick !== changed.startTick
  if (property === 'duration') return original.durationTicks !== changed.durationTicks
  return original.velocity !== changed.velocity
}
function resolveNote(content: ProjectContent, instanceId: string): ProjectPatternNote | undefined {
  const separator = instanceId.indexOf('@')
  if (separator <= 0) return undefined
  const clip = content.clips.find((item) => item.id === instanceId.slice(0, separator))
  return clip ? content.patterns[clip.patternId]?.notes.find((note) => note.id === instanceId.slice(separator + 1)) : undefined
}
function noteOrder(a: ProjectPatternNote, b: ProjectPatternNote): number { return a.startTick - b.startTick || a.pitch - b.pitch || a.durationTicks - b.durationTicks }
function sameReference(left: LearningProjectReference, right: LearningProjectReference): boolean { return left.projectId === right.projectId && left.revision === right.revision && left.contentFingerprint === right.contentFingerprint }
function recordedText(value: string): boolean { return value.trim().length >= 3 && value.trim().length <= 500 }
function modulo12(value: number): number { return ((value % 12) + 12) % 12 }
function arraysEqual(left: readonly number[], right: readonly number[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]) }
