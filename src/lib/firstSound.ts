import type {
  FirstSoundInputEvidence,
  FirstSoundProgress,
  InputSource,
  PianoPreset,
} from '../types'

function stamp(now?: string): string {
  return now ?? new Date().toISOString()
}

export function createInputEvidence(): FirstSoundInputEvidence {
  return {
    noteOns: 0,
    noteOffs: 0,
    completedCycles: 0,
    midiCycles: 0,
    fallbackCycles: 0,
    audioSignals: 0,
    held: [],
  }
}

export function createInitialFirstSoundProgress(
  now = new Date().toISOString(),
): FirstSoundProgress {
  return {
    version: 1,
    stage: 'welcome',
    midi: { connected: false },
    audioReady: false,
    practice: createInputEvidence(),
    preset: { heardWarm: false, heardClear: false },
    check: createInputEvidence(),
    updatedAt: now,
  }
}

export type FirstSoundAction =
  | { type: 'START_SETUP' }
  | { type: 'MIDI_STATUS'; connected: boolean; deviceName?: string }
  | { type: 'AUDIO_READY'; ready: boolean }
  | { type: 'CONTINUE_TO_PRACTICE' }
  | {
      type: 'NOTE_ON'
      phase: 'practice' | 'check'
      note: number
      source: InputSource
      now?: string
    }
  | {
      type: 'NOTE_OFF'
      phase: 'practice' | 'check'
      note: number
      source: InputSource
      now?: string
    }
  | {
      type: 'AUDIO_SIGNAL'
      phase: 'practice' | 'check'
      source: InputSource
      now?: string
    }
  | { type: 'CANCEL_HELD' }
  | { type: 'CONFIRM_SILENCE'; phase: 'practice' | 'check'; now?: string }
  | { type: 'GO_CHOOSE' }
  | { type: 'HEARD_PRESET'; preset: PianoPreset; now?: string }
  | { type: 'CHOOSE_PRESET'; preset: PianoPreset; now?: string }
  | { type: 'GO_CHECK' }
  | { type: 'CLEAR_CHECK' }
  | { type: 'FINALIZE'; now?: string }
  | { type: 'RESET'; now?: string }

export function inputPracticeComplete(evidence: FirstSoundInputEvidence): boolean {
  return (
    evidence.completedCycles >= 3 &&
    evidence.audioSignals >= 3 &&
    evidence.held.length === 0 &&
    Boolean(evidence.silenceConfirmedAt)
  )
}

export function midiCheckComplete(evidence: FirstSoundInputEvidence): boolean {
  return (
    inputPracticeComplete(evidence) &&
    evidence.midiCycles >= 3 &&
    evidence.fallbackCycles === 0
  )
}

export function canCompleteFirstSound(progress: FirstSoundProgress): boolean {
  return (
    progress.midi.connected &&
    Boolean(progress.midi.deviceName) &&
    inputPracticeComplete(progress.practice) &&
    Boolean(progress.preset.choice) &&
    midiCheckComplete(progress.check)
  )
}

function addNoteOn(
  evidence: FirstSoundInputEvidence,
  note: number,
  source: InputSource,
): FirstSoundInputEvidence {
  if (evidence.held.some((item) => item.note === note && item.source === source)) {
    return evidence
  }
  return {
    ...evidence,
    noteOns: evidence.noteOns + 1,
    held: [...evidence.held, { note, source }],
    lastSource: source,
    silenceConfirmedAt: undefined,
    completedAt: undefined,
  }
}

function addNoteOff(
  evidence: FirstSoundInputEvidence,
  note: number,
  source: InputSource,
): FirstSoundInputEvidence {
  const match = evidence.held.findIndex(
    (item) => item.note === note && item.source === source,
  )
  if (match < 0) return evidence
  const held = evidence.held.filter((_, index) => index !== match)
  return {
    ...evidence,
    noteOffs: evidence.noteOffs + 1,
    completedCycles: evidence.completedCycles + 1,
    midiCycles: evidence.midiCycles + (source === 'midi' ? 1 : 0),
    fallbackCycles: evidence.fallbackCycles + (source === 'midi' ? 0 : 1),
    held,
    lastSource: source,
    silenceConfirmedAt: undefined,
    completedAt: undefined,
  }
}

function sanitizeEvidence(value: unknown): FirstSoundInputEvidence {
  const base = createInputEvidence()
  if (!value || typeof value !== 'object') return base
  const candidate = value as Partial<FirstSoundInputEvidence>
  const number = (item: unknown) =>
    typeof item === 'number' && Number.isFinite(item)
      ? Math.max(0, Math.floor(item))
      : 0
  const held = Array.isArray(candidate.held)
    ? candidate.held.filter(
        (item): item is { note: number; source: InputSource } =>
          Boolean(item) &&
          typeof item.note === 'number' &&
          ['screen', 'computer', 'midi'].includes(item.source),
      )
    : []
  const noteOns = number(candidate.noteOns)
  const noteOffs = number(candidate.noteOffs)
  const completedCycles = Math.min(
    number(candidate.completedCycles),
    noteOns,
    noteOffs,
  )
  const midiCycles = Math.min(number(candidate.midiCycles), completedCycles)
  const fallbackCycles = Math.min(
    number(candidate.fallbackCycles),
    completedCycles - midiCycles,
  )
  const audioSignals = Math.min(number(candidate.audioSignals), noteOns)
  const silenceIsValid =
    held.length === 0 && completedCycles >= 3 && audioSignals >= 3
  return {
    noteOns,
    noteOffs,
    completedCycles,
    midiCycles,
    fallbackCycles,
    audioSignals,
    held,
    lastSource: ['screen', 'computer', 'midi'].includes(
      candidate.lastSource ?? '',
    )
      ? candidate.lastSource
      : undefined,
    silenceConfirmedAt:
      silenceIsValid && typeof candidate.silenceConfirmedAt === 'string'
        ? candidate.silenceConfirmedAt
        : undefined,
    completedAt:
      silenceIsValid &&
      typeof candidate.silenceConfirmedAt === 'string' &&
      typeof candidate.completedAt === 'string'
        ? candidate.completedAt
        : undefined,
  }
}

export function normalizeFirstSoundProgress(
  value: unknown,
  now = new Date().toISOString(),
): FirstSoundProgress {
  if (!value || typeof value !== 'object') {
    return createInitialFirstSoundProgress(now)
  }
  const candidate = value as Partial<FirstSoundProgress>
  if (candidate.version !== 1) return createInitialFirstSoundProgress(now)
  const practice = sanitizeEvidence(candidate.practice)
  const check = sanitizeEvidence(candidate.check)
  const presetCandidate = candidate.preset
  const preset = {
    heardWarm: Boolean(presetCandidate?.heardWarm),
    heardClear: Boolean(presetCandidate?.heardClear),
    choice:
      presetCandidate?.choice === 'warm' || presetCandidate?.choice === 'clear'
        ? presetCandidate.choice
        : undefined,
    completedAt:
      typeof presetCandidate?.completedAt === 'string'
        ? presetCandidate.completedAt
        : undefined,
  }
  const connected = Boolean(candidate.midi?.connected)
  const deviceName =
    typeof candidate.midi?.deviceName === 'string'
      ? candidate.midi.deviceName.slice(0, 160)
      : undefined
  const validStages = [
    'welcome',
    'connect',
    'practice',
    'choose',
    'check',
    'evidence',
  ] as const
  let stage = validStages.includes(candidate.stage as (typeof validStages)[number])
    ? (candidate.stage as FirstSoundProgress['stage'])
    : 'welcome'
  if (stage === 'evidence' && !midiCheckComplete(check)) stage = 'check'
  if (['check', 'evidence'].includes(stage) && !preset.choice) stage = 'choose'
  if (['choose', 'check', 'evidence'].includes(stage) && !inputPracticeComplete(practice)) {
    stage = 'practice'
  }
  const progress: FirstSoundProgress = {
    version: 1,
    stage,
    midi: { connected, deviceName },
    audioReady: false,
    practice: { ...practice, held: [] },
    preset,
    check: { ...check, held: [] },
    updatedAt:
      typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  }
  const checkpoint = candidate.checkpoint
  if (
    checkpoint?.name === 'first-signal-complete' &&
    typeof checkpoint.savedAt === 'string' &&
    canCompleteFirstSound({ ...progress, midi: { connected: true, deviceName: deviceName ?? 'Previously verified MIDI' } })
  ) {
    progress.checkpoint = checkpoint
    progress.stage = 'evidence'
  }
  if (progress.stage === 'evidence' && !progress.checkpoint) {
    progress.stage = 'check'
  }
  return progress
}

export function firstSoundReducer(
  progress: FirstSoundProgress,
  action: FirstSoundAction,
): FirstSoundProgress {
  const now = stamp('now' in action ? action.now : undefined)
  switch (action.type) {
    case 'START_SETUP':
      return { ...progress, stage: 'connect', updatedAt: now }
    case 'MIDI_STATUS':
      if (
        progress.midi.connected === action.connected &&
        (!action.connected || progress.midi.deviceName === action.deviceName)
      ) {
        return progress
      }
      return {
        ...progress,
        midi: {
          connected: action.connected,
          deviceName: action.connected
            ? action.deviceName
            : progress.midi.deviceName,
        },
      }
    case 'AUDIO_READY':
      if (progress.audioReady === action.ready) return progress
      return { ...progress, audioReady: action.ready }
    case 'CONTINUE_TO_PRACTICE':
      return progress.stage === 'connect' && progress.audioReady
        ? { ...progress, stage: 'practice', updatedAt: now }
        : progress
    case 'NOTE_ON': {
      if (progress.stage !== action.phase) return progress
      if (action.phase === 'check' && (!progress.midi.connected || action.source !== 'midi')) {
        return progress
      }
      return {
        ...progress,
        [action.phase]: addNoteOn(
          progress[action.phase],
          action.note,
          action.source,
        ),
        updatedAt: now,
      }
    }
    case 'NOTE_OFF': {
      if (progress.stage !== action.phase) return progress
      if (action.phase === 'check' && action.source !== 'midi') return progress
      return {
        ...progress,
        [action.phase]: addNoteOff(
          progress[action.phase],
          action.note,
          action.source,
        ),
        updatedAt: now,
      }
    }
    case 'AUDIO_SIGNAL': {
      if (progress.stage !== action.phase) return progress
      if (action.phase === 'check' && action.source !== 'midi') return progress
      const evidence = progress[action.phase]
      return {
        ...progress,
        [action.phase]: {
          ...evidence,
          audioSignals: evidence.audioSignals + 1,
        },
        updatedAt: now,
      }
    }
    case 'CANCEL_HELD':
      return {
        ...progress,
        practice: progress.practice.held.length
          ? { ...progress.practice, held: [], silenceConfirmedAt: undefined }
          : progress.practice,
        check: progress.check.held.length
          ? { ...progress.check, held: [], silenceConfirmedAt: undefined }
          : progress.check,
        updatedAt: now,
      }
    case 'CONFIRM_SILENCE': {
      if (progress.stage !== action.phase) return progress
      const evidence = progress[action.phase]
      if (
        evidence.held.length ||
        evidence.completedCycles < 3 ||
        evidence.audioSignals < 3
      ) {
        return progress
      }
      const next = {
        ...evidence,
        silenceConfirmedAt: evidence.silenceConfirmedAt ?? now,
        completedAt: evidence.completedAt ?? now,
      }
      return { ...progress, [action.phase]: next, updatedAt: now }
    }
    case 'GO_CHOOSE':
      return progress.stage === 'practice' && inputPracticeComplete(progress.practice)
        ? { ...progress, stage: 'choose', updatedAt: now }
        : progress
    case 'HEARD_PRESET':
      if (progress.stage !== 'choose') return progress
      return {
        ...progress,
        preset: {
          ...progress.preset,
          heardWarm: progress.preset.heardWarm || action.preset === 'warm',
          heardClear: progress.preset.heardClear || action.preset === 'clear',
        },
        updatedAt: now,
      }
    case 'CHOOSE_PRESET':
      if (
        progress.stage !== 'choose' ||
        !progress.preset.heardWarm ||
        !progress.preset.heardClear
      ) {
        return progress
      }
      return {
        ...progress,
        preset: { ...progress.preset, choice: action.preset, completedAt: now },
        updatedAt: now,
      }
    case 'GO_CHECK':
      return progress.stage === 'choose' && progress.preset.choice
        ? {
            ...progress,
            stage: 'check',
            check: createInputEvidence(),
            updatedAt: now,
          }
        : progress
    case 'CLEAR_CHECK':
      return progress.stage === 'check'
        ? { ...progress, check: createInputEvidence(), updatedAt: now }
        : progress
    case 'FINALIZE':
      return progress.stage === 'check' && canCompleteFirstSound(progress)
        ? {
            ...progress,
            stage: 'evidence',
            checkpoint: { name: 'first-signal-complete', savedAt: now },
            updatedAt: now,
          }
        : progress
    case 'RESET':
      return createInitialFirstSoundProgress(now)
  }
}
