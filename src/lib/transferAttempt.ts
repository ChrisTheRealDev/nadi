import { TICKS_PER_BAR } from './melodyEvents'
import {
  cloneProjectContent,
  createProjectContent,
  emptyProjectHistory,
  projectContentFingerprint,
  type ProjectCommandHistory,
  type ProjectContent,
} from './projectModel'
import type { EarnedLearningRecord, LearningAttempt, LearningProjectReference, LearningSupportLevel } from './learningAttempts'

export type TransferObservation = 'self-reported' | 'app-observed' | 'educator-observed'
export type FlTransferStep = 'import' | 'find-notes' | 'place-pattern' | 'make-new-edit' | 'route' | 'set-gain'

export interface FlTransferStepEvidence {
  step: FlTransferStep
  observation: TransferObservation
  support: LearningSupportLevel
  observedAt: string
}

export interface FlTransferEvidence {
  steps: Partial<Record<FlTransferStep, FlTransferStepEvidence>>
  exportedAt?: string
}

export interface TransferAttempt {
  id: string
  finalProjectId: string
  projectId: string
  revision: number
  content: ProjectContent
  history: ProjectCommandHistory
  rawTakeIds: string[]
  learning: LearningAttempt<TransferArtifact>
  earned: EarnedLearningRecord<TransferArtifact>[]
  flWorkflow: FlTransferEvidence
  createdAt: string
  updatedAt: string
}

export interface TransferArtifact {
  learnerAuthoredMelodyInstanceIds: string[]
  authoredCommandIds: string[]
  explanation: string
}

export interface FlTransferSummary {
  complete: boolean
  independent: boolean
  assisted: boolean
  selfReportedSteps: FlTransferStep[]
  appObservedSteps: FlTransferStep[]
  educatorObservedSteps: FlTransferStep[]
}

export const transferTaskPrompt = 'Start with a fresh blank two-bar scratch project. Write your own melody across bar 1 (Am) and bar 2 (F). You may leave space; there is no required note count.'

const flTransferSteps: FlTransferStep[] = ['import', 'find-notes', 'place-pattern', 'make-new-edit', 'route', 'set-gain']

export function createBlankAmFTransferAttempt(input: {
  id: string
  projectId: string
  finalProjectId: string
  now: string
}): TransferAttempt {
  if (input.projectId === input.finalProjectId) throw new Error('Transfer project must be distinct from the final eight-bar project.')
  const content = createProjectContent()
  content.lengthTicks = TICKS_PER_BAR * 2
  content.patterns = {}
  content.clips = []
  const reference = transferProjectReference(input.projectId, 0, content)
  return {
    id: input.id,
    finalProjectId: input.finalProjectId,
    projectId: input.projectId,
    revision: 0,
    content,
    history: emptyProjectHistory(),
    rawTakeIds: [],
    learning: {
      id: `${input.id}:learning`, objectiveId: 'transfer-am-f', origin: 'fresh', project: reference,
      stage: 'hear', generation: 1, support: [], explanation: '', reflection: '', result: 'not-yet',
      startedAt: input.now, updatedAt: input.now,
    },
    earned: [],
    flWorkflow: { steps: {} },
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function updateTransferProject(
  attempt: TransferAttempt,
  content: ProjectContent,
  history: ProjectCommandHistory,
  now: string,
): TransferAttempt {
  if (content.lengthTicks !== TICKS_PER_BAR * 2) return attempt
  const revision = attempt.revision + 1
  const snapshot = cloneProjectContent(content)
  return {
    ...attempt,
    revision,
    content: snapshot,
    history,
    learning: { ...attempt.learning, project: transferProjectReference(attempt.projectId, revision, snapshot), updatedAt: now },
    updatedAt: now,
  }
}

export function transferArtifactComplete(attempt: TransferAttempt, artifact: TransferArtifact): boolean {
  if (attempt.projectId === attempt.finalProjectId || attempt.content.lengthTicks !== TICKS_PER_BAR * 2 || artifact.explanation.trim().length < 3) return false
  if (!artifact.learnerAuthoredMelodyInstanceIds.length || !artifact.learnerAuthoredMelodyInstanceIds.every((id) => learnerOwnedVisibleMelodyInstance(attempt.content, id))) return false
  const commands = artifact.authoredCommandIds.map((id) => attempt.history.past.find((command) => command.id === id))
  if (!commands.length || commands.some((command) => !command) || new Set(artifact.authoredCommandIds).size !== artifact.authoredCommandIds.length) return false
  return commands.every((command) => command && projectContentFingerprint(command.before) !== projectContentFingerprint(command.after) &&
    artifact.learnerAuthoredMelodyInstanceIds.some((id) => !learnerOwnedVisibleMelodyInstance(command.before, id) && learnerOwnedVisibleMelodyInstance(command.after, id)))
}

export function recordFlTransferStep(
  evidence: FlTransferEvidence,
  next: FlTransferStepEvidence,
): FlTransferEvidence {
  return { ...evidence, steps: { ...evidence.steps, [next.step]: { ...next } } }
}

export function summarizeFlTransfer(evidence: FlTransferEvidence): FlTransferSummary {
  const present = flTransferSteps.map((step) => evidence.steps[step]).filter((item): item is FlTransferStepEvidence => Boolean(item))
  const complete = present.length === flTransferSteps.length
  const assisted = present.some((item) => item.support !== 'none')
  return {
    complete,
    independent: complete && !assisted && present.every((item) => item.observation === 'app-observed' || item.observation === 'educator-observed'),
    assisted,
    selfReportedSteps: present.filter((item) => item.observation === 'self-reported').map((item) => item.step),
    appObservedSteps: present.filter((item) => item.observation === 'app-observed').map((item) => item.step),
    educatorObservedSteps: present.filter((item) => item.observation === 'educator-observed').map((item) => item.step),
  }
}

export function transferProjectReference(projectId: string, revision: number, content: ProjectContent): LearningProjectReference {
  return { projectId, revision, contentFingerprint: projectContentFingerprint(content) }
}

function learnerOwnedVisibleMelodyInstance(content: ProjectContent, instanceId: string): boolean {
  const separator = instanceId.indexOf('@')
  if (separator <= 0) return false
  const clip = content.clips.find((item) => item.id === instanceId.slice(0, separator))
  const note = clip && content.patterns[clip.patternId]?.notes.find((item) => item.id === instanceId.slice(separator + 1))
  if (!clip || !note || note.channelId !== 'channel-melody' || !['draw', 'screen', 'computer', 'midi'].includes(note.source)) return false
  const visibleStart = clip.startTick + Math.max(note.startTick, clip.offsetTick) - clip.offsetTick
  const visibleEnd = clip.startTick + Math.min(note.startTick + note.durationTicks, clip.offsetTick + clip.lengthTicks) - clip.offsetTick
  return visibleEnd > visibleStart && visibleStart >= 0 && visibleEnd <= content.lengthTicks
}
