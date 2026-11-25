import { describe, expect, it, vi } from 'vitest'
import type { MiraLivePayload, MiraRequestDto } from '../../src/lib/mira/contracts'
import { DurableMiraBudget, MemoryMiraBudgetRepository, type MiraBudgetLedger, type MiraBudgetRepository } from './budget'
import type { MiraCapabilityClaims } from './capability'
import { loadMiraServerConfig } from './config'
import { createMiraCapabilityIssueHandler, createMiraHandler } from './handler'
import type { MiraProvider, MiraProviderResult } from './provider'

const dto = (): MiraRequestDto => ({
  version: 1,
  question: 'How can I make this gentler?',
  lessonId: 'session-6',
  objectiveId: 'phrase-revision',
  intention: 'gentle',
  facts: [{ key: 'selectedVelocity', value: 72 }],
  attempt: { summary: 'Changed one note.', support: 'cue' },
  project: { id: 'project-AbCd1234', revision: 3, contentFingerprint: 'fnv1a32-1234abcd', selectedArtifactIds: ['clip-melody-a@note-1'] },
})

const payload = (observation = 'The selected note has velocity 72.'): MiraLivePayload => ({
  observation,
  intentionConnection: 'A quieter preview may fit your intention.',
  nextStep: 'Preview a lower velocity.',
  question: null,
  proposal: { kind: 'set-note-velocity', targetIds: ['clip-melody-a@note-1'], value: 58, range: null },
})

const claims: MiraCapabilityClaims = {
  version: 1,
  scope: 'mira:live',
  audience: 'teen',
  cohortId: 'pilot-a',
  sessionId: 'session-abc',
  issuedAt: 1,
  expiresAt: 9999999999,
  nonce: 'nonce-abc',
}

function readyConfig() {
  return loadMiraServerConfig({
    MIRA_LIVE_ENABLED: 'true',
    OPENAI_API_KEY: 'sk-test-not-a-real-key-1234567890',
    MIRA_SPEND_CAP_MICROUSD: '1000000',
    MIRA_MAX_REQUEST_COST_MICROUSD: '200000',
    MIRA_CAPABILITY_SECRET: 'test-capability-secret-at-least-32-characters',
    MIRA_APPROVED_TEEN_COHORTS: 'pilot-a',
  })
}

function post(body: unknown, origin = 'http://127.0.0.1:4174'): Request {
  return new Request('http://127.0.0.1:4174/api/mira', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', cookie: 'nadi_mira_pilot=opaque-cookie' },
    body: JSON.stringify(body),
  })
}

function setup(result: MiraProviderResult | (() => Promise<MiraProviderResult>), overrides: Partial<ReturnType<typeof readyConfig>> = {}) {
  const provider: MiraProvider = {
    createResponse: vi.fn(async () => typeof result === 'function' ? result() : result),
  }
  const config = { ...readyConfig(), ...overrides }
  const budget = new DurableMiraBudget(new MemoryMiraBudgetRepository(), Math.max(1, config.spendCapMicrousd))
  const handler = createMiraHandler({
    config,
    budget,
    provider,
    verifyCapability: vi.fn(async () => claims),
    requestId: () => 'request-handler-1',
  })
  return { handler, provider, budget }
}

describe('Mira same-origin handler', () => {
  it('returns a live answer only after authorization and durable reservation', async () => {
    const { handler, provider, budget } = setup({ status: 'completed', payload: payload(), usage: { inputTokens: 100, outputTokens: 20 } })
    const response = await handler(post(dto()))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ source: 'live', category: 'answer', liveStatus: 'completed', privacy: { transmission: 'sent' } })
    expect(provider.createResponse).toHaveBeenCalledTimes(1)
    expect((await budget.snapshot()).entries[0]).toMatchObject({ state: 'settled', amountMicrousd: 2_000 })
  })

  it('fails closed for missing enable/key/cap/capability and never calls the provider', async () => {
    const configurations = [
      { enabled: false },
      { apiKey: null },
      { spendCapMicrousd: 0 },
    ]
    for (const override of configurations) {
      const { handler, provider } = setup({ status: 'completed', payload: payload() }, override)
      const response = await handler(post(dto()))
      expect(await response.json()).toMatchObject({ source: 'authored', category: 'live-disabled', privacy: { transmission: 'not-sent' } })
      expect(provider.createResponse).not.toHaveBeenCalled()
    }
    const configured = setup({ status: 'completed', payload: payload() })
    const noCapability = createMiraHandler({
      config: readyConfig(), budget: configured.budget, provider: configured.provider,
      verifyCapability: async () => null, requestId: () => 'request-no-capability',
    })
    expect(await (await noCapability(post(dto()))).json()).toMatchObject({ category: 'authorization-required', source: 'authored' })
    expect(configured.provider.createResponse).not.toHaveBeenCalled()
  })

  it('rejects wrong origins, oversize bodies, unknown fields, and forged client audience flags', async () => {
    const { handler, provider } = setup({ status: 'completed', payload: payload() })
    expect((await handler(post(dto(), 'https://evil.example'))).status).toBe(403)
    expect((await handler(post({ ...dto(), audience: 'teen', supervised: true }))).status).toBe(400)
    expect((await handler(post({ ...dto(), question: 'x'.repeat(9_000) }))).status).toBe(400)
    expect(provider.createResponse).not.toHaveBeenCalled()
  })

  it('uses authored sent fallbacks with no proposal for refusal, incomplete, malformed, and unsafe output', async () => {
    const cases: Array<[MiraProviderResult, string]> = [
      [{ status: 'refusal' }, 'refusal'],
      [{ status: 'incomplete' }, 'incomplete'],
      [{ status: 'malformed' }, 'provider-error'],
      [{ status: 'completed', payload: payload('I can hear your track.') }, 'filtered'],
    ]
    for (const [providerResult, category] of cases) {
      const { handler } = setup(providerResult)
      const result = await (await handler(post(dto()))).json()
      expect(result).toMatchObject({ source: 'authored', category, privacy: { transmission: 'sent' } })
      expect(result.content.proposal).toBeNull()
    }
  })

  it('bounds an injected provider that ignores abort and retains the uncertain reservation', async () => {
    const { handler, budget } = setup(() => new Promise(() => undefined), { providerTimeoutMs: 20 })
    const result = await (await handler(post(dto()))).json()
    expect(result).toMatchObject({ source: 'authored', category: 'provider-error', liveStatus: 'failed', privacy: { transmission: 'sent' } })
    expect((await budget.snapshot()).entries[0]).toMatchObject({ state: 'uncertain', amountMicrousd: 200_000 })
  })

  it('contains settlement storage failure, preserves the reservation, and releases the traffic slot', async () => {
    class SettlementFailureRepository implements MiraBudgetRepository {
      ledger: MiraBudgetLedger | null = null
      calls = 0
      async transact<T>(operation: (current: MiraBudgetLedger | null) => { next: MiraBudgetLedger; result: T }): Promise<T> {
        this.calls += 1
        if (this.calls === 2) throw new Error('injected quota failure')
        const update = operation(this.ledger)
        this.ledger = update.next
        return update.result
      }
      async read() { return this.ledger }
    }
    const repository = new SettlementFailureRepository()
    const config = { ...readyConfig(), maxConcurrent: 1 }
    const budget = new DurableMiraBudget(repository, config.spendCapMicrousd)
    let requestNumber = 0
    const provider: MiraProvider = { createResponse: vi.fn(async (): Promise<MiraProviderResult> => ({ status: 'completed', payload: payload() })) }
    const handler = createMiraHandler({
      config,
      budget,
      provider,
      verifyCapability: async () => claims,
      requestId: () => `request-settle-${++requestNumber}`,
    })
    const first = await (await handler(post(dto()))).json()
    expect(first).toMatchObject({ source: 'authored', category: 'provider-error', privacy: { transmission: 'sent' } })
    expect(first.content.proposal).toBeNull()
    expect(repository.ledger?.entries[0]).toMatchObject({ requestId: 'request-settle-1', state: 'reserved', amountMicrousd: 200_000 })
    const second = await handler(post(dto()))
    expect(second.status).toBe(200)
    expect(provider.createResponse).toHaveBeenCalledTimes(2)
  })

  it('filters risky input before provider transmission and never includes a proposal', async () => {
    const { handler, provider } = setup({ status: 'completed', payload: payload() })
    const result = await (await handler(post({ ...dto(), question: 'I feel suicidal' }))).json()
    expect(result).toMatchObject({ category: 'filtered', privacy: { transmission: 'not-sent' } })
    expect(result.content.proposal).toBeNull()
    expect(provider.createResponse).not.toHaveBeenCalled()
  })
})

describe('Mira local supervisor capability issue handler', () => {
  it('sets an HttpOnly cookie without returning the signed token to browser JavaScript', async () => {
    const config = readyConfig()
    const handler = createMiraCapabilityIssueHandler({
      config,
      authorizeSupervisor: async () => true,
      capability: { secret: config.capabilitySecret!, approvedCohortIds: config.approvedTeenCohortIds, now: () => 1_000_000 },
      now: () => 1_000_000,
      nonce: () => 'nonce-abc',
    })
    const response = await handler(post({ cohortId: 'pilot-a', sessionId: 'session-abc', durationMinutes: 30 }))
    const body = await response.text()
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')
    expect(body).toContain('"status":"issued"')
    expect(body).not.toContain('nadi_mira_pilot')
    expect(body).not.toContain('.')
  })
})
