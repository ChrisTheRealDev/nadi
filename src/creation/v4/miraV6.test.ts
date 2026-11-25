import { describe, expect, it, vi } from 'vitest'
import { authoredStudioResponse, normalizeStudioProviderSelection, parseStudioMiraRequest, parseStudioMiraResponse, STUDIO_SELECTION_V6_SCHEMA, studioFactsV6, studioV6RejectionReason, type StudioMiraRequest } from './miraContract'
import { createStudioProject } from './model'
import { createGroqStudioProvider } from '../../../server/mira/groqProvider'
import { studioProviderInstructions } from '../../../server/mira/studioProvider'

const request = (): Extract<StudioMiraRequest, { version: 6 }> => {
  const project = createStudioProject()
  return { version: 6, requestId: 'local-only', revision: 0, question: 'I want a horn underneath my piano. How?', history: [], workspace: studioFactsV6(project, project.tracks[0].id, project.clips[0].id), passage: null, session: { goal: '', currentStep: null } }
}
const reply = { topic: 'add', stepIds: ['add'], observation: 'You want a separate layer.', rationale: 'A separate track keeps the piano intact.', action: 'Open + Add instrument.', clarification: null }

describe('Mira v6 production companion', () => {
  it('does not let older layer intent override an explicitly vague instrument change', () => {
    const dto = { ...request(), question: 'I want to change the horn thing, but I do not know what to click.' }
    expect(normalizeStudioProviderSelection(reply, dto)).toBeNull()
    expect(normalizeStudioProviderSelection({ ...reply, topic: null, stepIds: [], action: '', clarification: 'Do you mean its sound, notes or volume?' }, dto)).not.toBeNull()
    expect(authoredStudioResponse(dto).selection.topic).toBeNull()
  })
  it('reports only fixed nonprivate normalization diagnostics', () => {
    expect(studioV6RejectionReason(reply, request())).toBe('valid')
    expect(studioV6RejectionReason({ ...reply, private: 'SECRET' }, request())).toBe('keys-or-types')
    expect(studioV6RejectionReason({ ...reply, clarification: '' }, request())).toBe('clarification-conflict')
    expect(studioV6RejectionReason({ ...reply, stepIds: ['SECRET'] }, request())).toBe('topic-step-mismatch')
    expect(studioV6RejectionReason({ ...reply, action: '' }, request())).toBe('empty-action')
    expect(studioV6RejectionReason({ ...reply, action: 'x'.repeat(1201) }, request())).toBe('text-over-limit')
    expect(studioV6RejectionReason(reply, { ...request(), question: 'Undo' })).toBe('local-intent-conflict')
  })
  it('expands only validated exact registered shorthand into readable control directions', () => {
    expect(normalizeStudioProviderSelection({ ...reply, action: 'add' }, request())?.action).toBe('Open Sounds.')
    const dto = request()
    expect(normalizeStudioProviderSelection({ ...reply, topic: 'record', stepIds: ['choose-clip'], action: 'record' }, { ...dto, workspace: { ...dto.workspace, hasClip: false, hasNotes: false, linkedUses: 0 } })?.action).toBe('Select a clip in Arrangement.')
    expect(normalizeStudioProviderSelection({ ...reply, action: 'add a layer' }, request())?.action).toBe('add a layer')
    expect(normalizeStudioProviderSelection({ ...reply, action: 'ADD' }, request())?.action).toBe('ADD')
    expect(normalizeStudioProviderSelection({ ...reply, stepIds: ['sound'], action: 'add' }, request())).toBeNull()
  })
  it('accepts empty goals and bounded audio facts without exposing identity', () => {
    const dto = request()
    expect(parseStudioMiraRequest(dto)).toEqual(dto)
    expect(parseStudioMiraRequest({ ...dto, workspace: { ...dto.workspace, selectedSound: 'invented' } })).toBeNull()
    expect(parseStudioMiraRequest({ ...dto, workspace: { ...dto.workspace, recording: 'yes' } })).toBeNull()
    expect(parseStudioMiraRequest({ ...dto, workspace: { ...dto.workspace, trackName: 'private' } })).toBeNull()
    expect(parseStudioMiraRequest({ ...dto, workspace: { ...dto.workspace, selectedSound: 'kick' } })).toBeNull()
    expect(parseStudioMiraResponse(authoredStudioResponse(dto), dto)).not.toBeNull()
  })
  it('has text-only structured answers and mutually exclusive clarification', () => {
    expect(STUDIO_SELECTION_V6_SCHEMA.properties).not.toHaveProperty('example')
    expect(normalizeStudioProviderSelection(reply, request())).toMatchObject({ action: reply.action })
    expect(normalizeStudioProviderSelection({ ...reply, example: null }, request())).toBeNull()
    expect(normalizeStudioProviderSelection({ ...reply, action: '', topic: null, stepIds: [], clarification: 'Add another track or change this sound?' }, request())).not.toBeNull()
    expect(normalizeStudioProviderSelection({ ...reply, clarification: 'Which?' }, request())).toBeNull()
    expect(normalizeStudioProviderSelection({ ...reply, action: 'x'.repeat(1201) }, request())).toBeNull()
    expect(normalizeStudioProviderSelection({ ...reply, stepIds: ['invented'] }, request())).toBeNull()
  })
  it('grounds intent and prohibits composing across old and new prompts', () => {
    const dto = request()
    for (const version of [2, 3, 4, 5, 6] as const) {
      const prompt = studioProviderInstructions({ ...dto, version } as StudioMiraRequest)
      expect(prompt).toContain('Never supply new melodies, chord progressions, drum patterns')
      expect(prompt).toContain('Instrument words alone do not mean add an instrument')
      expect(prompt).toContain('French Horn'); expect(prompt).toContain('Trumpet')
      expect(prompt).toContain('I cannot hear the horn')
    }
  })
  it('sends v6 through strict Groq schema without local IDs or musical capabilities', async () => {
    const dto = request(), before = structuredClone(dto)
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(reply) } }] }), { headers: { 'content-type': 'application/json' } }))
    const result = await createGroqStudioProvider({ apiKey: 'fake-test-only' }, fetcher).createResponse(dto, new AbortController().signal)
    expect(result.selection).toMatchObject(reply)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.response_format.json_schema.schema).toEqual(STUDIO_SELECTION_V6_SCHEMA)
    expect(body).not.toHaveProperty('tools')
    expect(JSON.stringify(body)).not.toMatch(/local-only|requestId|revision/)
    expect(dto).toEqual(before)
  })
})
