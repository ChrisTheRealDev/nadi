import { describe, expect, it } from 'vitest'
import {
  MIRA_LIVE_RESPONSE_JSON_SCHEMA,
  parseMiraLivePayload,
  parseMiraRequest,
  parseMiraResponse,
  type MiraRequestDto,
} from './contracts'

const validRequest = (): MiraRequestDto => ({
  version: 1,
  question: 'How can I make the second half feel different?',
  lessonId: 'session-7',
  objectiveId: 'audible-variation',
  intention: 'Make the second half feel calmer.',
  facts: [
    { key: 'selectedNoteCount', value: 2 },
    { key: 'selectedPitches', value: [60, 64] },
  ],
  attempt: { summary: 'Changed one note after listening.', support: 'cue' },
  project: {
    id: 'project-W8p4xZ12',
    revision: 9,
    contentFingerprint: 'fnv1a32-1234abcd',
    selectedArtifactIds: ['clip-melody-b@note-2'],
  },
})

describe('Mira shared contracts', () => {
  it('accepts only the minimal bounded request DTO', () => {
    expect(parseMiraRequest(validRequest())).toEqual({ ok: true, value: validRequest() })
    const requestWithAudio = { ...validRequest(), audio: 'base64' }
    expect(parseMiraRequest(requestWithAudio)).toEqual({ ok: false, error: 'request fields are not allowlisted' })
  })

  it('rejects forged audience flags, identity fields, excessive text, and oversized fact arrays', () => {
    expect(parseMiraRequest({ ...validRequest(), audience: 'teen', supervised: true }).ok).toBe(false)
    expect(parseMiraRequest({ ...validRequest(), learnerName: 'Student' }).ok).toBe(false)
    expect(parseMiraRequest({ ...validRequest(), question: 'x'.repeat(501) }).ok).toBe(false)
    expect(parseMiraRequest({ ...validRequest(), facts: Array.from({ length: 25 }, (_, index) => ({ key: `fact-${index}`, value: true })) }).ok).toBe(false)
    expect(parseMiraRequest({ ...validRequest(), facts: [{ key: 'mixed', value: [1, 'x'] }] }).ok).toBe(false)
  })

  it('accepts one bounded proposal and rejects hidden fields or arbitrary operations', () => {
    const payload = {
      observation: 'The second half repeats the same notes.',
      intentionConnection: 'One small change can support your calmer intention.',
      nextStep: 'Preview one quieter selected note.',
      question: 'Would you like to hear that preview?',
      proposal: { kind: 'set-note-velocity', targetIds: ['clip-melody-b@note-2'], value: 58, range: null },
    }
    expect(parseMiraLivePayload(payload)).toEqual({ ok: true, value: payload })
    expect(parseMiraLivePayload({ ...payload, awardCheckpoint: true }).ok).toBe(false)
    expect(parseMiraLivePayload({ ...payload, proposal: { ...payload.proposal, kind: 'add-note' } }).ok).toBe(false)
  })

  it('publishes a strict provider schema with no additional properties', () => {
    expect(MIRA_LIVE_RESPONSE_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(MIRA_LIVE_RESPONSE_JSON_SCHEMA.required).toEqual([
      'observation', 'intentionConnection', 'nextStep', 'question', 'proposal',
    ])
  })

  it('rejects semantically inconsistent response states and proposals on fallbacks', () => {
    const base = {
      version: 1,
      source: 'live',
      category: 'answer',
      requestId: 'request-1',
      liveStatus: 'completed',
      content: { observation: 'Selected note.', intentionConnection: 'It fits the intention.', nextStep: 'Preview it.', question: null, proposal: null },
      report: { available: true, label: 'Hide this and show your supervisor', instruction: 'This hides the response on this screen. Please show this to your supervisor; nothing is sent automatically.' },
      privacy: { transmission: 'sent', notice: 'The bounded request was sent.' },
      budget: { reservedMicrousd: 100, remainingMicrousd: 900 },
    }
    expect(parseMiraResponse(base).ok).toBe(true)
    expect(parseMiraResponse({ ...base, source: 'authored' }).ok).toBe(false)
    expect(parseMiraResponse({ ...base, liveStatus: 'refused' }).ok).toBe(false)
    expect(parseMiraResponse({ ...base, privacy: { transmission: 'unknown', notice: 'Unknown.' } }).ok).toBe(false)
    expect(parseMiraResponse({ ...base, source: 'authored', category: 'filtered', liveStatus: 'not-attempted', privacy: { transmission: 'not-sent', notice: 'Local.' }, content: { ...base.content, proposal: { kind: 'focus', targetIds: ['clip-a'], value: null, range: null } } }).ok).toBe(false)
  })
})
