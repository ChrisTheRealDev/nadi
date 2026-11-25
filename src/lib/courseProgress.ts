import type { GuidedSessionId } from '../types'
import { isAcknowledgedPlaybackReceipt, type PlaybackReceipt } from './audio'
import {
  addEarnedLearningRecord,
  advanceLearningStage,
  createLearningAttempt,
  earnLearningRecord,
  finishLearningAttempt,
  recordLearningSupport,
  restartForLowerHelpAttempt,
  type EarnedLearningRecord,
  type LearningAttempt,
  type LearningCycleStage,
  type LearningProjectReference,
  type LearningSupportLevel,
} from './learningAttempts'
import type { Session2Check, Session4Check, Session5Check, Session6Check, Session7Check, Session8Check } from './learningChecks'
import { session2Complete, session4Complete, session5Complete, session6Complete, session7Complete, session8Complete } from './learningChecks'
import {
  EIGHTH_NOTE_TICKS,
  eventBar,
  eventsForBar,
  eventsForPattern,
  firstAvailableTick,
  hasOverlappingEvents,
  melodyPropertyChanges,
  midiForNoteName,
  midiForNoteNameNear,
  noteNameFromMidi,
  scaleNoteNames,
  sortMelodyEvents,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type MelodyNoteEvent,
  type MelodyEventSource,
  type MelodyPatternId,
} from './melodyEvents'
import {
  applyProjectGraphEdit,
  appendProjectCommand,
  cloneProjectContent,
  createProjectContent,
  emptyProjectHistory,
  ensureCanonicalProject,
  isValidCommandHistory,
  isValidProjectContent,
  projectProjectionFromContent,
  projectContentFingerprint,
  type ProjectCommandHistory,
  type ProjectContent,
  type ProjectGraphEdit,
} from './projectModel'

export type GuidedStage = 'welcome' | 'learn' | 'make' | 'check' | 'evidence'
export type CourseValue = string | number | boolean | string[] | number[]
export type GuidedCheckArtifact =
  | { session: 2; check: Session2Check }
  | { session: 4; check: Session4Check }
  | { session: 5; check: Session5Check }
  | { session: 6; check: Session6Check }
  | { session: 7; check: Session7Check }
  | { session: 8; check: Session8Check }

export interface GuidedLearningState {
  current: LearningAttempt<GuidedCheckArtifact>
  archived: LearningAttempt<GuidedCheckArtifact>[]
  earned: EarnedLearningRecord<GuidedCheckArtifact>[]
}

export interface GuidedSessionRecord {
  stage: GuidedStage
  learned: string[]
  made: string[]
  checked: string[]
  values: Record<string, CourseValue>
  playbackReceipts?: PlaybackReceipt[]
  learning?: GuidedLearningState
  checkpoint?: { name: string; savedAt: string; verification?: 'typed-earned' | 'legacy-unverified'; evidenceId?: string; result?: 'supported' | 'independent' }
}

export interface EmotiveProject {
  id: string
  bpm: 90
  meter: '4/4'
  bars: 8
  chords: string[]
  ticksPerBeat: 480
  melodyEvents: MelodyNoteEvent[]
  nextMelodyEventId: number
  revision: number
  chordLevel: number
  melodyLevel: number
  reverb: number
  content: ProjectContent
}

export interface CourseProgress {
  version: 2
  sessions: Record<string, GuidedSessionRecord>
  project: EmotiveProject
  history: ProjectCommandHistory
  updatedAt: string
}

export const guidedSessionIds: GuidedSessionId[] = [2, 4, 5, 6, 7, 8]
export const expectedChords = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am']
export const chordNotes: Record<string, number[]> = {
  Am: [57, 60, 64],
  F: [53, 57, 60],
  C: [60, 64, 67],
  G: [55, 59, 62],
}
export const chordTones: Record<number, string[]> = {
  0: ['A', 'C', 'E'],
  1: ['F', 'A', 'C'],
  2: ['C', 'E', 'G'],
  3: ['G', 'B', 'D'],
}
export const scaleNotes: string[] = [...scaleNoteNames]

const checkpointNames: Record<GuidedSessionId, string> = {
  2: 'beat-and-bar-complete',
  4: 'harmony-b-complete',
  5: 'pattern-maker-complete',
  6: 'phrase-maker-complete',
  7: 'eight-bar-builder-complete',
  8: 'first-track-complete',
}

function blankRecord(): GuidedSessionRecord {
  return { stage: 'welcome', learned: [], made: [], checked: [], values: {} }
}

export function currentProjectReference(progress: CourseProgress): LearningProjectReference {
  return { projectId: progress.project.id, revision: progress.project.revision, contentFingerprint: projectContentFingerprint(progress.project.content) }
}

function nextAttemptId(session: GuidedSessionId, now: string): string {
  return `session-${session}:${now.replace(/[^A-Za-z0-9]/g, '').slice(-48) || 'attempt'}`
}

function createGuidedLearningState(progress: CourseProgress, session: GuidedSessionId, now: string): GuidedLearningState {
  return { current: createLearningAttempt({ id: nextAttemptId(session, now), objectiveId: `session-${session}`, project: currentProjectReference(progress), now }), archived: [], earned: [] }
}

function childAttemptContext(attempt: LearningAttempt<unknown>, name: string) {
  return { attemptId: `${attempt.id}:${name}`, generation: attempt.generation }
}

function guidedArtifactPass(progress: CourseProgress, attempt: LearningAttempt<GuidedCheckArtifact>, artifact: GuidedCheckArtifact): boolean {
  if (!validGuidedArtifactForAttempt(artifact, attempt, artifact.session)) return false
  const context = { attemptId: attempt.id, generation: attempt.generation }
  const actual = currentProjectReference(progress)
  switch (artifact.session) {
    case 2: return session2Complete(artifact.check, context)
    case 4: return session4Complete(artifact.check, { F: childAttemptContext(attempt, 'F'), C: childAttemptContext(attempt, 'C'), G: childAttemptContext(attempt, 'G'), repair: childAttemptContext(attempt, 'repair') })
    case 5: return session5Complete(artifact.check, { main: context, repair: childAttemptContext(attempt, 'repair') }, actual, progress.project.content, progress.history)
    case 6: return session6Complete(artifact.check, { main: context, answer: childAttemptContext(attempt, 'answer') }, actual, progress.project.content, progress.history)
    case 7: return session7Complete(artifact.check, context, actual, progress.project.content)
    case 8: return session8Complete(artifact.check, context, actual, progress.project.content, progress.history)
  }
}

function cloneGuidedArtifact(artifact: GuidedCheckArtifact): GuidedCheckArtifact {
  return JSON.parse(JSON.stringify(artifact)) as GuidedCheckArtifact
}

export function isOpaqueProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/.test(value)
}

export function createOpaqueProjectId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
  const entropy = uuid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `project-${entropy.slice(0, 32).padEnd(8, '0')}`
}

export function createInitialCourseProgress(
  now = new Date().toISOString(),
): CourseProgress {
  const content = createProjectContent({
    chords: [], melodyEvents: [], chordLevel: 72, melodyLevel: 78, reverb: 12,
  })
  return {
    version: 2,
    sessions: Object.fromEntries(
      guidedSessionIds.map((id) => [String(id), blankRecord()]),
    ),
    project: {
      id: createOpaqueProjectId(),
      bpm: 90,
      meter: '4/4',
      bars: 8,
      chords: [],
      ticksPerBeat: TICKS_PER_BEAT,
      melodyEvents: [],
      nextMelodyEventId: 1,
      revision: 0,
      chordLevel: 72,
      melodyLevel: 78,
      reverb: 12,
      content,
    },
    history: emptyProjectHistory(),
    updatedAt: now,
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)].slice(0, 40)
}

const MAX_MELODY_EVENT_ID = 1_000_000

function nextAvailableMelodyEventNumber(events: readonly MelodyNoteEvent[], preferred: number): number {
  const used = new Set(events.map((event) => event.id))
  let candidate = Number.isSafeInteger(preferred) && preferred >= 1 && preferred <= MAX_MELODY_EVENT_ID
    ? preferred
    : 1
  for (let attempt = 0; attempt <= used.size; attempt += 1) {
    if (!used.has(`note-${candidate}`)) return candidate
    candidate = candidate >= MAX_MELODY_EVENT_ID ? 1 : candidate + 1
  }
  return 1
}

function hasEvery(items: string[], wanted: string[]): boolean {
  return wanted.every((item) => items.includes(item))
}

function strings(value: CourseValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function number(value: CourseValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function text(value: CourseValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function flag(value: CourseValue | undefined): boolean {
  return value === true
}

const learnRequirements: Record<GuidedSessionId, string[]> = {
  2: ['heard-accent', 'used-transport', 'counted-four'],
  4: ['heard-progression', 'heard-triads', 'named-movement'],
  5: ['read-piano-roll', 'heard-snap', 'understood-duration'],
  6: ['heard-motifs', 'heard-chord-tones', 'chose-entry'],
  7: ['compared-halves', 'heard-variation', 'heard-resolution'],
  8: ['heard-velocity', 'introduced-space-control', 'read-safe-range'],
}

export function learnComplete(
  progress: CourseProgress,
  session: GuidedSessionId,
): boolean {
  return hasEvery(progress.sessions[String(session)].learned, learnRequirements[session])
}

export function melodyAValid(project: EmotiveProject): boolean {
  const events = eventsForPattern(project.melodyEvents, 'melody-a')
  const bars = [0, 1, 2, 3].map((bar) => eventsForBar(events, bar))
  const occupied = bars.filter((bar) => bar.length > 0).length
  return (
    events.length >= 8 &&
    occupied >= 3 &&
    bars.every(
      (bar, index) =>
        bar.length <= 6 &&
        !hasOverlappingEvents(bar) &&
        (bar.length === 0 || chordTones[index].includes(noteNameFromMidi(sortMelodyEvents(bar)[0].pitch))) &&
        bar.every((event) => scaleNotes.includes(noteNameFromMidi(event.pitch))),
    )
  )
}

function melodyChanges(project: EmotiveProject): number {
  return melodyPropertyChanges(project.melodyEvents)
}

export function melodyBValid(project: EmotiveProject): boolean {
  const events = eventsForPattern(project.melodyEvents, 'melody-b')
  const bars = [4, 5, 6, 7].map((bar) => eventsForBar(events, bar))
  const ending = sortMelodyEvents(events).at(-1)
  return (
    events.length >= 6 &&
    bars.every((bar) => bar.length <= 6 && !hasOverlappingEvents(bar)) &&
    melodyChanges(project) >= 2 &&
    Boolean(ending && ['A', 'C', 'E'].includes(noteNameFromMidi(ending.pitch)))
  )
}

export function mixWithinBeginnerRange(project: EmotiveProject): boolean {
  return (
    project.chordLevel >= 35 &&
    project.chordLevel <= 90 &&
    project.melodyLevel >= 35 &&
    project.melodyLevel <= 90 &&
    project.chordLevel + project.melodyLevel <= 165 &&
    project.reverb >= 8 &&
    project.reverb <= 20
  )
}

export function makeComplete(
  progress: CourseProgress,
  session: GuidedSessionId,
): boolean {
  const record = progress.sessions[String(session)]
  switch (session) {
    case 2:
      return hasEvery(record.made, ['heard-two-bars', 'identified-next-bar']) && text(record.values.barStartChoice) === 'beat-5'
    case 4:
      return (
        hasEvery(record.made, ['built-f', 'built-c', 'built-g', 'chose-mood']) &&
        ['reflective', 'hopeful', 'unsettled'].includes(text(record.values.mood))
      )
    case 5:
      return (
        expectedChords.every((chord, index) => progress.project.chords[index] === chord) &&
        flag(record.values.auditioned) &&
        number(record.values.auditionedProjectRevision) === progress.project.revision
      )
    case 6:
      return (
        melodyAValid(progress.project) &&
        flag(record.values.playedBack) &&
        number(record.values.playedBackProjectRevision) === progress.project.revision &&
        text(record.values.reflection).trim().length >= 3
      )
    case 7:
      return (
        melodyBValid(progress.project) &&
        (record.made.includes('duplicated-phrase') || flag(record.values.legacyVariationImported)) &&
        text(record.values.intention).trim().length >= 3 &&
        flag(record.values.reviewedArrangement) &&
        number(record.values.reviewedProjectRevision) === progress.project.revision
      )
    case 8: {
      const editedVelocityIds = strings(record.values.velocityEditedEventIds)
      const changedIds = new Set(progress.project.melodyEvents.filter((event) => event.velocity !== 72).map((event) => event.id))
      const changedVelocities = new Set(editedVelocityIds.filter((id) => changedIds.has(id))).size
      const grandfatheredVelocitySlots = new Set(
        strings(record.values.legacyVelocityEditedSlots)
          .filter((slot) => /^legacy-slot-[0-3]$/.test(slot)),
      ).size
      return (
        expectedChords.every((chord, index) => progress.project.chords[index] === chord) &&
        melodyAValid(progress.project) &&
        melodyBValid(progress.project) &&
        Math.max(changedVelocities, grandfatheredVelocitySlots) >= 3 &&
        mixWithinBeginnerRange(progress.project) &&
        flag(record.values.fullPlayback) &&
        number(record.values.fullPlaybackProjectRevision) === progress.project.revision &&
        text(record.values.velocityReflection).trim().length >= 3 &&
        text(record.values.variationReflection).trim().length >= 3
      )
    }
  }
}

export function checkComplete(
  progress: CourseProgress,
  session: GuidedSessionId,
): boolean {
  const record = progress.sessions[String(session)]
  switch (session) {
    case 2:
      return record.learning?.current.artifact?.session === 2 || Boolean(record.learning?.earned.some((evidence) => evidence.attemptSnapshot.artifact?.session === 2))
    case 4:
      return record.learning?.current.artifact?.session === 4 || Boolean(record.learning?.earned.some((evidence) => evidence.attemptSnapshot.artifact?.session === 4))
    case 5:
      return record.learning?.current.artifact?.session === 5 || Boolean(record.learning?.earned.some((evidence) => evidence.attemptSnapshot.artifact?.session === 5))
    case 6:
      return strings(record.values.checkStarts).join(',') === 'A,F,C,G'
    case 7:
      return hasEvery(record.checked, ['identified-change', 'resolved-ending'])
    case 8:
      return hasEvery(record.checked, ['velocity-is-touch', 'reverb-is-space', 'meter-is-safe'])
  }
}

export function canFinalizeGuidedSession(
  progress: CourseProgress,
  session: GuidedSessionId,
): boolean {
  const record = progress.sessions[String(session)]
  return learnComplete(progress, session) && makeComplete(progress, session) && checkComplete(progress, session) &&
    Boolean(record.learning?.earned.some((evidence) => evidence.objectiveId === `session-${session}`))
}

export function isGuidedSessionComplete(
  progress: CourseProgress,
  session: GuidedSessionId,
): boolean {
  const record = progress.sessions[String(session)]
  return record.checkpoint?.name === checkpointNames[session] && record.checkpoint.verification === 'typed-earned' &&
    Boolean(record.checkpoint.evidenceId && record.learning?.earned.some((evidence) => evidence.id === record.checkpoint?.evidenceId))
}

export type CourseAction =
  | { type: 'START'; session: GuidedSessionId }
  | { type: 'MARK'; session: GuidedSessionId; area: 'learned' | 'made' | 'checked'; key: string }
  | { type: 'SET_VALUE'; session: GuidedSessionId; key: string; value: CourseValue }
  | { type: 'APPLY_PROJECT_EDIT'; edit: ProjectGraphEdit; expectedProject: LearningProjectReference; label: string }
  | { type: 'ADVANCE_LEARNING_STAGE'; session: GuidedSessionId; next: LearningCycleStage }
  | { type: 'RECORD_LEARNING_SUPPORT'; session: GuidedSessionId; level: Exclude<LearningSupportLevel, 'none'> }
  | { type: 'RESTART_FRESH_ATTEMPT'; session: GuidedSessionId }
  | { type: 'SUBMIT_GUIDED_CHECK'; session: GuidedSessionId; artifact: GuidedCheckArtifact }
  | { type: 'RECORD_LEARNING_REFLECTION'; session: GuidedSessionId; reflection: string }
  | { type: 'EARN_GUIDED_EVIDENCE'; session: GuidedSessionId }
  | { type: 'INCREMENT'; session: GuidedSessionId; key: string; max?: number }
  | { type: 'APPEND'; session: GuidedSessionId; key: string; value: string; max?: number }
  | { type: 'SET_CHORD'; bar: number; chord: string }
  | { type: 'ADD_MELODY_NOTE'; half: 'A' | 'B'; bar: number; note: string; pitch?: number; velocity?: number; source?: MelodyEventSource }
  | { type: 'REMOVE_MELODY_NOTE'; half: 'A' | 'B'; bar: number; eventId?: string }
  | { type: 'SET_MELODY_PITCH'; half: 'A' | 'B'; eventId: string; note: string }
  | { type: 'SET_MELODY_TIMING'; half: 'A' | 'B'; eventId: string; startTick?: number; durationTicks?: number }
  | { type: 'DUPLICATE_MELODY' }
  | { type: 'MAKE_UNIQUE_CLIP'; clipId: string }
  | { type: 'SET_EVENT_VELOCITY'; eventId: string; value: number }
  | { type: 'SET_MIX'; key: 'chordLevel' | 'melodyLevel' | 'reverb'; value: number }
  | { type: 'CONFIRM_PROJECT_PLAYBACK'; session: 5 | 6 | 7 | 8; receipt: PlaybackReceipt; currentAudioEpoch: number }
  | { type: 'PRACTICE_CLIP_EDIT'; operation: 'move' | 'resize' | 'duplicate' | 'undo' }
  | { type: 'GO_MAKE'; session: GuidedSessionId }
  | { type: 'GO_CHECK'; session: GuidedSessionId }
  | { type: 'FINALIZE'; session: GuidedSessionId; now?: string }
  | { type: 'RESET_SESSION'; session: GuidedSessionId; now?: string }
  | { type: 'UNDO_PROJECT' }
  | { type: 'REDO_PROJECT' }

function updateRecord(
  progress: CourseProgress,
  session: GuidedSessionId,
  update: (record: GuidedSessionRecord) => GuidedSessionRecord,
  now: string,
): CourseProgress {
  return {
    ...progress,
    sessions: {
      ...progress.sessions,
      [String(session)]: update(progress.sessions[String(session)]),
    },
    updatedAt: now,
  }
}

function courseReducerInternal(
  progress: CourseProgress,
  action: CourseAction,
): CourseProgress {
  const now = 'now' in action && action.now ? action.now : new Date().toISOString()
  if (action.type === 'APPLY_PROJECT_EDIT') return progress
  if (action.type === 'ADVANCE_LEARNING_STAGE' || action.type === 'RECORD_LEARNING_SUPPORT' || action.type === 'RESTART_FRESH_ATTEMPT' || action.type === 'SUBMIT_GUIDED_CHECK' || action.type === 'RECORD_LEARNING_REFLECTION' || action.type === 'EARN_GUIDED_EVIDENCE') {
    const record = progress.sessions[String(action.session)]
    const learning = record.learning ?? createGuidedLearningState(progress, action.session, now)
    if (action.type === 'ADVANCE_LEARNING_STAGE') {
      const current = advanceLearningStage(learning.current, action.next, now)
      return current === learning.current ? progress : updateRecord(progress, action.session, (item) => ({ ...item, learning: { ...learning, current } }), now)
    }
    if (action.type === 'RECORD_LEARNING_SUPPORT') {
      return updateRecord(progress, action.session, (item) => ({ ...item, learning: { ...learning, current: recordLearningSupport(learning.current, action.level, now) } }), now)
    }
    if (action.type === 'RESTART_FRESH_ATTEMPT') {
      const restarted = restartForLowerHelpAttempt({ current: learning.current, completed: learning.archived, earned: learning.earned }, { id: nextAttemptId(action.session, now), project: currentProjectReference(progress), now })
      return restarted.current === learning.current ? progress : updateRecord(progress, action.session, (item) => ({ ...item, learning: { current: restarted.current, archived: restarted.completed, earned: restarted.earned ?? learning.earned } }), now)
    }
    if (action.type === 'SUBMIT_GUIDED_CHECK') {
      if (action.artifact.session !== action.session || learning.current.stage !== 'independent-check' || !guidedArtifactPass(progress, learning.current, action.artifact)) return progress
      const reflected = { ...learning.current, project: currentProjectReference(progress), artifact: cloneGuidedArtifact(action.artifact), stage: 'reflect' as const, updatedAt: now }
      return updateRecord(progress, action.session, (item) => ({ ...item, learning: { ...learning, current: reflected } }), now)
    }
    if (action.type === 'RECORD_LEARNING_REFLECTION') {
      if (learning.current.stage !== 'reflect' || action.reflection.trim().length > 500) return progress
      return updateRecord(progress, action.session, (item) => ({ ...item, learning: { ...learning, current: { ...learning.current, reflection: action.reflection, updatedAt: now } } }), now)
    }
    if (learning.current.stage !== 'reflect' || learning.current.reflection.trim().length < 3 || !learning.current.artifact || !guidedArtifactPass(progress, learning.current, learning.current.artifact)) return progress
    const finished = finishLearningAttempt(learning.current, true, now)
    const earned = earnLearningRecord(finished, now)
    if (!earned) return progress
    const nextHistory = addEarnedLearningRecord({ current: finished, completed: learning.archived, earned: learning.earned }, earned)
    return updateRecord(progress, action.session, (item) => ({ ...item, learning: { current: finished, archived: learning.archived, earned: nextHistory.earned ?? learning.earned } }), now)
  }
  if (action.type === 'SET_CHORD') {
    if (progress.sessions['5'].stage !== 'make') return progress
    if (action.bar < 0 || action.bar > 7 || !Object.hasOwn(chordNotes, action.chord)) return progress
    const chords = [...progress.project.chords]
    chords[action.bar] = action.chord
    return { ...progress, project: { ...progress.project, chords, revision: progress.project.revision + 1 }, updatedAt: now }
  }
  if (action.type === 'ADD_MELODY_NOTE' || action.type === 'REMOVE_MELODY_NOTE') {
    if (action.bar < 0 || action.bar > 3) return progress
    const session = action.half === 'A' ? 6 : 7
    if (progress.sessions[String(session)].stage !== 'make') return progress
    const globalBar = action.half === 'A' ? action.bar : action.bar + 4
    let melodyEvents = [...progress.project.melodyEvents]
    let nextMelodyEventId = progress.project.nextMelodyEventId
    if (action.type === 'ADD_MELODY_NOTE') {
      if (
        (action.pitch !== undefined && (!Number.isFinite(action.pitch) || !Number.isInteger(action.pitch))) ||
        (action.velocity !== undefined && !Number.isFinite(action.velocity))
      ) return progress
      const barEvents = eventsForBar(melodyEvents, globalBar)
      if (!scaleNotes.includes(action.note) || barEvents.length >= 6) return progress
      const startTick = firstAvailableTick(barEvents, globalBar)
      if (startTick === undefined) return progress
      const allocatedNumber = nextAvailableMelodyEventNumber(melodyEvents, nextMelodyEventId)
      melodyEvents.push({
        id: `note-${allocatedNumber}`,
        pitch: typeof action.pitch === 'number' && Number.isInteger(action.pitch)
          ? Math.max(0, Math.min(127, action.pitch))
          : midiForNoteName(action.note),
        startTick,
        durationTicks: EIGHTH_NOTE_TICKS,
        velocity: typeof action.velocity === 'number'
          ? Math.max(1, Math.min(127, Math.round(action.velocity)))
          : 72,
        trackId: 'melody',
        patternId: action.half === 'A' ? 'melody-a' : 'melody-b',
        source: action.source ?? 'draw',
      })
      nextMelodyEventId = nextAvailableMelodyEventNumber(
        melodyEvents,
        allocatedNumber >= MAX_MELODY_EVENT_ID ? 1 : allocatedNumber + 1,
      )
    } else {
      const barEvents = eventsForBar(melodyEvents, globalBar)
      const removeId = action.eventId ?? barEvents.at(-1)?.id
      if (!removeId || !barEvents.some((event) => event.id === removeId)) return progress
      melodyEvents = melodyEvents.filter((event) => event.id !== removeId)
    }
    let next = {
      ...progress,
      project: {
        ...progress.project,
        melodyEvents: sortMelodyEvents(melodyEvents),
        nextMelodyEventId,
        revision: progress.project.revision + 1,
      },
      updatedAt: now,
    }
    const record = next.sessions[String(session)]
    if (action.half === 'A' && flag(record.values.playedBack)) {
      next = updateRecord(next, 6, (item) => ({ ...item, values: { ...item.values, revisedAfterPlayback: true } }), now)
    }
    if (action.half === 'B' && flag(record.values.reviewedArrangement)) {
      next = updateRecord(next, 7, (item) => ({ ...item, values: { ...item.values, reviewedArrangement: false } }), now)
    }
    return next
  }
  if (action.type === 'SET_MELODY_PITCH') {
    const session = action.half === 'A' ? 6 : 7
    if (progress.sessions[String(session)].stage !== 'make' || !scaleNotes.includes(action.note)) return progress
    const patternId: MelodyPatternId = action.half === 'A' ? 'melody-a' : 'melody-b'
    let changed = false
    const melodyEvents = progress.project.melodyEvents.map((event) => {
      if (event.id !== action.eventId || event.patternId !== patternId) return event
      const nextPitch = midiForNoteNameNear(action.note, event.pitch)
      if (event.pitch === nextPitch) return event
      changed = true
      return { ...event, pitch: nextPitch }
    })
    if (!changed) return progress
    let next = { ...progress, project: { ...progress.project, melodyEvents, revision: progress.project.revision + 1 }, updatedAt: now }
    const record = next.sessions[String(session)]
    if (action.half === 'A' && flag(record.values.playedBack)) {
      next = updateRecord(next, 6, (item) => ({ ...item, values: { ...item.values, revisedAfterPlayback: true } }), now)
    }
    if (action.half === 'B' && flag(record.values.reviewedArrangement)) {
      next = updateRecord(next, 7, (item) => ({ ...item, values: { ...item.values, reviewedArrangement: false } }), now)
    }
    return next
  }
  if (action.type === 'SET_MELODY_TIMING') {
    const session = action.half === 'A' ? 6 : 7
    if (progress.sessions[String(session)].stage !== 'make') return progress
    if (
      (action.startTick !== undefined && (!Number.isFinite(action.startTick) || !Number.isInteger(action.startTick))) ||
      (action.durationTicks !== undefined && (!Number.isFinite(action.durationTicks) || !Number.isInteger(action.durationTicks)))
    ) return progress
    let changed = false
    const patternId: MelodyPatternId = action.half === 'A' ? 'melody-a' : 'melody-b'
    const melodyEvents = sortMelodyEvents(progress.project.melodyEvents.map((event) => {
      if (event.id !== action.eventId) return event
      if (event.patternId !== patternId) return event
      const bar = eventBar(event)
      const barStart = bar * TICKS_PER_BAR
      const barEnd = barStart + TICKS_PER_BAR
      let nextStart = event.startTick
      let nextDuration = event.durationTicks
      if (action.startTick !== undefined && action.startTick !== event.startTick) {
        if (Math.floor(action.startTick / TICKS_PER_BAR) !== bar) return event
        nextStart = barStart + Math.round((action.startTick - barStart) / EIGHTH_NOTE_TICKS) * EIGHTH_NOTE_TICKS
      }
      if (action.durationTicks !== undefined && action.durationTicks !== event.durationTicks) {
        nextDuration = Math.max(EIGHTH_NOTE_TICKS, Math.round(action.durationTicks / EIGHTH_NOTE_TICKS) * EIGHTH_NOTE_TICKS)
      }
      if (nextStart < barStart || nextStart >= barEnd || nextStart + nextDuration > barEnd) return event
      const nextEvent = {
        ...event,
        startTick: nextStart,
        durationTicks: nextDuration,
        timingInferred: undefined,
      }
      if (nextEvent.startTick === event.startTick && nextEvent.durationTicks === event.durationTicks) return event
      changed = true
      return nextEvent
    }))
    if (!changed) return progress
    let next = { ...progress, project: { ...progress.project, melodyEvents, revision: progress.project.revision + 1 }, updatedAt: now }
    const record = next.sessions[String(session)]
    if (action.half === 'A' && flag(record.values.playedBack)) {
      next = updateRecord(next, 6, (item) => ({ ...item, values: { ...item.values, revisedAfterPlayback: true } }), now)
    }
    if (action.half === 'B' && flag(record.values.reviewedArrangement)) {
      next = updateRecord(next, 7, (item) => ({ ...item, values: { ...item.values, reviewedArrangement: false } }), now)
    }
    return next
  }
  if (action.type === 'DUPLICATE_MELODY') {
    if (progress.sessions['7'].stage !== 'make') return progress
    if (progress.project.content.clips.some((clip) => clip.id === 'clip-melody-b')) return progress
    let nextId = progress.project.nextMelodyEventId
    const melodyA = eventsForPattern(progress.project.melodyEvents, 'melody-a')
    const melodyB: MelodyNoteEvent[] = []
    for (const event of melodyA) {
      const allocatedNumber = nextAvailableMelodyEventNumber([...melodyA, ...melodyB], nextId)
      melodyB.push({
        ...event,
        id: `note-${allocatedNumber}`,
        startTick: event.startTick + 4 * TICKS_PER_BAR,
        patternId: 'melody-b',
        source: 'duplicate',
        originId: event.id,
        timingInferred: event.timingInferred,
      })
      nextId = nextAvailableMelodyEventNumber(
        [...melodyA, ...melodyB],
        allocatedNumber >= MAX_MELODY_EVENT_ID ? 1 : allocatedNumber + 1,
      )
    }
    return updateRecord(
      {
        ...progress,
        project: {
          ...progress.project,
          melodyEvents: sortMelodyEvents([...melodyA, ...melodyB]),
          nextMelodyEventId: nextId,
          revision: progress.project.revision + 1,
        },
      },
      7,
      (record) => ({ ...record, made: unique([...record.made, 'duplicated-phrase']), values: { ...record.values, reviewedArrangement: false } }),
      now,
    )
  }
  if (action.type === 'SET_EVENT_VELOCITY') {
    if (progress.sessions['8'].stage !== 'make') return progress
    if (!Number.isFinite(action.value)) return progress
    const nextVelocity = Math.min(110, Math.max(30, Math.round(action.value)))
    let changed = false
    const melodyEvents = progress.project.melodyEvents.map((event) => {
      if (event.id !== action.eventId) return event
      if (event.velocity === nextVelocity) return event
      changed = true
      return { ...event, velocity: nextVelocity }
    })
    if (!changed) return progress
    return updateRecord(
      { ...progress, project: { ...progress.project, melodyEvents, revision: progress.project.revision + 1 } },
      8,
      (record) => ({
        ...record,
        values: {
          ...record.values,
          fullPlayback: false,
          velocityEditedEventIds: unique([...strings(record.values.velocityEditedEventIds), action.eventId]),
        },
      }),
      now,
    )
  }
  if (action.type === 'SET_MIX') {
    if (progress.sessions['8'].stage !== 'make') return progress
    if (!Number.isFinite(action.value)) return progress
    const limit = action.key === 'reverb' ? 40 : 100
    const nextValue = Math.min(limit, Math.max(0, Math.round(action.value)))
    if (progress.project[action.key] === nextValue) return progress
    return updateRecord(
      {
        ...progress,
        project: { ...progress.project, [action.key]: nextValue, revision: progress.project.revision + 1 },
      },
      8,
      (record) => ({ ...record, values: { ...record.values, fullPlayback: false } }),
      now,
    )
  }
  if (action.type === 'CONFIRM_PROJECT_PLAYBACK') {
    const expectedEnd = action.session === 6 ? 4 * TICKS_PER_BAR : 8 * TICKS_PER_BAR
    if (!validPlaybackReceipt(action.receipt, action.currentAudioEpoch, progress, expectedEnd)) return progress
    const record = progress.sessions[String(action.session)]
    if (record.stage !== 'make') return progress
    const key = action.session === 5
      ? 'auditioned'
      : action.session === 6
        ? 'playedBack'
        : action.session === 7
          ? 'reviewedArrangement'
          : 'fullPlayback'
    const revisionKey = action.session === 5
      ? 'auditionedProjectRevision'
      : action.session === 6
        ? 'playedBackProjectRevision'
        : action.session === 7
          ? 'reviewedProjectRevision'
          : 'fullPlaybackProjectRevision'
    return updateRecord(progress, action.session, (item) => ({
      ...item,
      playbackReceipts: [...(item.playbackReceipts ?? []), JSON.parse(JSON.stringify(action.receipt)) as PlaybackReceipt].slice(-8),
      values: {
        ...item.values,
        [key]: true,
        [revisionKey]: action.receipt.projectRevision,
        [`${key}AudioEpoch`]: action.receipt.audioEpoch,
        [`${key}AudioRun`]: action.receipt.runId,
        [`${key}Range`]: `${action.receipt.sequenceStartTick}:${action.receipt.sequenceEndTick}`,
      },
    }), now)
  }
  if (action.type === 'PRACTICE_CLIP_EDIT') {
    const record = progress.sessions['5']
    if (record.stage !== 'make') return progress
    const operations = strings(record.values.editOperations)
    const expected = ['move', 'resize', 'duplicate', 'undo'] as const
    if (action.operation !== expected[operations.length]) return progress
    const values = {
      ...record.values,
      editOperations: [...operations, action.operation],
      editBar: action.operation === 'move' ? 1 : number(record.values.editBar),
      editLength:
        action.operation === 'resize'
          ? 2
          : number(record.values.editLength) || 1,
      editCopies:
        action.operation === 'duplicate'
          ? 2
          : action.operation === 'undo'
            ? 1
            : number(record.values.editCopies) || 1,
    }
    return updateRecord(progress, 5, (item) => ({ ...item, values }), now)
  }
  if (action.type === 'MAKE_UNIQUE_CLIP') {
    if (progress.sessions['7'].stage !== 'make') return progress
    const clip = progress.project.content.clips.find((candidate) => candidate.id === action.clipId)
    if (!clip || progress.project.content.clips.filter((candidate) => candidate.patternId === clip.patternId).length < 2) return progress
    return { ...progress, project: { ...progress.project, revision: progress.project.revision + 1 }, updatedAt: now }
  }

  if (action.type === 'UNDO_PROJECT' || action.type === 'REDO_PROJECT') return progress
  const record = progress.sessions[String(action.session)]
  switch (action.type) {
    case 'START':
      return record.stage === 'welcome'
        ? updateRecord(progress, action.session, (item) => ({ ...item, stage: 'learn', learning: item.learning ?? createGuidedLearningState(progress, action.session, now) }), now)
        : progress
    case 'MARK': {
      const requiredStage = action.area === 'learned' ? 'learn' : action.area === 'made' ? 'make' : 'check'
      if (record.stage !== requiredStage) return progress
      return updateRecord(progress, action.session, (item) => ({ ...item, [action.area]: unique([...item[action.area], action.key]) }), now)
    }
    case 'SET_VALUE':
      if (record.stage === 'welcome' || record.stage === 'evidence') return progress
      return updateRecord(progress, action.session, (item) => ({ ...item, values: { ...item.values, [action.key]: action.value } }), now)
    case 'INCREMENT': {
      if (record.stage === 'welcome' || record.stage === 'evidence') return progress
      const value = Math.min(action.max ?? 999, number(record.values[action.key]) + 1)
      return updateRecord(progress, action.session, (item) => ({ ...item, values: { ...item.values, [action.key]: value } }), now)
    }
    case 'APPEND': {
      if (record.stage !== 'check') return progress
      const values = [...strings(record.values[action.key]), action.value].slice(-(action.max ?? 20))
      return updateRecord(progress, action.session, (item) => ({ ...item, values: { ...item.values, [action.key]: values } }), now)
    }
    case 'GO_MAKE':
      return record.stage === 'learn' && learnComplete(progress, action.session)
        ? updateRecord(progress, action.session, (item) => ({ ...item, stage: 'make' }), now)
        : progress
    case 'GO_CHECK':
      return record.stage === 'make' && makeComplete(progress, action.session)
        ? updateRecord(progress, action.session, (item) => ({ ...item, stage: 'check', checked: [] }), now)
        : progress
    case 'FINALIZE':
      return record.stage === 'check' && canFinalizeGuidedSession(progress, action.session)
        ? updateRecord(progress, action.session, (item) => {
          const evidence = item.learning?.earned.filter((candidate) => candidate.objectiveId === `session-${action.session}`).at(-1)
          return evidence ? { ...item, stage: 'evidence', checkpoint: { name: checkpointNames[action.session], savedAt: now, verification: 'typed-earned', evidenceId: evidence.id, result: evidence.result } } : item
        }, now)
        : progress
    case 'RESET_SESSION': {
      let project = progress.project
      const sessions = {
        ...progress.sessions,
        [String(action.session)]: blankRecord(),
      }
      if (action.session === 5) {
        project = { ...createInitialCourseProgress(now).project, id: project.id }
        ;[6, 7, 8].forEach((id) => {
          sessions[String(id)] = blankRecord()
        })
      }
      if (action.session === 6) {
        project = {
          ...project,
          melodyEvents: [],
          nextMelodyEventId: 1,
          chordLevel: 72,
          melodyLevel: 78,
          reverb: 12,
        }
        ;[7, 8].forEach((id) => {
          sessions[String(id)] = blankRecord()
        })
      }
      if (action.session === 7) {
        project = {
          ...project,
          melodyEvents: project.melodyEvents
            .filter((event) => event.patternId === 'melody-a')
            .map((event) => ({ ...event, velocity: 72 })),
          chordLevel: 72,
          melodyLevel: 78,
          reverb: 12,
        }
        sessions['8'] = blankRecord()
      }
      if (action.session === 8) project = {
        ...project,
        melodyEvents: project.melodyEvents.map((event) => ({ ...event, velocity: 72 })),
        chordLevel: 72,
        melodyLevel: 78,
        reverb: 12,
      }
      project = { ...project, revision: progress.project.revision + 1 }
      return { ...progress, project, sessions, updatedAt: now }
    }
  }
}

function validPlaybackReceipt(receiptValue: unknown, currentAudioEpoch: unknown, progress: CourseProgress, expectedEnd: number): receiptValue is PlaybackReceipt {
  if (!isAcknowledgedPlaybackReceipt(receiptValue)) return false
  const receipt = receiptValue
  const render = receipt.renderConfiguration
  const expectedChannels = Object.fromEntries(Object.entries(progress.project.content.channels).map(([id, channel]) => [id, { gain: channel.gain, muted: channel.muted, reverbSend: channel.reverbSend }]))
  return receipt.projectId === progress.project.id && receipt.projectRevision === progress.project.revision &&
    receipt.renderState === 'tone-transport-acknowledged' &&
    receipt.sequenceStartTick === 0 && receipt.sequenceEndTick === expectedEnd &&
    receipt.projectContentFingerprint === projectContentFingerprint(progress.project.content) &&
    receipt.audioEpoch === currentAudioEpoch &&
    render.bpm === progress.project.content.bpm && render.meter === progress.project.content.meter &&
    JSON.stringify(render.channels) === JSON.stringify(expectedChannels) && typeof receipt.acknowledgedAt === 'string' && receipt.acknowledgedAt.length > 0
}

function safeStringArray(value: unknown, max = 40): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === 'string').slice(0, max))
    : []
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function safeLegacyMelody(value: unknown): string[][] {
  if (!Array.isArray(value)) return [[], [], [], []]
  return [0, 1, 2, 3].map((index) => Array.isArray(value[index])
    ? value[index]
      .filter((note): note is string => typeof note === 'string' && scaleNotes.includes(note))
      .slice(0, 6)
    : [])
}

function numberIn(input: unknown, fallback: number, min: number, max: number): number {
  return typeof input === 'number' && Number.isFinite(input)
    ? Math.min(max, Math.max(min, Math.round(input)))
    : fallback
}

function migrateLegacyMelody(rawProject: UnknownRecord): {
  events: MelodyNoteEvent[]
  nextId: number
  editedVelocityIds: string[]
  editedVelocitySlots: string[]
} {
  const halves = [safeLegacyMelody(rawProject.melodyA), safeLegacyMelody(rawProject.melodyB)]
  const legacyVelocities = Array.isArray(rawProject.velocities) ? rawProject.velocities : []
  const velocitySlots = legacyVelocities.length
    ? [0, 1, 2, 3].map((index) => numberIn(legacyVelocities[index], 72, 30, 110))
    : [72, 72, 72, 72]
  const events: MelodyNoteEvent[] = []
  const aOrigins = new Map<string, string>()
  const velocityRepresentatives = new Map<number, string>()
  let nextId = 1

  halves.forEach((bars, halfIndex) => {
    bars.forEach((notes, barWithinHalf) => {
      const globalBar = barWithinHalf + halfIndex * 4
      const spacing = TICKS_PER_BAR / Math.max(2, notes.length)
      notes.forEach((note, noteIndex) => {
        const id = `note-${nextId++}`
        const originKey = `${barWithinHalf}:${noteIndex}`
        const event: MelodyNoteEvent = {
          id,
          pitch: midiForNoteName(note),
          startTick: globalBar * TICKS_PER_BAR + Math.round(noteIndex * spacing),
          durationTicks: Math.max(1, Math.round(Math.min(612, spacing * 0.82))),
          velocity: velocitySlots[noteIndex % velocitySlots.length],
          trackId: 'melody',
          patternId: halfIndex === 0 ? 'melody-a' : 'melody-b',
          source: 'legacy',
          timingInferred: true,
        }
        if (halfIndex === 0) aOrigins.set(originKey, id)
        else event.originId = aOrigins.get(originKey)
        events.push(event)
        if (velocitySlots[noteIndex % velocitySlots.length] !== 72 && !velocityRepresentatives.has(noteIndex % velocitySlots.length)) {
          velocityRepresentatives.set(noteIndex % velocitySlots.length, id)
        }
      })
    })
  })

  return {
    events: sortMelodyEvents(events),
    nextId,
    editedVelocityIds: [...velocityRepresentatives.values()],
    editedVelocitySlots: velocitySlots
      .map((velocity, index) => velocity !== 72 ? `legacy-slot-${index}` : '')
      .filter(Boolean),
  }
}

function normalizeV2Melody(value: unknown): { events: MelodyNoteEvent[]; nextId: number } {
  if (!Array.isArray(value)) return { events: [], nextId: 1 }
  const used = new Set<string>()
  let nextId = 1
  const allocateId = () => {
    if (nextId > MAX_MELODY_EVENT_ID) nextId = 1
    while (used.has(`note-${nextId}`)) {
      nextId = nextId >= MAX_MELODY_EVENT_ID ? 1 : nextId + 1
    }
    const id = `note-${nextId}`
    nextId = nextId >= MAX_MELODY_EVENT_ID ? 1 : nextId + 1
    return id
  }
  const events: MelodyNoteEvent[] = []

  for (const item of value.slice(0, 96)) {
    if (!isRecord(item)) continue
    const pitch = item.pitch
    const startTick = item.startTick
    const durationTicks = item.durationTicks
    const velocity = item.velocity
    if (
      typeof pitch !== 'number' || !Number.isInteger(pitch) || pitch < 0 || pitch > 127 ||
      typeof startTick !== 'number' || !Number.isInteger(startTick) || startTick < 0 || startTick >= TICKS_PER_BAR * 8 ||
      typeof durationTicks !== 'number' || !Number.isInteger(durationTicks) || durationTicks < 1 ||
      typeof velocity !== 'number' || !Number.isInteger(velocity) || velocity < 1 || velocity > 127
    ) continue
    const bar = Math.floor(startTick / TICKS_PER_BAR)
    if (startTick + durationTicks > (bar + 1) * TICKS_PER_BAR) continue
    if (item.trackId !== 'melody' || !['draw', 'screen', 'computer', 'midi', 'duplicate', 'legacy'].includes(String(item.source))) continue

    const requestedId = typeof item.id === 'string' && item.id.length <= 64 ? item.id : ''
    const id = requestedId && !used.has(requestedId) ? requestedId : allocateId()
    used.add(id)
    const numericId = /^note-(\d+)$/.exec(id)
    if (numericId) {
      const suffix = Number(numericId[1])
      if (Number.isSafeInteger(suffix) && suffix >= 1 && suffix < MAX_MELODY_EVENT_ID) {
        nextId = Math.max(nextId, suffix + 1)
      }
    }
    events.push({
      id,
      pitch,
      startTick,
      durationTicks,
      velocity,
      trackId: 'melody',
      patternId: bar < 4 ? 'melody-a' : 'melody-b',
      source: item.source as MelodyNoteEvent['source'],
      ...(typeof item.originId === 'string' && item.originId.length <= 64 ? { originId: item.originId } : {}),
      ...(item.timingInferred === true ? { timingInferred: true } : {}),
    })
  }

  const aById = new Map(events
    .filter((event) => event.patternId === 'melody-a')
    .map((event) => [event.id, event]))
  const claimedOrigins = new Set<string>()
  const normalized = events.map((event) => {
    if (event.patternId === 'melody-a') {
      return event.originId ? { ...event, originId: undefined } : event
    }
    if (!event.originId) return event
    const origin = aById.get(event.originId)
    const sameRelativeBar = origin && eventBar(origin) === eventBar(event) - 4
    if (!origin || !sameRelativeBar || claimedOrigins.has(event.originId)) {
      return { ...event, originId: undefined }
    }
    claimedOrigins.add(event.originId)
    return event
  })
  return {
    events: sortMelodyEvents(normalized),
    nextId: nextAvailableMelodyEventNumber(normalized, nextId),
  }
}

export function normalizeCourseProgress(
  value: unknown,
  now = new Date().toISOString(),
): CourseProgress {
  const initial = createInitialCourseProgress(now)
  if (!isRecord(value) || ![1, 2].includes(Number(value.version))) return initial
  const isLegacy = value.version === 1
  const rawProject = isRecord(value.project) ? value.project : {}
  const rawSessions = isRecord(value.sessions) ? value.sessions : {}
  const chords = Array.isArray(rawProject.chords)
    ? rawProject.chords.slice(0, 8).map((chord) => (typeof chord === 'string' && Object.hasOwn(chordNotes, chord) ? chord : ''))
    : []
  const normalizedMelody = isLegacy
    ? migrateLegacyMelody(rawProject)
    : {
      ...normalizeV2Melody(rawProject.melodyEvents),
      editedVelocityIds: [] as string[],
      editedVelocitySlots: [] as string[],
    }
  const progress: CourseProgress = {
    version: 2,
    sessions: {},
    project: {
      ...initial.project,
      id: isOpaqueProjectId(rawProject.id) ? rawProject.id : initial.project.id,
      chords,
      melodyEvents: normalizedMelody.events,
      nextMelodyEventId: nextAvailableMelodyEventNumber(
        normalizedMelody.events,
        Math.max(
          normalizedMelody.nextId,
          numberIn(rawProject.nextMelodyEventId, normalizedMelody.nextId, 1, MAX_MELODY_EVENT_ID),
        ),
      ),
      revision: numberIn(rawProject.revision, 0, 0, 1_000_000_000),
      chordLevel: numberIn(rawProject.chordLevel, 72, 0, 100),
      melodyLevel: numberIn(rawProject.melodyLevel, 78, 0, 100),
      reverb: numberIn(rawProject.reverb, 12, 0, 40),
      content: initial.project.content,
    },
    history: emptyProjectHistory(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
  const rawContent = rawProject.content
  if (rawContent !== undefined && !isValidProjectContent(rawContent)) {
    throw new Error('Corrupt canonical project content')
  }
  progress.project = isValidProjectContent(rawContent)
    ? { ...progress.project, ...projectProjectionFromContent(rawContent), content: cloneProjectContent(rawContent) }
    : (() => {
      const content = createProjectContent(progress.project)
      return { ...progress.project, ...projectProjectionFromContent(content), content }
    })()
  progress.history = isValidCommandHistory(value.history, progress.project.content)
    ? {
      past: value.history.past.map((command) => ({ ...command, before: cloneProjectContent(command.before), after: cloneProjectContent(command.after) })),
      future: value.history.future.map((command) => ({ ...command, before: cloneProjectContent(command.before), after: cloneProjectContent(command.after) })),
      nextCommandId: value.history.nextCommandId,
    }
    : emptyProjectHistory()
  for (const id of guidedSessionIds) {
    const rawCandidate = rawSessions[String(id)]
    const raw: UnknownRecord = isRecord(rawCandidate) ? rawCandidate : {}
    const stage = ['welcome', 'learn', 'make', 'check', 'evidence'].includes(String(raw.stage)) ? raw.stage as GuidedStage : 'welcome'
    const values = isRecord(raw.values)
      ? Object.fromEntries(Object.entries(raw.values).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item) || (Array.isArray(item) && item.every((entry) => typeof entry === 'string' || typeof entry === 'number')))) as Record<string, CourseValue>
      : {}
    if (isLegacy && id === 8 && normalizedMelody.editedVelocityIds.length) {
      values.velocityEditedEventIds = normalizedMelody.editedVelocityIds
    }
    if (isLegacy && id === 8 && normalizedMelody.editedVelocitySlots.length) {
      values.legacyVelocityEditedSlots = normalizedMelody.editedVelocitySlots
    }
    if (isLegacy && id === 7 && normalizedMelody.events.some((event) => event.patternId === 'melody-b')) {
      values.legacyVariationImported = true
    }
    if (isLegacy && id === 5 && values.auditioned === true) {
      values.auditionedProjectRevision = progress.project.revision
    }
    if (isLegacy && id === 7 && values.reviewedArrangement === true) {
      values.reviewedProjectRevision = progress.project.revision
    }
    if (isLegacy && id === 8 && values.fullPlayback === true) {
      values.fullPlaybackProjectRevision = progress.project.revision
    }
    progress.sessions[String(id)] = {
      stage,
      learned: safeStringArray(raw.learned),
      made: safeStringArray(raw.made),
      checked: safeStringArray(raw.checked),
      values,
      ...(Array.isArray(raw.playbackReceipts) ? { playbackReceipts: raw.playbackReceipts.filter(isAcknowledgedPlaybackReceipt).slice(-8).map((receipt) => JSON.parse(JSON.stringify(receipt)) as PlaybackReceipt) } : {}),
      ...(normalizeGuidedLearning(raw.learning, id) ? { learning: normalizeGuidedLearning(raw.learning, id) } : {}),
    }
    const current = progress.sessions[String(id)]
    const checkpoint = isRecord(raw.checkpoint) ? raw.checkpoint : undefined
    const typedEvidence = current.learning?.earned.find((evidence) => evidence.id === checkpoint?.evidenceId && evidence.objectiveId === `session-${id}`)
    if (current.stage === 'evidence' && checkpoint?.name === checkpointNames[id] && typeof checkpoint.savedAt === 'string' && checkpoint.verification === 'typed-earned' && typedEvidence) {
      current.checkpoint = { name: checkpoint.name, savedAt: checkpoint.savedAt, verification: 'typed-earned', evidenceId: typedEvidence.id, result: typedEvidence.result }
    } else {
      if (current.stage === 'make' && !learnComplete(progress, id)) current.stage = 'learn'
      if (['check', 'evidence'].includes(current.stage) && !makeComplete(progress, id)) current.stage = learnComplete(progress, id) ? 'make' : 'learn'
      else if (current.stage === 'evidence') current.stage = checkComplete(progress, id) ? 'check' : 'make'
    }
  }
  return progress
}

function normalizeGuidedLearning(value: unknown, session: GuidedSessionId): GuidedLearningState | undefined {
  if (!isRecord(value) || !validLearningAttempt(value.current, session) || !Array.isArray(value.archived) || value.archived.length > 50 || !value.archived.every((entry) => validLearningAttempt(entry, session)) || !Array.isArray(value.earned) || value.earned.length > 50) return undefined
  if (!value.earned.every((entry) => validEarnedLearningRecord(entry, session))) return undefined
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > 500_000) return undefined
    return JSON.parse(serialized) as GuidedLearningState
  } catch {
    return undefined
  }
}

function validEarnedLearningRecord(value: unknown, session: GuidedSessionId): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length > 140 || value.objectiveId !== `session-${session}` ||
      !['supported', 'independent'].includes(String(value.result)) || typeof value.earnedAt !== 'string' || !validLearningAttempt(value.attemptSnapshot, session) || !isLearningProjectReference(value.projectSnapshot)) return false
  const snapshot = value.attemptSnapshot as UnknownRecord
  const projectSnapshot = value.projectSnapshot as LearningProjectReference
  const attemptProject = snapshot.project as LearningProjectReference
  return snapshot.origin === 'fresh' && snapshot.stage === 'reflect' && snapshot.result === value.result &&
    value.id === `earned:${snapshot.id}:${snapshot.generation}` && sameLearningProjectReference(projectSnapshot, attemptProject) &&
    isRecord(snapshot.artifact) && validGuidedArtifactForAttempt(snapshot.artifact, snapshot as unknown as LearningAttempt<GuidedCheckArtifact>, session)
}

function validLearningAttempt(value: unknown, session: GuidedSessionId): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9:._-]{1,100}$/.test(value.id) || value.objectiveId !== `session-${session}` ||
      value.origin !== 'fresh' || !isLearningProjectReference(value.project) ||
      !['hear', 'notice', 'explain', 'try', 'choose', 'apply', 'independent-check', 'reflect'].includes(String(value.stage)) ||
      !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 || !Array.isArray(value.support) || value.support.length > 20 ||
      !value.support.every((event) => isRecord(event) && ['nudge', 'cue', 'example'].includes(String(event.level)) && typeof event.at === 'string') ||
      typeof value.explanation !== 'string' || value.explanation.length > 500 || typeof value.reflection !== 'string' || value.reflection.length > 500 ||
      !['not-yet', 'supported', 'independent'].includes(String(value.result)) || typeof value.startedAt !== 'string' || typeof value.updatedAt !== 'string') return false
  const supportCount = value.support.length
  if (value.result === 'independent' && (supportCount !== 0 || value.stage !== 'reflect')) return false
  if (value.result === 'supported' && (supportCount === 0 || value.stage !== 'reflect')) return false
  if (value.result !== 'not-yet' && !Object.hasOwn(value, 'artifact')) return false
  return !Object.hasOwn(value, 'artifact') || validGuidedArtifactForAttempt(value.artifact, value as unknown as LearningAttempt<GuidedCheckArtifact>, session)
}

function isLearningProjectReference(value: unknown): value is LearningProjectReference {
  return isRecord(value) && isOpaqueProjectId(value.projectId) && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 &&
    typeof value.contentFingerprint === 'string' && /^fnv1a32-[0-9a-f]{8}$/.test(value.contentFingerprint)
}

function validGuidedArtifactForAttempt(value: unknown, attempt: LearningAttempt<GuidedCheckArtifact>, session: GuidedSessionId): value is GuidedCheckArtifact {
  if (!isRecord(value) || value.session !== session || !isRecord(value.check)) return false
  const check = value.check
  if (session === 2) {
    if (check.attemptId !== attempt.id || check.generation !== attempt.generation || !Array.isArray(check.tapTimesMs) || ![1, 2, 3, 4].includes(Number(check.chosenDownbeat)) || !isRecord(check.freshBar) || !Array.isArray(check.freshBar.beats) || typeof check.freshBar.explainedDownbeat !== 'string') return false
    return session2Complete(check as unknown as Session2Check, { attemptId: attempt.id, generation: attempt.generation })
  }
  if (session === 4) {
    if (!isRecord(check.constructions) || !isRecord(check.freshRepair) || typeof check.moodContext !== 'string' || typeof check.explanation !== 'string') return false
    return session4Complete(check as unknown as Session4Check, { F: childAttemptContext(attempt, 'F'), C: childAttemptContext(attempt, 'C'), G: childAttemptContext(attempt, 'G'), repair: childAttemptContext(attempt, 'repair') })
  }
  if (session === 5) {
    return check.attemptId === attempt.id && check.generation === attempt.generation && isLearningProjectReference(check.project) &&
      isRecord(check.move) && isRecord(check.resize) && isRecord(check.duplicate) && isRecord(check.undo) && isRecord(check.undo.undoneCommand) &&
      isRecord(check.freshDisplacedClipRepair) && isRecord(check.audition) && isAcknowledgedPlaybackReceipt(check.audition.receipt) &&
      typeof check.explanation === 'string' && check.explanation.length <= 500
  }
  return false
}

function sameLearningProjectReference(left: LearningProjectReference, right: LearningProjectReference): boolean {
  return left.projectId === right.projectId && left.revision === right.revision && left.contentFingerprint === right.contentFingerprint
}

const projectActionLabels: Partial<Record<CourseAction['type'], string>> = {
  SET_CHORD: 'Place chord clip',
  ADD_MELODY_NOTE: 'Add melody note',
  REMOVE_MELODY_NOTE: 'Remove melody note',
  SET_MELODY_PITCH: 'Change melody pitch',
  SET_MELODY_TIMING: 'Change melody timing',
  DUPLICATE_MELODY: 'Duplicate melody clip',
  MAKE_UNIQUE_CLIP: 'Make clip unique',
  SET_EVENT_VELOCITY: 'Change note velocity',
  SET_MIX: 'Change mixer control',
  RESET_SESSION: 'Reset project layer',
}

function projectFromContent(project: EmotiveProject, content: ProjectContent, revision: number): EmotiveProject {
  return { ...project, ...projectProjectionFromContent(content), content: cloneProjectContent(content), revision }
}

function reconcileAfterHistory(progress: CourseProgress): CourseProgress {
  const hasSecondClip = progress.project.content.clips.some((clip) => clip.id === 'clip-melody-b')
  const sessions = { ...progress.sessions }
  const updateValues = (id: number, removed: string[]) => {
    const record = sessions[String(id)]
    const values = { ...record.values }
    removed.forEach((key) => delete values[key])
    sessions[String(id)] = { ...record, values }
  }
  const session7 = sessions['7']
  sessions['7'] = {
    ...session7,
    made: hasSecondClip
      ? unique([...session7.made, 'duplicated-phrase'])
      : session7.made.filter((item) => item !== 'duplicated-phrase'),
  }
  updateValues(5, ['auditioned', 'auditionedProjectRevision'])
  updateValues(6, ['playedBack', 'playedBackProjectRevision', 'revisedAfterPlayback'])
  updateValues(7, ['reviewedArrangement', 'reviewedProjectRevision'])
  updateValues(8, ['fullPlayback', 'fullPlaybackProjectRevision'])
  return { ...progress, sessions }
}

export function courseReducer(progress: CourseProgress, action: CourseAction): CourseProgress {
  const canonicalProject = isValidProjectContent(progress.project.content)
    ? progress.project
    : ensureCanonicalProject(progress.project)
  const canonical = canonicalProject === progress.project ? progress : { ...progress, project: canonicalProject }
  if (action.type === 'APPLY_PROJECT_EDIT') {
    if (!sameLearningProjectReference(action.expectedProject, currentProjectReference(canonical)) || action.label.trim().length < 1 || action.label.length > 80) return canonical
    const content = applyProjectGraphEdit(canonical.project.content, action.edit)
    if (JSON.stringify(content) === JSON.stringify(canonical.project.content)) return canonical
    return {
      ...canonical,
      project: projectFromContent(canonical.project, content, canonical.project.revision + 1),
      history: appendProjectCommand(canonical.history, action.label, canonical.project.content, content, new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    }
  }
  if (action.type === 'UNDO_PROJECT') {
    const command = canonical.history.past.at(-1)
    if (!command) return canonical
    return reconcileAfterHistory({
      ...canonical,
      project: projectFromContent(canonical.project, command.before, canonical.project.revision + 1),
      history: {
        ...canonical.history,
        past: canonical.history.past.slice(0, -1),
        future: [command, ...canonical.history.future],
      },
      updatedAt: new Date().toISOString(),
    })
  }
  if (action.type === 'REDO_PROJECT') {
    const command = canonical.history.future[0]
    if (!command) return canonical
    return reconcileAfterHistory({
      ...canonical,
      project: projectFromContent(canonical.project, command.after, canonical.project.revision + 1),
      history: {
        ...canonical.history,
        past: [...canonical.history.past, command].slice(-100),
        future: canonical.history.future.slice(1),
      },
      updatedAt: new Date().toISOString(),
    })
  }
  const next = courseReducerInternal(canonical, action)
  const label = projectActionLabels[action.type]
  if (!label || next.project === canonical.project) return next
  let content = canonical.project.content
  if (action.type === 'SET_CHORD') {
    content = applyProjectGraphEdit(content, { type: 'set-chord', bar: action.bar, chord: action.chord })
  } else if (action.type === 'ADD_MELODY_NOTE') {
    const priorIds = new Set(canonical.project.melodyEvents.map((event) => event.id))
    const event = next.project.melodyEvents.find((candidate) => !priorIds.has(candidate.id))
    if (event) content = applyProjectGraphEdit(content, { type: 'add-note', event })
  } else if (action.type === 'REMOVE_MELODY_NOTE') {
    const remaining = new Set(next.project.melodyEvents.map((event) => event.id))
    const id = canonical.project.melodyEvents.find((event) => !remaining.has(event.id))?.id
    if (id) content = applyProjectGraphEdit(content, { type: 'remove-note', instanceId: id })
  } else if (action.type === 'SET_MELODY_PITCH') {
    const event = next.project.melodyEvents.find((candidate) => candidate.id === action.eventId)
    if (event) content = applyProjectGraphEdit(content, { type: 'set-note-pitch', instanceId: action.eventId, pitch: event.pitch })
  } else if (action.type === 'SET_MELODY_TIMING') {
    const event = next.project.melodyEvents.find((candidate) => candidate.id === action.eventId)
    if (event) content = applyProjectGraphEdit(content, { type: 'set-note-timing', instanceId: action.eventId, startTick: event.startTick, durationTicks: event.durationTicks })
  } else if (action.type === 'SET_EVENT_VELOCITY') {
    const event = next.project.melodyEvents.find((candidate) => candidate.id === action.eventId)
    if (event) content = applyProjectGraphEdit(content, { type: 'set-note-velocity', instanceId: action.eventId, velocity: event.velocity })
  } else if (action.type === 'DUPLICATE_MELODY') {
    content = applyProjectGraphEdit(content, { type: 'duplicate-melody' })
  } else if (action.type === 'MAKE_UNIQUE_CLIP') {
    content = applyProjectGraphEdit(content, { type: 'make-unique', clipId: action.clipId })
  } else if (action.type === 'SET_MIX') {
    content = applyProjectGraphEdit(content, { type: 'set-mix', key: action.key, value: action.value })
  } else if (action.type === 'RESET_SESSION') {
    content = applyProjectGraphEdit(content, { type: 'reset-session', session: action.session as 5 | 6 | 7 | 8 })
  }
  if (JSON.stringify(content) === JSON.stringify(canonical.project.content)) return { ...next, project: canonical.project }
  const revision = canonical.project.revision + 1
  return {
    ...next,
    project: projectFromContent(next.project, content, revision),
    history: appendProjectCommand(canonical.history, label, canonical.project.content, content, next.updatedAt),
  }
}
