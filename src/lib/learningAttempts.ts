export const learningCycleStages = [
  'hear',
  'notice',
  'explain',
  'try',
  'choose',
  'apply',
  'independent-check',
  'reflect',
] as const

export type LearningCycleStage = typeof learningCycleStages[number]
export type LearningSupportLevel = 'none' | 'nudge' | 'cue' | 'example'
export type LearningAttemptOrigin = 'fresh' | 'legacy-unverified-proxy'
export type LearningAttemptResult = 'not-yet' | 'supported' | 'independent'

export interface LearningProjectReference {
  projectId: string
  revision: number
  contentFingerprint: string
}

export interface LearningSupportEvent {
  level: Exclude<LearningSupportLevel, 'none'>
  at: string
}

export interface LearningAttempt<TArtifact> {
  id: string
  objectiveId: string
  origin: LearningAttemptOrigin
  project: LearningProjectReference
  stage: LearningCycleStage
  generation: number
  support: LearningSupportEvent[]
  exampleClearedAt?: string
  artifact?: TArtifact
  explanation: string
  choice?: 'keep' | 'revise'
  reflection: string
  result: LearningAttemptResult
  startedAt: string
  updatedAt: string
}

export interface LearningAttemptHistory<TArtifact> {
  current: LearningAttempt<TArtifact>
  completed: LearningAttempt<TArtifact>[]
  earned?: EarnedLearningRecord<TArtifact>[]
}

export interface EarnedLearningRecord<TArtifact> {
  id: string
  objectiveId: string
  result: Exclude<LearningAttemptResult, 'not-yet'>
  earnedAt: string
  /** Immutable-by-contract snapshot. Never recompute this result against the mutable current project. */
  attemptSnapshot: LearningAttempt<TArtifact>
  projectSnapshot: LearningProjectReference
}

export function createLearningAttempt<TArtifact>(input: {
  id: string
  objectiveId: string
  project: LearningProjectReference
  now: string
  origin?: LearningAttemptOrigin
}): LearningAttempt<TArtifact> {
  return {
    id: input.id,
    objectiveId: input.objectiveId,
    origin: input.origin ?? 'fresh',
    project: { ...input.project },
    stage: 'hear',
    generation: 1,
    support: [],
    explanation: '',
    reflection: '',
    result: 'not-yet',
    startedAt: input.now,
    updatedAt: input.now,
  }
}

export function advanceLearningStage<TArtifact>(attempt: LearningAttempt<TArtifact>, next: LearningCycleStage, now: string): LearningAttempt<TArtifact> {
  const currentIndex = learningCycleStages.indexOf(attempt.stage)
  const nextIndex = learningCycleStages.indexOf(next)
  if (attempt.result !== 'not-yet' || nextIndex !== currentIndex + 1) return attempt
  return { ...attempt, stage: next, updatedAt: now }
}

export function recordLearningSupport<TArtifact>(
  attempt: LearningAttempt<TArtifact>,
  level: Exclude<LearningSupportLevel, 'none'>,
  now: string,
): LearningAttempt<TArtifact> {
  if (attempt.result !== 'not-yet') return attempt
  const support = [...attempt.support, { level, at: now }].slice(-20)
  return { ...attempt, support, updatedAt: now }
}

export function clearExampleForFreshRetry<TArtifact>(attempt: LearningAttempt<TArtifact>, now: string): LearningAttempt<TArtifact> {
  if (!attempt.support.some((event) => event.level === 'example') || attempt.result !== 'not-yet') return attempt
  return {
    ...attempt,
    stage: 'try',
    generation: attempt.generation + 1,
    exampleClearedAt: now,
    artifact: undefined,
    explanation: '',
    choice: undefined,
    reflection: '',
    updatedAt: now,
  }
}

export function updateLearningAttempt<TArtifact>(
  attempt: LearningAttempt<TArtifact>,
  update: Partial<Pick<LearningAttempt<TArtifact>, 'artifact' | 'explanation' | 'choice' | 'reflection'>>,
  now: string,
): LearningAttempt<TArtifact> {
  if (attempt.result !== 'not-yet') return attempt
  return { ...attempt, ...update, updatedAt: now }
}

export function finishLearningAttempt<TArtifact>(
  attempt: LearningAttempt<TArtifact>,
  passedDeterministicCheck: boolean,
  now: string,
): LearningAttempt<TArtifact> {
  if (!passedDeterministicCheck || attempt.result !== 'not-yet' || attempt.stage !== 'reflect' || attempt.origin !== 'fresh') return attempt
  const usedSupport = attempt.support.length > 0
  return {
    ...attempt,
    result: usedSupport ? 'supported' : 'independent',
    updatedAt: now,
  }
}

export function archiveAndRestartLearningAttempt<TArtifact>(
  history: LearningAttemptHistory<TArtifact>,
  next: LearningAttempt<TArtifact>,
): LearningAttemptHistory<TArtifact> {
  return {
    current: next,
    completed: [...history.completed, history.current].slice(-50),
    earned: history.earned?.map((record) => cloneJsonValue(record)),
  }
}

export function restartAfterExample<TArtifact>(
  history: LearningAttemptHistory<TArtifact>,
  input: { id: string; project: LearningProjectReference; now: string },
): LearningAttemptHistory<TArtifact> {
  if (!history.current.support.some((event) => event.level === 'example') || history.current.result !== 'not-yet') return history
  const completed = { ...history.current, exampleClearedAt: input.now, updatedAt: input.now }
  return {
    current: createLearningAttempt({ id: input.id, objectiveId: history.current.objectiveId, project: input.project, now: input.now }),
    completed: [...history.completed, completed].slice(-50),
    earned: history.earned?.map((record) => cloneJsonValue(record)),
  }
}

export function restartForLowerHelpAttempt<TArtifact>(
  history: LearningAttemptHistory<TArtifact>,
  input: { id: string; project: LearningProjectReference; now: string },
): LearningAttemptHistory<TArtifact> {
  if (history.current.support.length === 0 && history.current.result !== 'supported') return history
  return {
    current: createLearningAttempt({ id: input.id, objectiveId: history.current.objectiveId, project: input.project, now: input.now }),
    completed: [...history.completed, { ...history.current, updatedAt: input.now }].slice(-50),
    earned: history.earned?.map((record) => cloneJsonValue(record)),
  }
}

export function bestLearningEvidence<TArtifact>(history: LearningAttemptHistory<TArtifact>): LearningAttemptResult {
  if (history.earned?.some((record) => record.result === 'independent')) return 'independent'
  if (history.earned?.some((record) => record.result === 'supported')) return 'supported'
  const attempts = [...history.completed, history.current]
  if (attempts.some((attempt) => attempt.origin === 'fresh' && attempt.result === 'independent')) return 'independent'
  if (attempts.some((attempt) => attempt.origin === 'fresh' && attempt.result === 'supported')) return 'supported'
  return 'not-yet'
}

export function earnLearningRecord<TArtifact>(attempt: LearningAttempt<TArtifact>, earnedAt: string): EarnedLearningRecord<TArtifact> | null {
  if (attempt.origin !== 'fresh' || attempt.result === 'not-yet') return null
  const attemptSnapshot = cloneJsonValue(attempt)
  return {
    id: `earned:${attempt.id}:${attempt.generation}`,
    objectiveId: attempt.objectiveId,
    result: attempt.result,
    earnedAt,
    attemptSnapshot,
    projectSnapshot: { ...attemptSnapshot.project },
  }
}

export function addEarnedLearningRecord<TArtifact>(
  history: LearningAttemptHistory<TArtifact>,
  record: EarnedLearningRecord<TArtifact>,
): LearningAttemptHistory<TArtifact> {
  if (history.earned?.some((candidate) => candidate.id === record.id)) return history
  return { ...history, earned: [...(history.earned ?? []), cloneJsonValue(record)].slice(-50) }
}

export function attemptMatchesProject(
  attempt: LearningAttempt<unknown>,
  current: LearningProjectReference,
): boolean {
  return attempt.project.projectId === current.projectId && attempt.project.revision === current.revision &&
    attempt.project.contentFingerprint === current.contentFingerprint
}

export function highestSupportUsed(events: readonly LearningSupportEvent[]): LearningSupportLevel {
  const rank: Record<LearningSupportLevel, number> = { none: 0, nudge: 1, cue: 2, example: 3 }
  return events.reduce<LearningSupportLevel>((highest, event) => rank[event.level] > rank[highest] ? event.level : highest, 'none')
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)])) as T
  }
  return value
}
