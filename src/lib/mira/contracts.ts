export const MIRA_REQUEST_MAX_BYTES = 8_192

export type MiraSupportLevel = 'none' | 'nudge' | 'cue' | 'example'

export interface MiraDeterministicFact {
  key: string
  value: string | number | boolean | string[] | number[]
}

export interface MiraRequestDto {
  version: 1
  question: string
  lessonId: string
  objectiveId: string
  intention: string
  facts: MiraDeterministicFact[]
  attempt: {
    summary: string
    support: MiraSupportLevel
  }
  project: {
    id: string
    revision: number
    contentFingerprint: string
    selectedArtifactIds: string[]
  }
}

export type MiraProposalKind =
  | 'focus'
  | 'audition'
  | 'set-note-pitch'
  | 'set-note-velocity'
  | 'set-note-timing'
  | 'set-channel-gain'
  | 'set-channel-reverb'

export interface MiraProposal {
  kind: MiraProposalKind
  targetIds: string[]
  value: number | null
  range: { startTick: number; endTick: number } | null
}

export interface MiraLivePayload {
  observation: string
  intentionConnection: string
  nextStep: string
  question: string | null
  proposal: MiraProposal | null
}

export type MiraResponseCategory =
  | 'answer'
  | 'authored-local'
  | 'live-disabled'
  | 'authorization-required'
  | 'budget-unavailable'
  | 'rate-limited'
  | 'filtered'
  | 'refusal'
  | 'incomplete'
  | 'provider-error'
  | 'invalid-request'

export interface MiraResponseDto {
  version: 1
  source: 'authored' | 'live'
  category: MiraResponseCategory
  requestId: string
  liveStatus: 'not-attempted' | 'completed' | 'refused' | 'incomplete' | 'failed'
  content: MiraLivePayload
  report: {
    available: true
    label: 'Hide this and show your supervisor'
    instruction: 'This hides the response on this screen. Please show this to your supervisor; nothing is sent automatically.'
  }
  privacy: {
    transmission: 'not-sent' | 'sent' | 'unknown'
    notice: string
  }
  budget: {
    reservedMicrousd: number
    remainingMicrousd: number
  } | null
}

const requestKeys = ['version', 'question', 'lessonId', 'objectiveId', 'intention', 'facts', 'attempt', 'project'] as const
const factKeys = ['key', 'value'] as const
const attemptKeys = ['summary', 'support'] as const
const projectKeys = ['id', 'revision', 'contentFingerprint', 'selectedArtifactIds'] as const
const livePayloadKeys = ['observation', 'intentionConnection', 'nextStep', 'question', 'proposal'] as const
const proposalKeys = ['kind', 'targetIds', 'value', 'range'] as const
const rangeKeys = ['startTick', 'endTick'] as const
const responseKeys = ['version', 'source', 'category', 'requestId', 'liveStatus', 'content', 'report', 'privacy', 'budget'] as const

const supports = new Set<MiraSupportLevel>(['none', 'nudge', 'cue', 'example'])
const proposalKinds = new Set<MiraProposalKind>([
  'focus',
  'audition',
  'set-note-pitch',
  'set-note-velocity',
  'set-note-timing',
  'set-channel-gain',
  'set-channel-reverb',
])
const categories = new Set<MiraResponseCategory>([
  'answer',
  'authored-local',
  'live-disabled',
  'authorization-required',
  'budget-unavailable',
  'rate-limited',
  'filtered',
  'refusal',
  'incomplete',
  'provider-error',
  'invalid-request',
])

export interface ContractResult<T> {
  ok: boolean
  value?: T
  error?: string
}

export function parseMiraRequest(value: unknown): ContractResult<MiraRequestDto> {
  if (!isExactRecord(value, requestKeys)) return failure('request fields are not allowlisted')
  if (value.version !== 1) return failure('unsupported request version')
  if (!boundedString(value.question, 1, 500)) return failure('question is invalid')
  if (!identifier(value.lessonId) || !identifier(value.objectiveId)) return failure('lesson or objective id is invalid')
  if (!boundedString(value.intention, 0, 240)) return failure('intention is invalid')
  if (!Array.isArray(value.facts) || value.facts.length > 24) return failure('facts are invalid')
  const facts: MiraDeterministicFact[] = []
  for (const rawFact of value.facts) {
    if (!isExactRecord(rawFact, factKeys) || !identifier(rawFact.key) || !factValue(rawFact.value)) {
      return failure('fact is invalid')
    }
    facts.push({ key: rawFact.key, value: rawFact.value })
  }
  if (!isExactRecord(value.attempt, attemptKeys) || !boundedString(value.attempt.summary, 0, 360) ||
      !supports.has(value.attempt.support as MiraSupportLevel)) return failure('attempt is invalid')
  if (!isExactRecord(value.project, projectKeys) || !opaqueProjectId(value.project.id) ||
      !safeInteger(value.project.revision, 0, 1_000_000_000) ||
      !contentFingerprint(value.project.contentFingerprint) ||
      !identifierArray(value.project.selectedArtifactIds, 16)) return failure('project reference is invalid')
  return {
    ok: true,
    value: {
      version: 1,
      question: value.question,
      lessonId: value.lessonId,
      objectiveId: value.objectiveId,
      intention: value.intention,
      facts,
      attempt: { summary: value.attempt.summary, support: value.attempt.support as MiraSupportLevel },
      project: {
        id: value.project.id,
        revision: value.project.revision,
        contentFingerprint: value.project.contentFingerprint,
        selectedArtifactIds: [...value.project.selectedArtifactIds],
      },
    },
  }
}

export function parseMiraLivePayload(value: unknown): ContractResult<MiraLivePayload> {
  if (!isExactRecord(value, livePayloadKeys)) return failure('live response fields are invalid')
  if (!boundedString(value.observation, 1, 280) ||
      !boundedString(value.intentionConnection, 1, 280) ||
      !boundedString(value.nextStep, 1, 280) ||
      !(value.question === null || boundedString(value.question, 1, 220))) return failure('live response text is invalid')
  const proposal = value.proposal === null ? null : parseProposal(value.proposal)
  if (proposal === undefined) return failure('proposal is invalid')
  return {
    ok: true,
    value: {
      observation: value.observation,
      intentionConnection: value.intentionConnection,
      nextStep: value.nextStep,
      question: value.question,
      proposal,
    },
  }
}

export function parseMiraResponse(value: unknown): ContractResult<MiraResponseDto> {
  if (!isExactRecord(value, responseKeys) || value.version !== 1 ||
      !['authored', 'live'].includes(String(value.source)) || !categories.has(value.category as MiraResponseCategory) ||
      !identifier(value.requestId) || !['not-attempted', 'completed', 'refused', 'incomplete', 'failed'].includes(String(value.liveStatus))) {
    return failure('response envelope is invalid')
  }
  const content = parseMiraLivePayload(value.content)
  if (!content.ok || !content.value || !validReport(value.report) || !validPrivacy(value.privacy) || !validBudget(value.budget)) {
    return failure('response content is invalid')
  }
  const privacy = value.privacy as { transmission: 'not-sent' | 'sent' | 'unknown'; notice: string }
  const isCompletedLive = value.source === 'live' && value.category === 'answer' &&
    value.liveStatus === 'completed' && privacy.transmission === 'sent'
  if (value.source === 'live' !== isCompletedLive) return failure('response state is inconsistent')
  if (value.liveStatus === 'completed' !== isCompletedLive) return failure('response state is inconsistent')
  if (value.category === 'answer' !== isCompletedLive) return failure('response category is inconsistent')
  if (!isCompletedLive && content.value.proposal !== null) return failure('fallback response cannot contain a proposal')
  if (['filtered', 'refusal', 'incomplete', 'provider-error', 'invalid-request'].includes(String(value.category)) &&
      content.value.proposal !== null) return failure('non-answer response cannot contain a proposal')
  return { ok: true, value: value as unknown as MiraResponseDto }
}

export const MIRA_LIVE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observation', 'intentionConnection', 'nextStep', 'question', 'proposal'],
  properties: {
    observation: { type: 'string', minLength: 1, maxLength: 280 },
    intentionConnection: { type: 'string', minLength: 1, maxLength: 280 },
    nextStep: { type: 'string', minLength: 1, maxLength: 280 },
    question: { anyOf: [{ type: 'string', minLength: 1, maxLength: 220 }, { type: 'null' }] },
    proposal: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'targetIds', 'value', 'range'],
          properties: {
            kind: { type: 'string', enum: [...proposalKinds] },
            targetIds: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 96 } },
            value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            range: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['startTick', 'endTick'],
                  properties: {
                    startTick: { type: 'integer', minimum: 0, maximum: 15_360 },
                    endTick: { type: 'integer', minimum: 1, maximum: 15_360 },
                  },
                },
                { type: 'null' },
              ],
            },
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const

function parseProposal(value: unknown): MiraProposal | undefined {
  if (!isExactRecord(value, proposalKeys) || !proposalKinds.has(value.kind as MiraProposalKind) ||
      !identifierArray(value.targetIds, 8) || value.targetIds.length === 0 ||
      !(value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value)))) return undefined
  const range = value.range
  if (range !== null && (!isExactRecord(range, rangeKeys) ||
      !safeInteger(range.startTick, 0, 15_360) || !safeInteger(range.endTick, 1, 15_360) ||
      range.endTick <= range.startTick)) return undefined
  return {
    kind: value.kind as MiraProposalKind,
    targetIds: [...value.targetIds],
    value: value.value,
    range: range === null ? null : { startTick: range.startTick as number, endTick: range.endTick as number },
  }
}

function validReport(value: unknown): boolean {
  return isExactRecord(value, ['available', 'label', 'instruction']) && value.available === true &&
    value.label === 'Hide this and show your supervisor' &&
    value.instruction === 'This hides the response on this screen. Please show this to your supervisor; nothing is sent automatically.'
}

function validPrivacy(value: unknown): boolean {
  return isExactRecord(value, ['transmission', 'notice']) && ['not-sent', 'sent', 'unknown'].includes(String(value.transmission)) &&
    boundedString(value.notice, 1, 500)
}

function validBudget(value: unknown): boolean {
  return value === null || (isExactRecord(value, ['reservedMicrousd', 'remainingMicrousd']) &&
    safeInteger(value.reservedMicrousd, 0, Number.MAX_SAFE_INTEGER) &&
    safeInteger(value.remainingMicrousd, 0, Number.MAX_SAFE_INTEGER))
}

function factValue(value: unknown): value is MiraDeterministicFact['value'] {
  if (typeof value === 'string') return boundedString(value, 0, 160)
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1_000_000_000
  if (!Array.isArray(value) || value.length > 8) return false
  return value.every((item) => typeof item === 'string' && boundedString(item, 0, 80)) ||
    value.every((item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000_000)
}

function identifierArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(identifier)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:@?-]{1,96}$/.test(value)
}

function opaqueProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/.test(value)
}

function contentFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^(?:fnv1a32-[a-f0-9]{8}|sha256-[a-f0-9]{64})$/.test(value)
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max &&
    [...value].every((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
}

function safeInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function isExactRecord<const T extends readonly string[]>(value: unknown, keys: T): value is Record<T[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => (keys as readonly string[]).includes(key))
}

function failure<T>(error: string): ContractResult<T> {
  return { ok: false, error }
}
