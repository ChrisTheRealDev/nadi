import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from '../../src/creation/v4/model'
import { buildTutorEvidence } from '../../src/tracking/tutorSummaryData'
import { DurableMiraBudget, MemoryMiraBudgetRepository } from './budget'
import { durableGroqRequestQuota } from './groqHandler'
import { loadGroqConfig } from './groqConfig'
import { createTutorSummaryHandler, type TutorSummaryDependencies } from './tutorSummaryHandler'
import { MiraTrafficGate } from './policy'

const config = loadGroqConfig({ MIRA_PROVIDER: 'groq', MIRA_LIVE_ENABLED: 'true', GROQ_API_KEY: 'gsk_fixture-not-a-real-secret', MIRA_GROQ_FREE_TIER_CONFIRMED: 'true', MIRA_ADULT_DEMO_CONFIRMED: 'true' })
const dto = { requestId: 'tutor-request', evidence: buildTutorEvidence(createStudioProject()) }
const selection = { claims: [{ evidenceId: 'notes', action: 'listen-and-compare' }] }
const response = (value: unknown = selection) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } })
function request(body: unknown = dto, origin = config.allowedOrigin) { return new Request('http://127.0.0.1:5176/api/mira/creation/tutor-summary', { method: 'POST', headers: { host: '127.0.0.1:5176', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
function setup(overrides: Partial<TutorSummaryDependencies> = {}) {
  const counter = new DurableMiraBudget(new MemoryMiraBudgetRepository(), 2)
  const fetcher = vi.fn<typeof fetch>(async () => response()); let sequence = 0
  const handler = createTutorSummaryHandler({ config, quota: durableGroqRequestQuota(counter), fetchImpl: fetcher, requestId: () => `summary-${++sequence}`, ...overrides })
  return { handler, counter, fetcher }
}
describe('optional tutor summary request boundary', () => {
  it('shares the injected traffic gate and rejects pre-cancelled requests without quota consumption', async () => {
    const gate = new MiraTrafficGate(6, 1, Date.now), admission = gate.enter('local-owner-demo'), s = setup({ gate })
    expect(admission.ok).toBe(true)
    expect(await (await s.handler(request(), '127.0.0.1')).json()).toMatchObject({ reason: 'rate-limited', sent: false })
    if (admission.ok) admission.leave()
    const controller = new AbortController(); controller.abort()
    const cancelled = new Request(request(), { signal: controller.signal })
    expect(await (await s.handler(cancelled, '127.0.0.1')).json()).toMatchObject({ reason: 'cancelled', sent: false })
    expect(s.fetcher).not.toHaveBeenCalled(); expect((await s.counter.snapshot()).entries).toHaveLength(0)
  })
  it('spends one durable Groq quota unit, sends deidentified facts and returns evidence-linked selections', async () => {
    const s = setup(), result = await (await s.handler(request(), '127.0.0.1')).json()
    expect(result).toMatchObject({ source: 'ai-selection', requestId: dto.requestId, revision: dto.evidence.revision, interpretation: selection })
    expect((await s.counter.snapshot()).entries).toMatchObject([{ amountMicrousd: 1, state: 'settled' }])
    expect(s.fetcher).toHaveBeenCalledOnce()
    expect(s.fetcher.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions')
    const payload = JSON.parse(String(s.fetcher.mock.calls[0][1]?.body))
    expect(JSON.parse(payload.messages[1].content).evidence).toEqual(dto.evidence)
    expect(payload).not.toHaveProperty('tools')
    expect(payload.messages[1].content).not.toContain(dto.requestId)
  })
  it('rejects untrusted transport and private/free-text fields before quota or provider use', async () => {
    const s = setup()
    expect((await s.handler(request(), '192.168.1.20')).status).toBe(403)
    expect((await s.handler(request(dto, 'https://other.example'), '127.0.0.1')).status).toBe(403)
    expect((await s.handler(request({ ...dto, prompts: ['private'] }), '127.0.0.1')).status).toBe(400)
    expect((await s.handler(request({ ...dto, evidence: { ...dto.evidence, facts: [{ id: 'notes', values: ['private'] }] } }), '127.0.0.1')).status).toBe(400)
    expect(s.fetcher).not.toHaveBeenCalled(); expect((await s.counter.snapshot()).entries).toHaveLength(0)
  })
  it('keeps deterministic fallback for invented evidence or unconstrained model prose', async () => {
    for (const output of [{ claims: [{ evidenceId: 'secret', action: 'ask-about-choice' }] }, { claims: [{ evidenceId: 'notes', action: 'ask-about-choice', observation: 'Student did not practise' }] }]) {
      const s = setup({ fetchImpl: vi.fn(async () => response(output)) })
      expect(await (await s.handler(request(), '127.0.0.1')).json()).toMatchObject({ source: 'deterministic', interpretation: null, sent: true })
      expect((await s.counter.snapshot()).entries).toMatchObject([{ state: 'settled' }])
    }
  })
  it('never calls a provider when Groq is disabled or the durable shared quota is exhausted', async () => {
    const off = setup({ config: { ...config, enabled: false } })
    expect(await (await off.handler(request(), '127.0.0.1')).json()).toMatchObject({ source: 'deterministic', sent: false })
    expect(off.fetcher).not.toHaveBeenCalled()
    const s = setup()
    await s.handler(request(), '127.0.0.1'); await s.handler(request(), '127.0.0.1')
    expect(await (await s.handler(request(), '127.0.0.1')).json()).toMatchObject({ reason: 'quota-unavailable', sent: false })
    expect(s.fetcher).toHaveBeenCalledTimes(2)
  })
  it('retains request accounting on provider failure and does not retry or use a paid provider', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('transport failed') }), s = setup({ fetchImpl: fetcher })
    expect(await (await s.handler(request(), '127.0.0.1')).json()).toMatchObject({ source: 'deterministic', sent: true })
    expect(fetcher).toHaveBeenCalledOnce(); expect((await s.counter.snapshot()).entries).toMatchObject([{ state: 'settled', amountMicrousd: 1 }])
  })
})
