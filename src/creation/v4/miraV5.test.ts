import { describe, expect, it, vi } from 'vitest'
import { createGroqStudioProvider } from '../../../server/mira/groqProvider'
import { authoredStudioResponse, normalizeStudioProviderSelection, parseStudioMiraRequest, parseStudioMiraResponse, STUDIO_SELECTION_SCHEMA, STUDIO_SELECTION_V5_SCHEMA, studioFacts, studioFactsV3, type StudioMiraRequest } from './miraContract'
import { studioProviderInstructions, verifiedPassageReference } from '../../../server/mira/studioProvider'
import { validateMiraExample, MIRA_EXAMPLE_ERROR } from './miraExample'
import { createStudioProject } from './model'
import { requestStudioMira } from './miraClient'

const note = { pitch: 60, startTick: 13, durationTicks: 480, velocity: 83 }
const dto = (): StudioMiraRequest => {
  const project = createStudioProject(); project.patterns[0].notes = [{ id: 'PRIVATE-NOTE', ...note }]
  return { version: 5, requestId: 'local-only', revision: 2, question: 'Suggest a variation', history: [], workspace: studioFactsV3(project, project.tracks[0].id, project.clips[0].id), session: { goal: 'Hopeful piano', currentStep: null }, passage: { source: 'selected', soundId: 'piano', bpm: 84, timingUnit: 'ticks', ticksPerBeat: 480, ticksPerBar: 1920, rangeStartTick: 0, rangeEndTick: 1920, notes: [note] } }
}
const answer = () => ({ topic: null, stepIds: [], observation: 'I have not heard the audio. Your note begins just after the beat.', rationale: 'A later answer could leave room to breathe.', action: 'Try repeating it one beat later.', example: { notes: [note] } })
const wire = () => ({ ...authoredStudioResponse(dto()), source: 'live', transmission: 'sent', selection: normalizeStudioProviderSelection(answer(), dto()) })

describe('Mira v5 musical advice boundary', () => {
  it('grounds sequential-note advice in exact pitch names, beat positions and overlap facts', () => {
    const request = dto()
    if (request.version !== 5 || !request.passage) throw new Error('fixture')
    const passage = { ...request.passage, notes: [64, 67, 72, 71].map((pitch, index) => ({ pitch, startTick: index * 480, durationTicks: 480, velocity: 90 })) }
    const before = structuredClone(passage), reference = verifiedPassageReference(passage)
    for (const name of ['E4', 'G4', 'C5', 'B4']) expect(reference).toContain(name)
    expect(reference).toContain('"overlappingNotes":false')
    expect(reference).toContain('"noteCount":4')
    expect(reference).toContain('"beat":4')
    expect(reference).toContain('"lengthBeats":1')
    expect(verifiedPassageReference({ ...passage, notes: [passage.notes[0], { ...passage.notes[1], startTick: 13, durationTicks: 720 }] })).toContain('"overlappingNotes":true')
    const prompt = studioProviderInstructions({ ...request, passage })
    expect(prompt).toContain('1.5 beats (720 ticks) is a dotted QUARTER')
    expect(prompt).toContain('0.75 beats (360 ticks) is a dotted EIGHTH')
    expect(prompt).toContain('example MUST always be null')
    expect(passage).toEqual(before)
  })
  it('keeps new guidance topics out of v2-v4 schemas, prompts, validation and authored responses', () => {
    const project = createStudioProject()
    const cases = [['select a chord', 'select-chord'], ['move notes', 'move-notes'], ['resize notes', 'resize-notes']] as const
    for (const version of [2, 3, 4] as const) {
      const base = { requestId: 'legacy', revision: 0, question: '', history: [] }
      const request: StudioMiraRequest = version === 4 ? { ...base, version, workspace: studioFactsV3(project, project.tracks[0].id, project.clips[0].id), passage: null, session: null }
        : { ...base, version, workspace: version === 2 ? studioFacts(project, project.tracks[0].id, project.clips[0].id) : studioFactsV3(project, project.tracks[0].id, project.clips[0].id) }
      for (const [question, topic] of cases) {
        const legacy = { ...request, question }
        expect(STUDIO_SELECTION_SCHEMA.properties.topic.enum).not.toContain(topic)
        expect(STUDIO_SELECTION_SCHEMA.properties.stepIds.items.enum).not.toContain(topic)
        expect(studioProviderInstructions(legacy)).not.toContain(`"${topic}"`)
        expect(authoredStudioResponse(legacy).selection).toMatchObject({ topic: 'notes', stepIds: ['notes'] })
        expect(parseStudioMiraResponse(authoredStudioResponse(legacy), legacy)).not.toBeNull()
        expect(normalizeStudioProviderSelection({ topic, stepIds: [topic], explanation: 'Try this.' }, legacy)).toBeNull()
        expect(STUDIO_SELECTION_V5_SCHEMA.properties.topic.enum).toContain(topic)
      }
    }
  })
  it('accepts explicit v5 attachments and longer assistant history but no private extras', () => {
    const request = dto()
    expect(parseStudioMiraRequest(request)).toEqual(request)
    expect(parseStudioMiraRequest({ ...request, history: [{ role: 'assistant', text: 'a'.repeat(1200) }] })).not.toBeNull()
    expect(parseStudioMiraRequest({ ...request, history: [{ role: 'user', text: 'a'.repeat(501) }] })).toBeNull()
    expect(parseStudioMiraRequest({ ...request, projectName: 'private' })).toBeNull()
    expect(parseStudioMiraResponse(authoredStudioResponse(request), request)).not.toBeNull()
    expect(parseStudioMiraResponse({ ...wire(), revision: 1 }, request)).toBeNull()
  })
  it('validates exact example timing and every sustained tail without truncating or quantizing', () => {
    expect(validateMiraExample({ notes: [note, { ...note, startTick: 3360 }] })).toBe(true)
    for (const invalid of [{ ...note, pitch: 128 }, { ...note, velocity: 0 }, { ...note, startTick: .5 }, { ...note, durationTicks: 0 }, { ...note, startTick: 3361 }, { ...note, soundId: 'piano' }]) expect(validateMiraExample({ notes: [invalid] })).toBe(false)
    expect(validateMiraExample({ notes: Array(17).fill(note) })).toBe(false)
    expect(validateMiraExample({ notes: [] })).toBe(false)
    expect(validateMiraExample({ notes: [note], bpm: 84 })).toBe(false)
  })
  it('keeps valid text when an example is invalid at provider and browser boundaries', () => {
    const bad = { ...answer(), example: { notes: [{ ...note, durationTicks: 5000 }] } }
    const normalized = normalizeStudioProviderSelection(bad, dto())
    expect(normalized).toMatchObject({ observation: bad.observation, example: null, exampleError: MIRA_EXAMPLE_ERROR })
    expect(parseStudioMiraResponse({ ...wire(), selection: { ...wire().selection, example: bad.example } }, dto())?.selection).toMatchObject({ example: null, exampleError: MIRA_EXAMPLE_ERROR })
    expect(normalizeStudioProviderSelection({ ...answer(), action: 'x'.repeat(1200) }, dto())).toBeNull()
    expect(normalizeStudioProviderSelection({ ...answer(), command: 'insert' }, dto())).toBeNull()
    const request = dto()
    if (request.version !== 5) throw new Error('fixture')
    expect(normalizeStudioProviderSelection(answer(), { ...request, passage: null })?.example).toBeNull()
    expect(normalizeStudioProviderSelection(answer(), { ...request, passage: { ...request.passage!, soundId: 'kick' } })?.example).toBeNull()
  })
  it('uses strict provider output, trims only history and sends no local identity', async () => {
    const request = dto()
    request.history = Array.from({ length: 8 }, () => ({ role: 'assistant', text: '♪'.repeat(1200) }))
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer()) } }] }), { headers: { 'content-type': 'application/json' } }))
    const result = await createGroqStudioProvider({ apiKey: 'fake' }, fetcher).createResponse(request, new AbortController().signal)
    expect(result.selection?.example).toBeNull() // Active legacy responses no longer generate music.
    expect(fetcher).toHaveBeenCalledOnce()
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.response_format.json_schema).toMatchObject({ strict: true, schema: STUDIO_SELECTION_V5_SCHEMA })
    expect(new TextEncoder().encode(fetcher.mock.calls[0][1].body).length).toBeLessThanOrEqual(15000)
    const sent = JSON.parse(body.messages[1].content)
    expect(sent.passage).toEqual('passage' in request ? request.passage : null)
    expect(sent.history.length).toBeLessThan(8)
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE-NOTE|local-only|requestId/)
  })
  it('accepts bounded unicode advice with examples without consuming a second request', async () => {
    const selection = normalizeStudioProviderSelection({ ...answer(), observation: '音'.repeat(1000), rationale: 'Why', action: 'Try' }, dto())
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ready: true, authorized: true }))).mockResolvedValueOnce(new Response(JSON.stringify({ ...wire(), selection })))
    expect((await requestStudioMira(dto(), new AbortController().signal, fetcher)).source).toBe('live')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
