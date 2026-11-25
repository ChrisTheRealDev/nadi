import { describe, expect, it, vi } from 'vitest'
import { STUDIO_SELECTION_SCHEMA, type StudioMiraRequest } from '../../src/creation/v4/miraContract'
import { createGroqStudioProvider, GROQ_STUDIO_DEFAULT_MODEL, GROQ_STUDIO_MODELS } from './groqProvider'
import { studioProviderInstructions } from './studioProvider'
import { buildMiraPassage } from '../../src/creation/v4/miraPassage'
import { createStudioProject } from '../../src/creation/v4/model'
import { studioFactsV3 } from '../../src/creation/v4/miraContract'

const config = { apiKey: 'fake-test-groq-key-never-sent' }
const request = (): StudioMiraRequest => ({ version: 2, requestId: 'local-correlation', revision: 7, question: 'Why do these intervals feel different?', history: [{ role: 'user', text: 'What is an interval?' }, { role: 'assistant', text: 'It is the distance between two pitches.' }], workspace: { trackKind: 'melodic', hasClip: true, hasNotes: true, linkedUses: 1, canUndo: true, saved: true } })
const selection = { topic: null, stepIds: [], explanation: 'The distance between pitches affects their relationship. A small gap can feel close or tense; a wider one can feel more open. Try listening to each pair separately.' }
const response = (value: unknown = selection, message = {}) => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value), ...message } }], usage: { prompt_tokens: 1200, completion_tokens: 260 } })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const run = async (body: unknown, dto = request()) => {
  const fetcher = vi.fn().mockResolvedValue(json(body))
  return { result: await createGroqStudioProvider(config, fetcher).createResponse(dto, new AbortController().signal), fetcher }
}

describe('dedicated Groq studio provider', () => {
  it('grounds beginner grid advice and calculates attached timing instead of guessing beats or bars', () => {
    const p = createStudioProject(), facts = studioFactsV3(p)
    const dto: StudioMiraRequest = { ...request(), version: 4, workspace: facts, session: { goal: 'A calm song', currentStep: 'grid-draw' }, passage: { source: 'selected', soundId: 'piano', bpm: 90, timingUnit: 'ticks', ticksPerBeat: 480, ticksPerBar: 1920, rangeStartTick: 0, rangeEndTick: 1920, notes: [{ pitch: 60, startTick: 13, durationTicks: 2101, velocity: 82 }] } }
    const prompt = studioProviderInstructions(dto)
    expect(prompt).toContain('480 ticks per beat')
    expect(prompt).toContain('Grid-square size depends on snap/zoom')
    expect(prompt).toContain('Draw clicks empty grid to ADD a note')
    expect(prompt).toContain(String(2101 / 480))
    expect(prompt).toContain('1920 per four-beat bar')
    expect(prompt).toContain('I have not heard the audio.')
  })
  it('v4 sends exact approved notes, trims only oldest history and retains the 15k byte cap', async () => {
    const p = createStudioProject()
    p.name = 'PRIVATE-SONG'; p.tracks[0].name = 'PRIVATE-TRACK'
    p.patterns[0].notes = Array.from({ length: 64 }, (_, i) => ({ id: `PRIVATE-${i}`, pitch: 60 + i % 12, startTick: i * 31, durationTicks: 773, velocity: 99 }))
    const built = buildMiraPassage({ project: p, trackId: p.tracks[0].id, clipId: p.clips[0].id, selectedNoteIds: p.patterns[0].notes.map(n => n.id) })
    if (!built.ok) throw new Error(built.error)
    const dto: StudioMiraRequest = { ...request(), version: 4, workspace: studioFactsV3(p, p.tracks[0].id, p.clips[0].id), passage: built.snapshot.passage, session: { goal: 'Make a gentle song', currentStep: 'grid-draw' }, history: Array.from({ length: 8 }, (_, i) => ({ role: 'user', text: `${i}${'♪'.repeat(499)}` })) }
    const before = structuredClone(dto), { result, fetcher } = await run(response(), dto)
    expect(result.selection).toEqual(selection)
    const body = fetcher.mock.calls[0][1].body, sent = JSON.parse(JSON.parse(body).messages[1].content)
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(15000)
    expect(sent.passage).toEqual(dto.passage); expect(sent.session).toEqual(dto.session)
    expect(sent.history.length).toBeLessThan(dto.history.length)
    expect(sent.history).toEqual(dto.history.slice(dto.history.length - sent.history.length))
    expect(body).not.toMatch(/PRIVATE|requestId|local-correlation/)
    expect(dto).toEqual(before)
    expect(JSON.parse(body).messages[0].content).toContain('With a passage explicitly say')
    const oversize = vi.fn()
    const rejected = await createGroqStudioProvider(config, oversize).createResponse({ ...dto, history: [], question: '\ud800'.repeat(500), session: { goal: '\ud800'.repeat(160), currentStep: null } }, new AbortController().signal)
    expect(rejected).toMatchObject({ failureReason: 'request-too-large', transmission: 'not-sent' })
    expect(oversize).not.toHaveBeenCalled()
  })
  it('uses the fixed strict chat endpoint with a bounded shared conversational prompt and only minimal facts', async () => {
    const dto = request(), before = structuredClone(dto), { result, fetcher } = await run(response(), dto)
    expect(result).toEqual({ selection, usage: { inputTokens: 1200, outputTokens: 260 } })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, options] = fetcher.mock.calls[0], body = JSON.parse(options.body)
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${config.apiKey}` } })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(body).toMatchObject({ model: GROQ_STUDIO_DEFAULT_MODEL, max_completion_tokens: 2048, reasoning_effort: 'low', include_reasoning: false, stream: false })
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'nadi_multitrack_help', strict: true, schema: STUDIO_SELECTION_SCHEMA } })
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({ role: 'system', content: studioProviderInstructions(dto) })
    expect(JSON.parse(body.messages[1].content)).toEqual({ question: dto.question, history: dto.history, workspace: dto.workspace })
    expect(body).not.toHaveProperty('tools'); expect(body).not.toHaveProperty('tool_choice')
    expect(options.body).not.toMatch(/local-correlation|requestId|revision|fake-test-groq-key/)
    expect(new TextEncoder().encode(options.body).length).toBeLessThanOrEqual(15000)
    expect(dto).toEqual(before)
  })
  it('accepts only the two strict-supported models and preserves a lower configured output cap', async () => {
    for (const model of GROQ_STUDIO_MODELS) {
      const fetcher = vi.fn().mockResolvedValue(json(response()))
      expect((await createGroqStudioProvider({ ...config, model, maxOutputTokens: 768 }, fetcher).createResponse(request(), new AbortController().signal)).selection).toEqual(selection)
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model, max_completion_tokens: 768 })
    }
    for (const invalid of [{ model: 'llama-3.3-70b-versatile' }, { model: '' }, { maxOutputTokens: 2049 }, { maxOutputTokens: 0 }, { maxOutputTokens: 2.5 }, { apiKey: ' ' }]) {
      const fetcher = vi.fn()
      expect(await createGroqStudioProvider({ ...config, ...invalid }, fetcher).createResponse(request(), new AbortController().signal)).toEqual({ selection: null, failureReason: 'provider-config-invalid', transmission: 'not-sent', usage: { inputTokens: 0, outputTokens: 0 } })
      expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('preserves a registered valid guide but rejects invented or context-mismatched targets', async () => {
    const dto = { ...request(), question: 'undo that' }, undo = { topic: 'undo', stepIds: ['undo'], explanation: 'Undo reverses the last musical edit.' }
    expect((await run(response(undo), dto)).result.selection).toEqual(undo)
    for (const bad of [{ ...undo, stepIds: ['invented'] }, { ...undo, topic: 'delete-track', stepIds: ['delete-track'] }, { ...undo, extra: true }]) expect((await run(response(bad), dto)).result.selection).toBeNull()
  })
  it('rejects non-stop choices, refusals, tool calls, malformed messages and multiple choices', async () => {
    for (const body of [
      ...['length', 'tool_calls', 'content_filter', null].map(finish_reason => ({ ...response(), choices: [{ ...response().choices[0], finish_reason }] })),
      response(selection, { refusal: 'Cannot answer' }), response(selection, { function_call: { name: 'mutate' } }),
      response(selection, { tool_calls: [{ type: 'function', function: { name: 'mutate', arguments: '{}' } }] }),
      response(selection, { tool_calls: {} }), response(selection, { executed_tools: [{ type: 'browser_search' }] }),
      response(selection, { content: 'not json' }), response(selection, { content: null }), response(selection, { role: 'tool' }),
      { ...response(), choices: [] }, { ...response(), choices: [response().choices[0], response().choices[0]] },
      { ...response(), choices: [null] }, { ...response(), error: { message: 'bad' } }, null, [],
    ]) expect((await run(body)).result.selection).toBeNull()
  })
  it('rejects empty and overlong explanations without discarding known usage', async () => {
    for (const explanation of ['', '   ', 'a'.repeat(501)]) {
      expect((await run(response({ ...selection, explanation }))).result).toEqual({ selection: null, failureReason: 'invalid-ai-response', usage: { inputTokens: 1200, outputTokens: 260 } })
    }
  })
  it('never retries HTTP, network or format failures and leaves outbound usage uncertain', async () => {
    for (const [failure, failureReason] of [
      [new Response('private error', { status: 429 }), 'provider-rate-limited'],
      [new Response('moved', { status: 302 }), 'provider-unavailable'],
      [new Response('html', { headers: { 'content-type': 'text/html' } }), 'invalid-ai-response'],
      [new Response('not json', { headers: { 'content-type': 'application/json' } }), 'invalid-ai-response'],
    ] as const) {
      const fetcher = vi.fn().mockResolvedValue(failure)
      expect(await createGroqStudioProvider(config, fetcher).createResponse(request(), new AbortController().signal)).toEqual({ selection: null, failureReason })
      expect(fetcher).toHaveBeenCalledOnce()
    }
    const fetcher = vi.fn().mockRejectedValue(new Error(`private ${config.apiKey}`))
    expect(await createGroqStudioProvider(config, fetcher).createResponse(request(), new AbortController().signal)).toEqual({ selection: null, failureReason: 'provider-unavailable' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('retains unknown usage for malformed accounting rather than inventing zero spend', async () => {
    for (const usage of [undefined, { prompt_tokens: -1, completion_tokens: 10 }, { prompt_tokens: '2', completion_tokens: 10 }, { prompt_tokens: 2, completion_tokens: 1.2 }]) {
      expect((await run({ ...response(), usage })).result).toEqual({ selection, usage: undefined })
    }
  })
  it('classifies HTTP failures with fixed reasons without exposing provider text or credentials', async () => {
    const cases = [
      [401, undefined, 'provider-auth'], [403, undefined, 'provider-auth'],
      [429, undefined, 'provider-rate-limited'], [404, undefined, 'provider-model-unavailable'],
      [400, 'model_decommissioned', 'provider-model-unavailable'], [400, 'model_not_found', 'provider-model-unavailable'],
      [400, 'json_validate_failed', 'invalid-ai-response'], [400, 'unknown-private-code', 'provider-unavailable'],
      [500, undefined, 'provider-unavailable'],
    ] as const
    for (const [status, code, failureReason] of cases) {
      const privateText = `private body ${config.apiKey}`
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code, message: privateText } }), { status, headers: { 'content-type': 'application/json' } }))
      const result = await createGroqStudioProvider(config, fetcher).createResponse(request(), new AbortController().signal)
      expect(result).toEqual({ selection: null, failureReason })
      expect(JSON.stringify(result)).not.toContain(privateText)
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('bounds request bytes including schema and full ordinary history, and rejects escaped oversized history without sending', async () => {
    const ordinary = { ...request(), question: 'Explain the music. '.repeat(40).slice(0, 500), history: Array.from({ length: 4 }, () => ({ role: 'user' as const, text: 'How do intervals work? '.repeat(30).slice(0, 500) })) }
    expect((await run(response(), ordinary)).result.selection).toEqual(selection)
    const escaped = { ...ordinary, question: '\ud800'.repeat(500), history: ordinary.history.map(turn => ({ ...turn, text: '\ud800'.repeat(500) })) }, fetcher = vi.fn()
    expect(await createGroqStudioProvider(config, fetcher).createResponse(escaped, new AbortController().signal)).toEqual({ selection: null, failureReason: 'request-too-large', transmission: 'not-sent', usage: { inputTokens: 0, outputTokens: 0 } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('bounds streamed response bytes and propagates cancellation with no accepted late response', async () => {
    const cancel = vi.fn(), huge = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(64001))) }, cancel }), { headers: { 'content-type': 'application/json' } })
    const fetcher = vi.fn().mockResolvedValue(huge)
    expect(await createGroqStudioProvider(config, fetcher).createResponse(request(), new AbortController().signal)).toEqual({ selection: null, failureReason: 'invalid-ai-response' })
    expect(cancel).toHaveBeenCalledOnce()
    const controller = new AbortController(), abortedFetch = vi.fn().mockImplementation(async (_url, options) => { expect(options.signal).toBe(controller.signal); controller.abort(); return json(response()) })
    expect(await createGroqStudioProvider(config, abortedFetch).createResponse(request(), controller.signal)).toEqual({ selection: null, failureReason: 'provider-timeout' })
    const neverFetch = vi.fn()
    expect(await createGroqStudioProvider(config, neverFetch).createResponse(request(), controller.signal)).toEqual({ selection: null, failureReason: 'provider-timeout', transmission: 'not-sent', usage: { inputTokens: 0, outputTokens: 0 } })
    expect(neverFetch).not.toHaveBeenCalled()
  })
})
