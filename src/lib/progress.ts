import type {
  InputSource,
  SessionEvidence,
  SessionProgress,
  Settings,
} from '../types'
import { addCapturedNote, isAMinor } from './chord'

const stages = [
  'welcome',
  'recall',
  'explore',
  'learn',
  'practice',
  'apply',
  'check',
  'evidence',
] as const

export const defaultSettings: Settings = {
  version: 1,
  theme: 'midnight',
  textSize: 'comfortable',
  reduceMotion: false,
  showNoteNames: true,
  highContrast: false,
  breakReminders: true,
  countIn: true,
  showEstimates: true,
}

export function createInitialEvidence(): SessionEvidence {
  return {
    recall: { taps: 0 },
    explore: { heardMinor: false, heardMajor: false },
    learn: { heardSeparate: false, heardTogether: false },
    practice: { notes: [], inputEvents: 0, hintsUsed: 0 },
    apply: { notes: [], editEvents: 0, playedBack: false },
    check: { notes: [], inputEvents: 0, hintsUsed: 0 },
  }
}

export function createInitialProgress(now = new Date().toISOString()): SessionProgress {
  return {
    version: 1,
    stage: 'welcome',
    evidence: createInitialEvidence(),
    updatedAt: now,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNotes(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((note): note is number => typeof note === 'number' && Number.isFinite(note))
    .map((note) => Math.round(note))
    .slice(0, 12)
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function normalizeProgress(
  value: unknown,
  now = new Date().toISOString(),
): SessionProgress {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.evidence)) {
    return createInitialProgress(now)
  }

  const rawEvidence = value.evidence
  const rawRecall = isRecord(rawEvidence.recall) ? rawEvidence.recall : {}
  const rawExplore = isRecord(rawEvidence.explore) ? rawEvidence.explore : {}
  const rawLearn = isRecord(rawEvidence.learn) ? rawEvidence.learn : {}
  const rawPractice = isRecord(rawEvidence.practice) ? rawEvidence.practice : {}
  const rawApply = isRecord(rawEvidence.apply) ? rawEvidence.apply : {}
  const rawCheck = isRecord(rawEvidence.check) ? rawEvidence.check : {}

  const practiceNotes = finiteNotes(rawPractice.notes)
  const practiceEvents = finiteCount(rawPractice.inputEvents)
  const practiceComplete =
    isAMinor(practiceNotes) &&
    practiceEvents >= 3 &&
    Boolean(optionalString(rawPractice.completedAt))
  const applyNotes = finiteNotes(rawApply.notes)
  const applyEdits = finiteCount(rawApply.editEvents)
  const applyPlayed = rawApply.playedBack === true
  const applyComplete =
    isAMinor(applyNotes) &&
    applyEdits >= 3 &&
    applyPlayed &&
    Boolean(optionalString(rawApply.completedAt))
  const checkNotes = finiteNotes(rawCheck.notes)
  const checkEvents = finiteCount(rawCheck.inputEvents)
  const checkComplete =
    isAMinor(checkNotes) &&
    checkEvents >= 3 &&
    Boolean(optionalString(rawCheck.completedAt))

  const inputSources = ['screen', 'computer', 'midi'] as const
  const source = (raw: Record<string, unknown>) =>
    inputSources.includes(raw.source as (typeof inputSources)[number])
      ? (raw.source as (typeof inputSources)[number])
      : undefined

  const evidence: SessionEvidence = {
    recall: {
      taps: Math.min(4, finiteCount(rawRecall.taps)),
      completedAt:
        finiteCount(rawRecall.taps) >= 4
          ? optionalString(rawRecall.completedAt)
          : undefined,
    },
    explore: {
      heardMinor: rawExplore.heardMinor === true,
      heardMajor: rawExplore.heardMajor === true,
      choice:
        rawExplore.choice === 'minor' || rawExplore.choice === 'major'
          ? rawExplore.choice
          : undefined,
      completedAt:
        rawExplore.heardMinor === true &&
        rawExplore.heardMajor === true &&
        (rawExplore.choice === 'minor' || rawExplore.choice === 'major')
          ? optionalString(rawExplore.completedAt)
          : undefined,
    },
    learn: {
      heardSeparate: rawLearn.heardSeparate === true,
      heardTogether: rawLearn.heardTogether === true,
      completedAt:
        rawLearn.heardSeparate === true && rawLearn.heardTogether === true
          ? optionalString(rawLearn.completedAt)
          : undefined,
    },
    practice: {
      notes: practiceNotes,
      inputEvents: practiceEvents,
      source: source(rawPractice),
      hintsUsed: finiteCount(rawPractice.hintsUsed),
      completedAt: practiceComplete
        ? optionalString(rawPractice.completedAt)
        : undefined,
    },
    apply: {
      notes: applyNotes,
      editEvents: applyEdits,
      playedBack: applyPlayed,
      completedAt: applyComplete ? optionalString(rawApply.completedAt) : undefined,
    },
    check: {
      notes: checkNotes,
      inputEvents: checkEvents,
      source: source(rawCheck),
      hintsUsed: finiteCount(rawCheck.hintsUsed),
      completedAt: checkComplete ? optionalString(rawCheck.completedAt) : undefined,
    },
    reflection:
      typeof rawEvidence.reflection === 'string'
        ? rawEvidence.reflection.slice(0, 240)
        : undefined,
  }

  const requestedStage = stages.includes(value.stage as (typeof stages)[number])
    ? (value.stage as SessionProgress['stage'])
    : 'welcome'
  let maxStageIndex = 1
  const recallComplete = Boolean(evidence.recall.completedAt)
  const exploreComplete = recallComplete && Boolean(evidence.explore.completedAt)
  const learnComplete = exploreComplete && Boolean(evidence.learn.completedAt)
  const safePracticeComplete = learnComplete && practiceComplete
  const safeApplyComplete = safePracticeComplete && applyComplete
  const safeCheckComplete = safeApplyComplete && checkComplete
  if (!recallComplete) {
    evidence.explore = { heardMinor: false, heardMajor: false }
    evidence.learn = { heardSeparate: false, heardTogether: false }
    evidence.practice = { notes: [], inputEvents: 0, hintsUsed: 0 }
    evidence.apply = { notes: [], editEvents: 0, playedBack: false }
    evidence.check = { notes: [], inputEvents: 0, hintsUsed: 0 }
  } else if (!exploreComplete) {
    evidence.learn = { heardSeparate: false, heardTogether: false }
    evidence.practice = { notes: [], inputEvents: 0, hintsUsed: 0 }
    evidence.apply = { notes: [], editEvents: 0, playedBack: false }
    evidence.check = { notes: [], inputEvents: 0, hintsUsed: 0 }
  } else if (!learnComplete) {
    evidence.practice = { notes: [], inputEvents: 0, hintsUsed: 0 }
    evidence.apply = { notes: [], editEvents: 0, playedBack: false }
    evidence.check = { notes: [], inputEvents: 0, hintsUsed: 0 }
  } else if (!safePracticeComplete) {
    evidence.apply = { notes: [], editEvents: 0, playedBack: false }
    evidence.check = { notes: [], inputEvents: 0, hintsUsed: 0 }
  } else if (!safeApplyComplete) {
    evidence.check = { notes: [], inputEvents: 0, hintsUsed: 0 }
  }
  if (recallComplete) maxStageIndex = 2
  if (exploreComplete) maxStageIndex = 3
  if (learnComplete) maxStageIndex = 4
  if (safePracticeComplete) maxStageIndex = 5
  if (safeApplyComplete) maxStageIndex = 6

  const rawCheckpoint = isRecord(value.checkpoint) ? value.checkpoint : undefined
  const hasCheckpoint =
    safeCheckComplete &&
    rawCheckpoint?.name === 'harmony-a-complete' &&
    Boolean(optionalString(rawCheckpoint.savedAt))
  if (hasCheckpoint) maxStageIndex = 7

  const requestedIndex = stages.indexOf(requestedStage)
  const safeStage = stages[
    requestedStage === 'welcome'
      ? 0
      : Math.min(Math.max(1, requestedIndex), maxStageIndex)
  ]

  return {
    version: 1,
    stage: safeStage,
    evidence,
    checkpoint: hasCheckpoint
      ? {
          name: 'harmony-a-complete',
          savedAt: rawCheckpoint?.savedAt as string,
        }
      : undefined,
    updatedAt: optionalString(value.updatedAt) ?? now,
  }
}

export type ProgressAction =
  | { type: 'START_RECALL' }
  | { type: 'RECALL_TAP'; now?: string }
  | { type: 'HEARD_COMPARISON'; mode: 'minor' | 'major'; now?: string }
  | { type: 'CHOOSE_COMPARISON'; choice: 'minor' | 'major'; now?: string }
  | { type: 'HEARD_LESSON'; mode: 'separate' | 'together'; now?: string }
  | { type: 'GO_PRACTICE' }
  | { type: 'PRACTICE_NOTE'; note: number; source: InputSource; now?: string }
  | { type: 'PRACTICE_CLEAR' }
  | { type: 'PRACTICE_HINT' }
  | { type: 'GO_APPLY' }
  | { type: 'APPLY_TOGGLE'; note: number; now?: string }
  | { type: 'APPLY_PLAYED'; now?: string }
  | { type: 'GO_CHECK' }
  | { type: 'CHECK_NOTE'; note: number; source: InputSource; now?: string }
  | { type: 'CHECK_CLEAR' }
  | { type: 'CHECK_HINT' }
  | { type: 'FINALIZE'; now?: string }
  | { type: 'SET_REFLECTION'; value: string }
  | { type: 'RESET_SESSION'; now?: string }

function stamp(now?: string): string {
  return now ?? new Date().toISOString()
}

export function canCompleteSession(progress: SessionProgress): boolean {
  const { practice, apply, check } = progress.evidence
  return (
    isAMinor(practice.notes) &&
    practice.inputEvents >= 3 &&
    Boolean(practice.completedAt) &&
    isAMinor(apply.notes) &&
    apply.editEvents >= 3 &&
    apply.playedBack &&
    Boolean(apply.completedAt) &&
    isAMinor(check.notes) &&
    check.inputEvents >= 3 &&
    Boolean(check.completedAt)
  )
}

export function isSessionComplete(progress: SessionProgress): boolean {
  return (
    progress.checkpoint?.name === 'harmony-a-complete' &&
    canCompleteSession(progress)
  )
}

export function sessionEvidenceLevel(progress: SessionProgress) {
  if (!canCompleteSession(progress)) return 'not-tried' as const
  if (!isSessionComplete(progress)) return 'demonstrated' as const
  return progress.evidence.check.hintsUsed > 0
    ? ('with-guidance' as const)
    : ('independent' as const)
}

export function progressReducer(
  progress: SessionProgress,
  action: ProgressAction,
): SessionProgress {
  const updatedAt = stamp('now' in action ? action.now : undefined)
  const evidence = progress.evidence

  switch (action.type) {
    case 'START_RECALL':
      return { ...progress, stage: 'recall', updatedAt }

    case 'RECALL_TAP': {
      if (progress.stage !== 'recall') return progress
      const taps = Math.min(4, evidence.recall.taps + 1)
      const complete = taps === 4
      return {
        ...progress,
        stage: complete ? 'explore' : 'recall',
        evidence: {
          ...evidence,
          recall: {
            taps,
            completedAt: complete ? updatedAt : undefined,
          },
        },
        updatedAt,
      }
    }

    case 'HEARD_COMPARISON': {
      if (progress.stage !== 'explore') return progress
      const explore = {
        ...evidence.explore,
        heardMinor:
          evidence.explore.heardMinor || action.mode === 'minor',
        heardMajor:
          evidence.explore.heardMajor || action.mode === 'major',
      }
      return {
        ...progress,
        evidence: { ...evidence, explore },
        updatedAt,
      }
    }

    case 'CHOOSE_COMPARISON': {
      if (
        progress.stage !== 'explore' ||
        !evidence.explore.heardMinor ||
        !evidence.explore.heardMajor
      ) {
        return progress
      }
      return {
        ...progress,
        stage: 'learn',
        evidence: {
          ...evidence,
          explore: {
            ...evidence.explore,
            choice: action.choice,
            completedAt: updatedAt,
          },
        },
        updatedAt,
      }
    }

    case 'HEARD_LESSON': {
      if (progress.stage !== 'learn') return progress
      const learn = {
        ...evidence.learn,
        heardSeparate:
          evidence.learn.heardSeparate || action.mode === 'separate',
        heardTogether:
          evidence.learn.heardTogether || action.mode === 'together',
      }
      const complete = learn.heardSeparate && learn.heardTogether
      return {
        ...progress,
        evidence: {
          ...evidence,
          learn: {
            ...learn,
            completedAt: complete ? updatedAt : undefined,
          },
        },
        updatedAt,
      }
    }

    case 'GO_PRACTICE':
      if (
        progress.stage !== 'learn' ||
        !evidence.learn.heardSeparate ||
        !evidence.learn.heardTogether
      ) {
        return progress
      }
      return { ...progress, stage: 'practice', updatedAt }

    case 'PRACTICE_NOTE': {
      if (progress.stage !== 'practice') return progress
      const notes = addCapturedNote(evidence.practice.notes, action.note)
      const inputEvents = evidence.practice.inputEvents + 1
      const completedAt =
        isAMinor(notes) && inputEvents >= 3
          ? evidence.practice.completedAt ?? updatedAt
          : undefined
      return {
        ...progress,
        evidence: {
          ...evidence,
          practice: {
            ...evidence.practice,
            notes,
            inputEvents,
            source: action.source,
            completedAt,
          },
        },
        updatedAt,
      }
    }

    case 'PRACTICE_CLEAR':
      if (progress.stage !== 'practice') return progress
      return {
        ...progress,
        evidence: {
          ...evidence,
          practice: {
            ...evidence.practice,
            notes: [],
            inputEvents: 0,
            completedAt: undefined,
          },
        },
        updatedAt,
      }

    case 'PRACTICE_HINT':
      if (progress.stage !== 'practice') return progress
      return {
        ...progress,
        evidence: {
          ...evidence,
          practice: {
            ...evidence.practice,
            hintsUsed: evidence.practice.hintsUsed + 1,
          },
        },
        updatedAt,
      }

    case 'GO_APPLY':
      if (
        progress.stage !== 'practice' ||
        !isAMinor(evidence.practice.notes) ||
        evidence.practice.inputEvents < 3
      ) {
        return progress
      }
      return { ...progress, stage: 'apply', updatedAt }

    case 'APPLY_TOGGLE': {
      if (progress.stage !== 'apply') return progress
      const exists = evidence.apply.notes.includes(action.note)
      const notes = exists
        ? evidence.apply.notes.filter((note) => note !== action.note)
        : [...evidence.apply.notes, action.note]
      const editEvents = evidence.apply.editEvents + 1
      return {
        ...progress,
        evidence: {
          ...evidence,
          apply: {
            ...evidence.apply,
            notes,
            editEvents,
            playedBack: false,
            completedAt: undefined,
          },
        },
        updatedAt,
      }
    }

    case 'APPLY_PLAYED': {
      if (progress.stage !== 'apply') return progress
      const completedAt =
        isAMinor(evidence.apply.notes) && evidence.apply.editEvents >= 3
          ? evidence.apply.completedAt ?? updatedAt
          : undefined
      return {
        ...progress,
        evidence: {
          ...evidence,
          apply: {
            ...evidence.apply,
            playedBack: true,
            completedAt,
          },
        },
        updatedAt,
      }
    }

    case 'GO_CHECK':
      if (
        progress.stage !== 'apply' ||
        !isAMinor(evidence.apply.notes) ||
        evidence.apply.editEvents < 3 ||
        !evidence.apply.playedBack
      ) {
        return progress
      }
      return {
        ...progress,
        stage: 'check',
        evidence: {
          ...evidence,
          check: { notes: [], inputEvents: 0, hintsUsed: 0 },
        },
        updatedAt,
      }

    case 'CHECK_NOTE': {
      if (progress.stage !== 'check') return progress
      const notes = addCapturedNote(evidence.check.notes, action.note)
      const inputEvents = evidence.check.inputEvents + 1
      const completedAt =
        isAMinor(notes) && inputEvents >= 3
          ? evidence.check.completedAt ?? updatedAt
          : undefined
      return {
        ...progress,
        evidence: {
          ...evidence,
          check: {
            ...evidence.check,
            notes,
            inputEvents,
            source: action.source,
            completedAt,
          },
        },
        updatedAt,
      }
    }

    case 'CHECK_CLEAR':
      if (progress.stage !== 'check') return progress
      return {
        ...progress,
        evidence: {
          ...evidence,
          check: {
            ...evidence.check,
            notes: [],
            inputEvents: 0,
            completedAt: undefined,
          },
        },
        updatedAt,
      }

    case 'CHECK_HINT':
      if (progress.stage !== 'check' || evidence.check.completedAt) return progress
      return {
        ...progress,
        evidence: {
          ...evidence,
          check: {
            ...evidence.check,
            hintsUsed: evidence.check.hintsUsed + 1,
          },
        },
        updatedAt,
      }

    case 'FINALIZE':
      if (progress.stage !== 'check' || !canCompleteSession(progress)) {
        return progress
      }
      return {
        ...progress,
        stage: 'evidence',
        checkpoint: { name: 'harmony-a-complete', savedAt: updatedAt },
        updatedAt,
      }

    case 'SET_REFLECTION':
      if (progress.stage !== 'evidence') return progress
      return {
        ...progress,
        evidence: { ...evidence, reflection: action.value.slice(0, 240) },
        updatedAt,
      }

    case 'RESET_SESSION':
      return createInitialProgress(updatedAt)
  }
}

export function mergeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return defaultSettings
  const candidate = value as Partial<Settings>
  return {
    ...defaultSettings,
    theme:
      candidate.theme === 'daylight' || candidate.theme === 'midnight'
        ? candidate.theme
        : defaultSettings.theme,
    textSize:
      candidate.textSize === 'compact' ||
      candidate.textSize === 'comfortable' ||
      candidate.textSize === 'large'
        ? candidate.textSize
        : defaultSettings.textSize,
    reduceMotion: Boolean(candidate.reduceMotion),
    showNoteNames:
      typeof candidate.showNoteNames === 'boolean'
        ? candidate.showNoteNames
        : defaultSettings.showNoteNames,
    highContrast: Boolean(candidate.highContrast),
    breakReminders:
      typeof candidate.breakReminders === 'boolean'
        ? candidate.breakReminders
        : defaultSettings.breakReminders,
    countIn:
      typeof candidate.countIn === 'boolean'
        ? candidate.countIn
        : defaultSettings.countIn,
    showEstimates:
      typeof candidate.showEstimates === 'boolean'
        ? candidate.showEstimates
        : defaultSettings.showEstimates,
  }
}
