import { exactObject } from '../mira/contracts'
import { isMelodicSound, isSoundId, type SoundId, type StudioProject } from './model'
import { FIRST_SONG_STEP_IDS, type FirstSongStepId } from './firstSongGuide'
import { validateMiraPassage, type MiraPassage } from './miraPassage'
import { MIRA_EXAMPLE_ERROR, validateMiraExample, type MiraExample } from './miraExample'
import { routeStudioQuestion, STUDIO_HELP_TOPICS, unsupportedStudioQuestion, isAmbiguousInstrumentChange, type StudioHelpTopic } from './studioHelp'
import { expandStudioActionShorthand } from './studioGuidanceActions'

export interface StudioMiraFacts { trackKind: 'none' | 'melodic' | 'drums'; hasClip: boolean; hasNotes: boolean; linkedUses: number; canUndo: boolean; saved: boolean }
export interface StudioMiraUiContext {
  activePanel: 'unknown' | 'notes' | 'drums' | 'arrangement' | 'mixer' | 'sounds' | 'keyboard' | 'ideas'
  noteSelection: 'unknown' | 'none' | 'one' | 'multiple'
  shownBars: 0 | 1 | 2 | 4
  activeTool: 'unknown' | 'draw' | 'select' | 'erase'
  latestRejection: 'unknown' | 'none' | 'note' | 'drum' | 'clip' | 'other'
  destinationKind: 'unknown' | 'none' | 'melodic' | 'drums'
}
export type StudioMiraFactsV3 = StudioMiraFacts & StudioMiraUiContext
export interface StudioMiraAudioFacts { selectedSound: SoundId | null; soundReadiness: 'unknown' | 'loading' | 'ready' | 'error'; playback: 'stopped' | 'playing' | 'paused'; recording: boolean }
export type StudioMiraFactsV6 = StudioMiraFactsV3 & StudioMiraAudioFacts
export interface StudioMiraSession { goal: string; currentStep: FirstSongStepId | null }
interface StudioMiraRequestBase { requestId: string; revision: number; question: string; history: { role: 'user' | 'assistant'; text: string }[] }
export type StudioMiraRequest = StudioMiraRequestBase & ({ version: 2 | 3; workspace: StudioMiraFacts | StudioMiraFactsV3 } | { version: 4 | 5; workspace: StudioMiraFactsV3; passage: MiraPassage | null; session: StudioMiraSession | null } | { version: 6; workspace: StudioMiraFactsV6; passage: MiraPassage | null; session: StudioMiraSession | null })
export interface StudioMiraSelection { topic: StudioHelpTopic | null; stepIds: string[]; explanation: string; observation?: string; rationale?: string; action?: string; clarification?: string | null; example?: MiraExample | null; exampleError?: string | null }
export interface StudioMiraResponse { version: 2 | 3 | 4 | 5 | 6; requestId: string; revision: number; source: 'authored' | 'live'; reason: string; transmission: 'not-sent' | 'sent'; selection: StudioMiraSelection }
export function currentStudioLiveResponse(response: StudioMiraResponse | undefined, responseContext: string, currentContext: string): boolean {
  return response?.source === 'live' && responseContext === currentContext
}
const topics = Object.keys(STUDIO_HELP_TOPICS) as StudioHelpTopic[]
const v5OnlyTopics: readonly StudioHelpTopic[] = ['select-chord', 'move-notes', 'resize-notes']
const v6OnlyTopics: readonly StudioHelpTopic[] = ['pan', 'space', 'expression']
const v5Topics = topics.filter(topic => !v6OnlyTopics.includes(topic))
const legacyTopics = v5Topics.filter(topic => !v5OnlyTopics.includes(topic))
const topicsForVersion = (version: StudioMiraRequest['version']) => version >= 6 ? topics : version === 5 ? v5Topics : legacyTopics
export function studioTopicsForVersion(version: StudioMiraRequest['version']): Partial<typeof STUDIO_HELP_TOPICS> {
  return Object.fromEntries(topicsForVersion(version).map(topic => [topic, STUDIO_HELP_TOPICS[topic]]))
}
function routedTopicForVersion(question: string, version: StudioMiraRequest['version']): StudioHelpTopic | null {
  const topic = routeStudioQuestion(question)
  if (version < 6 && topic && v6OnlyTopics.includes(topic)) return null
  return version < 5 && topic && v5OnlyTopics.includes(topic) ? 'notes' : topic
}
const clipTopics: readonly StudioHelpTopic[] = ['record', 'independent', 'linked', 'arrange', 'notes', 'select-chord', 'move-notes', 'resize-notes', 'delete-note', 'delete-clip', 'unlink']
export function studioFacts(project: StudioProject, trackId?: string | null, clipId?: string | null, canUndo = false, saved = false): StudioMiraFacts {
  const track = project.tracks.find(item => item.id === trackId), clip = project.clips.find(item => item.id === clipId && item.trackId === trackId)
  return { trackKind: !track ? 'none' : isMelodicSound(track.soundId) ? 'melodic' : 'drums', hasClip: !!clip,
    hasNotes: !!project.patterns.find(pattern => pattern.id === clip?.patternId)?.notes.length,
    linkedUses: clip ? project.clips.filter(item => item.patternId === clip.patternId).length : 0, canUndo, saved }
}
export function studioFactsV3(project: StudioProject, trackId?: string | null, clipId?: string | null, canUndo = false, saved = false, ui?: Partial<StudioMiraUiContext>): StudioMiraFactsV3 {
  const facts = studioFacts(project, trackId, clipId, canUndo, saved)
  return { ...facts, activePanel: ui?.activePanel ?? 'unknown', noteSelection: ui?.noteSelection ?? 'unknown', shownBars: ui?.shownBars ?? 0,
    activeTool: ui?.activeTool ?? 'unknown', latestRejection: ui?.latestRejection ?? 'unknown', destinationKind: ui?.destinationKind ?? (facts.hasClip ? facts.trackKind : 'none') }
}
export function studioFactsV6(project: StudioProject, trackId?: string | null, clipId?: string | null, canUndo = false, saved = false, ui?: Partial<StudioMiraUiContext>, audio?: Partial<Omit<StudioMiraAudioFacts, 'selectedSound'>>): StudioMiraFactsV6 {
  return { ...studioFactsV3(project, trackId, clipId, canUndo, saved, ui), selectedSound: project.tracks.find(track => track.id === trackId)?.soundId ?? null,
    soundReadiness: audio?.soundReadiness ?? 'unknown', playback: audio?.playback ?? 'stopped', recording: audio?.recording ?? false }
}
export function studioStepIds(topic: StudioHelpTopic, facts: StudioMiraFacts): string[] {
  if (clipTopics.includes(topic) && !facts.hasClip) return ['choose-clip']
  if (['record', 'select-chord', 'move-notes', 'resize-notes'].includes(topic) && facts.trackKind !== 'melodic') return ['choose-melodic']
  if (['sound', 'delete-track', 'pan', 'space', 'expression'].includes(topic) && facts.trackKind === 'none') return ['choose-track']
  return [topic]
}
export function parseStudioMiraRequest(value: unknown): StudioMiraRequest | null {
  if (!value || typeof value !== 'object') return null
  const version = 'version' in value ? value.version : undefined
  if (!exactObject(value, ['version', 'requestId', 'revision', 'question', 'history', 'workspace', ...(version === 4 || version === 5 || version === 6 ? ['passage', 'session'] : [])]) || (version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6) || typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value.requestId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 500) return null
  if (!Array.isArray(value.history) || value.history.length > (version === 2 ? 4 : 8) || value.history.some(item => !exactObject(item, ['role', 'text']) || !['user', 'assistant'].includes(String(item.role)) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > ((version === 5 || version === 6) && item.role === 'assistant' ? 1200 : 500))) return null
  const w = value.workspace
  const fields = ['trackKind', 'hasClip', 'hasNotes', 'linkedUses', 'canUndo', 'saved']
  if (version === 6) fields.push('selectedSound', 'soundReadiness', 'playback', 'recording')
  if (!exactObject(w, version !== 2 ? [...fields, 'activePanel', 'noteSelection', 'shownBars', 'activeTool', 'latestRejection', 'destinationKind'] : fields) || !['none', 'melodic', 'drums'].includes(String(w.trackKind)) || ['hasClip', 'hasNotes', 'canUndo', 'saved'].some(key => typeof w[key] !== 'boolean') || !Number.isSafeInteger(w.linkedUses) || Number(w.linkedUses) < 0 || Number(w.linkedUses) > 10000) return null
  if (version !== 2 && (!['unknown', 'notes', 'drums', 'arrangement', 'mixer', 'sounds', 'keyboard', 'ideas'].includes(String(w.activePanel)) || !['unknown', 'none', 'one', 'multiple'].includes(String(w.noteSelection)) || ![0, 1, 2, 4].includes(w.shownBars as number) || !['unknown', 'draw', 'select', 'erase'].includes(String(w.activeTool)) || !['unknown', 'none', 'note', 'drum', 'clip', 'other'].includes(String(w.latestRejection)) || !['unknown', 'none', 'melodic', 'drums'].includes(String(w.destinationKind)) || (w.destinationKind !== 'unknown' && w.destinationKind !== (w.hasClip ? w.trackKind : 'none')))) return null
  if ((w.trackKind === 'none' && (w.hasClip || w.hasNotes)) || (!w.hasClip && (w.hasNotes || w.linkedUses !== 0)) || (w.hasClip && Number(w.linkedUses) < 1)) return null
  if (version === 6 && ((w.selectedSound !== null && !isSoundId(w.selectedSound)) || (w.selectedSound === null) !== (w.trackKind === 'none') || (isSoundId(w.selectedSound) && (isMelodicSound(w.selectedSound) ? 'melodic' : 'drums') !== w.trackKind) || !['unknown', 'loading', 'ready', 'error'].includes(String(w.soundReadiness)) || !['stopped', 'playing', 'paused'].includes(String(w.playback)) || typeof w.recording !== 'boolean')) return null
  if (version === 4 || version === 5 || version === 6) {
    if (value.passage !== null && (!validateMiraPassage(value.passage) || !w.hasClip || !w.hasNotes || w.trackKind !== (isMelodicSound(value.passage.soundId) ? 'melodic' : 'drums'))) return null
    const session = value.session
    if (session !== null && (!exactObject(session, ['goal', 'currentStep']) || typeof session.goal !== 'string' || (version !== 6 && !session.goal.trim()) || session.goal.length > 160 || (session.currentStep !== null && !FIRST_SONG_STEP_IDS.includes(session.currentStep as FirstSongStepId)))) return null
  }
  return value as unknown as StudioMiraRequest
}
export function validateStudioSelection(value: unknown, request: StudioMiraRequest): value is StudioMiraSelection {
  if (request.version === 6 && isAmbiguousInstrumentChange(request.question) && (!value || typeof value !== 'object' || !('clarification' in value) || typeof value.clarification !== 'string' || !value.clarification.trim())) return false
  if (!exactObject(value, ['topic', 'stepIds', 'explanation', ...(request.version === 5 ? ['observation', 'rationale', 'action', 'example', 'exampleError'] : request.version === 6 ? ['observation', 'rationale', 'action', 'clarification'] : [])]) || typeof value.explanation !== 'string' || value.explanation.length > (request.version >= 5 ? 1200 : 500) || !Array.isArray(value.stepIds)) return false
  if (request.version === 6 && (!['observation', 'rationale', 'action'].every(key => typeof value[key] === 'string') || (value.clarification !== null && (typeof value.clarification !== 'string' || !value.clarification.trim())) || value.explanation !== [value.observation, value.rationale, value.action, value.clarification].filter(Boolean).join('\n\n') || (value.clarification !== null && (value.topic !== null || value.stepIds.length !== 0 || value.action !== '')))) return false
  if (request.version === 5 && (!['observation', 'rationale', 'action'].every(key => typeof value[key] === 'string')
    || value.explanation !== [value.observation, value.rationale, value.action].filter(Boolean).join('\n\n')
    || (value.exampleError !== null && value.exampleError !== MIRA_EXAMPLE_ERROR)
    || (value.example !== null && (!request.passage || !isMelodicSound(request.passage.soundId) || !validateMiraExample(value.example) || value.exampleError !== null)))) return false
  if (value.topic === null) return value.stepIds.length === 0
  if (request.version < 4 && unsupportedStudioQuestion(request.question)) return false
  if (!topicsForVersion(request.version).includes(value.topic as StudioHelpTopic)) return false
  // Definite authored intents, especially Undo/deletion, cannot be overridden by AI.
  const local = routedTopicForVersion(request.question, request.version)
  if (local && (request.version < 4 || ['undo', 'unlink', 'delete', 'delete-note', 'delete-clip', 'delete-track'].includes(local)) && value.topic !== local) return false
  return JSON.stringify(value.stepIds) === JSON.stringify(studioStepIds(value.topic as StudioHelpTopic, request.workspace))
}
export function authoredStudioResponse(request: StudioMiraRequest, reason = 'built-in', transmission: 'not-sent' | 'sent' = 'not-sent'): StudioMiraResponse {
  const topic = routedTopicForVersion(request.question, request.version)
  return { version: request.version, requestId: request.requestId, revision: request.revision, source: 'authored', reason, transmission, selection: { topic, stepIds: topic ? studioStepIds(topic, request.workspace) : [], explanation: '', ...(request.version === 5 ? { observation: '', rationale: '', action: '', example: null, exampleError: null } : request.version === 6 ? { observation: '', rationale: '', action: '', clarification: null } : {}) } }
}
export function parseStudioMiraResponse(value: unknown, request: StudioMiraRequest): StudioMiraResponse | null {
  if (request.version === 5 && exactObject(value, ['version', 'requestId', 'revision', 'source', 'reason', 'transmission', 'selection'])
    && exactObject(value.selection, ['topic', 'stepIds', 'explanation', 'observation', 'rationale', 'action', 'example', 'exampleError']) && value.selection.example !== null
    && (!request.passage || !isMelodicSound(request.passage.soundId) || !validateMiraExample(value.selection.example))) {
    value = { ...value, selection: { ...value.selection, example: null, exampleError: MIRA_EXAMPLE_ERROR } }
  }
  if (!exactObject(value, ['version', 'requestId', 'revision', 'source', 'reason', 'transmission', 'selection']) || value.version !== request.version || value.requestId !== request.requestId || value.revision !== request.revision || !['authored', 'live'].includes(String(value.source)) || typeof value.reason !== 'string' || value.reason.length > 120 || !['sent', 'not-sent'].includes(String(value.transmission)) || !validateStudioSelection(value.selection, request)) return null
  if (value.source === 'live' && value.transmission !== 'sent') return null
  return value as unknown as StudioMiraResponse
}
export const STUDIO_SELECTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['topic', 'stepIds', 'explanation'], properties: {
    topic: { type: ['string', 'null'], enum: [...legacyTopics, null] },
    stepIds: { type: 'array', items: { type: 'string', enum: [...legacyTopics, 'choose-clip', 'choose-melodic', 'choose-track'] } },
    explanation: { type: 'string' },
  },
} as const

export const STUDIO_SELECTION_V5_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['topic', 'stepIds', 'observation', 'rationale', 'action', 'example'], properties: {
    topic: { type: ['string', 'null'], enum: [...v5Topics, null] },
    stepIds: { type: 'array', items: { type: 'string', enum: [...v5Topics, 'choose-clip', 'choose-melodic', 'choose-track'] } },
    observation: { type: 'string' }, rationale: { type: 'string' }, action: { type: 'string' },
    example: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['notes'], properties: {
      notes: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['pitch', 'startTick', 'durationTicks', 'velocity'], properties: {
        pitch: { type: 'integer', minimum: 0, maximum: 127 }, startTick: { type: 'integer', minimum: 0, maximum: 3839 }, durationTicks: { type: 'integer', minimum: 1, maximum: 3840 }, velocity: { type: 'integer', minimum: 1, maximum: 127 },
      } } },
    } }] },
  },
} as const

export const STUDIO_SELECTION_V6_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['topic', 'stepIds', 'observation', 'rationale', 'action', 'clarification'], properties: {
    topic: { type: ['string', 'null'], enum: [...topics, null] },
    stepIds: { type: 'array', items: { type: 'string', enum: [...topics, 'choose-clip', 'choose-melodic', 'choose-track'] } },
    observation: { type: 'string' }, rationale: { type: 'string' }, action: { type: 'string' }, clarification: { type: ['string', 'null'] },
  },
} as const

/** Validate text separately so a malformed musical example cannot hide useful advice. */
export function studioV6RejectionReason(value: unknown, request: StudioMiraRequest): 'keys-or-types' | 'text-over-limit' | 'clarification-conflict' | 'topic-step-mismatch' | 'local-intent-conflict' | 'empty-action' | 'empty-answer' | 'valid' {
  if (!exactObject(value, ['topic', 'stepIds', 'observation', 'rationale', 'action', 'clarification']) || !['observation', 'rationale', 'action'].every(key => typeof value[key] === 'string') || !Array.isArray(value.stepIds) || (value.clarification !== null && typeof value.clarification !== 'string')) return 'keys-or-types'
  const explanation = [value.observation, value.rationale, value.action, value.clarification].filter(Boolean).join('\n\n')
  if (explanation.length > 1200) return 'text-over-limit'
  if (value.clarification !== null && (!String(value.clarification).trim() || value.topic !== null || value.stepIds.length !== 0 || value.action !== '')) return 'clarification-conflict'
  if (value.topic === null ? value.stepIds.length !== 0 : !topics.includes(value.topic as StudioHelpTopic) || JSON.stringify(value.stepIds) !== JSON.stringify(studioStepIds(value.topic as StudioHelpTopic, request.workspace))) return 'topic-step-mismatch'
  const local = routedTopicForVersion(request.question, request.version)
  if (value.topic !== null && local && ['undo', 'unlink', 'delete', 'delete-note', 'delete-clip', 'delete-track'].includes(local) && value.topic !== local) return 'local-intent-conflict'
  if (!explanation.trim()) return 'empty-answer'
  if (value.clarification === null && !String(value.action).trim()) return 'empty-action'
  return 'valid'
}

export function normalizeStudioProviderSelection(value: unknown, request: StudioMiraRequest): StudioMiraSelection | null {
  if (request.version === 6) {
    if (!exactObject(value, ['topic', 'stepIds', 'observation', 'rationale', 'action', 'clarification'])) return null
    const selection = { ...value, explanation: [value.observation, value.rationale, value.action, value.clarification].filter(Boolean).join('\n\n') }
    if (!validateStudioSelection(selection, request) || !selection.explanation.trim() || (selection.clarification === null && !selection.action?.trim())) return null
    const action = expandStudioActionShorthand(selection.action!, selection.topic, selection.stepIds, request.workspace)
    const expanded = { ...selection, action, explanation: [selection.observation, selection.rationale, action, selection.clarification].filter(Boolean).join('\n\n') }
    return validateStudioSelection(expanded, request) ? expanded : null
  }
  if (request.version !== 5) return validateStudioSelection(value, request) && value.explanation.trim() ? value : null
  if (!exactObject(value, ['topic', 'stepIds', 'observation', 'rationale', 'action', 'example'])
    || !['observation', 'rationale', 'action'].every(key => typeof value[key] === 'string' && String(value[key]).trim())) return null
  const exampleValid = value.example === null || (!!request.passage && isMelodicSound(request.passage.soundId) && validateMiraExample(value.example))
  const selection = { ...value, explanation: [value.observation, value.rationale, value.action].join('\n\n'), example: exampleValid ? value.example : null, exampleError: exampleValid ? null : MIRA_EXAMPLE_ERROR }
  return validateStudioSelection(selection, request) ? selection : null
}
