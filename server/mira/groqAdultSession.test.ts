import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAdultMiraCapabilityCookie, verifyAdultCapability } from './capability'
import type { GroqAdultSessionOptions, GroqPairingRecord, GroqPairingRepository } from './groqAdultSession'

const code = '0123456789abcdef0123456789abcdef', now = 1000000
let codeHash = ''
const record = (): GroqPairingRecord => ({ version: 1, codeHash, expiresAt: now + 900000, cohortId: 'adult-demo', sessionId: 'session-adult' })
const secret = 'adult-demo-dedicated-secret-at-least-32-characters'
function repository(initial: unknown = record()): GroqPairingRepository & { state: unknown } {
  return { state: initial, async read() { return this.state }, async consume(expected) { if (JSON.stringify(this.state) !== JSON.stringify(expected)) return false; this.state = null; return true } }
}
const options = (repo: GroqPairingRepository): GroqAdultSessionOptions => ({ ready: true, adultConfirmed: true, freeTierConfirmed: true, allowedOrigin: 'http://127.0.0.1:5176', capabilitySecret: secret, repository: repo, now: () => now })
const request = (body: unknown = { code }, origin = 'http://127.0.0.1:5176', url = 'http://127.0.0.1:5176/api/mira/groq/session') => new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(async () => {
  vi.resetModules()
  codeHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))), byte => byte.toString(16).padStart(2, '0')).join('')
})

describe('local one-use adult Groq pairing', () => {
  it('consumes before issuing only a signed HttpOnly cookie; never returns code, hash or token in JSON', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession'), repo = repository()
    const response = await createGroqAdultSessionHandler(options(repo))(request(), '127.0.0.1')
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ authorized: true }); expect(repo.state).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain('nadi_mira_adult='); expect(cookie).toContain('HttpOnly; SameSite=Strict')
    const claims = await verifyAdultCapability(readAdultMiraCapabilityCookie(cookie), { secret, approvedCohortIds: ['adult-demo'], now: () => now })
    expect(claims).toMatchObject({ audience: 'adult', scope: 'mira:groq-adult', sessionId: 'session-adult' })
  })
  it('fails closed on disabled, unconfirmed or weak-secret configuration', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession')
    for (const patch of [{ ready: false }, { adultConfirmed: false }, { freeTierConfirmed: false }, { capabilitySecret: 'short' }]) {
      const repo = repository(); expect((await createGroqAdultSessionHandler({ ...options(repo), ...patch })(request(), '127.0.0.1')).status).toBe(503); expect(repo.state).not.toBeNull()
    }
  })
  it('requires exact local Origin, URL, socket address and POST JSON', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession'), handler = createGroqAdultSessionHandler(options(repository()))
    for (const address of [undefined, '10.0.0.2', '127.0.0.2']) expect((await handler(request(), address)).status).toBe(403)
    expect((await handler(request({ code }, 'https://evil.example'), '127.0.0.1')).status).toBe(403)
    expect((await handler(request({ code }, 'http://127.0.0.1:5176', 'http://evil.example/api/mira/groq/session'), '127.0.0.1')).status).toBe(403)
    expect((await handler(new Request('http://127.0.0.1:5176/api/mira/groq/session'), '127.0.0.1')).status).toBe(405)
    expect((await handler(new Request('http://127.0.0.1:5176/api/mira/groq/session', { method: 'POST', headers: { origin: 'http://127.0.0.1:5176', 'content-type': 'text/plain' }, body: JSON.stringify({ code }) }), '127.0.0.1')).status).toBe(415)
  })
  it('denies wrong, expired, malformed and unbounded-future records without consuming', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession')
    for (const initial of [{ ...record(), expiresAt: now }, { ...record(), expiresAt: now + 7200001 }, { ...record(), codeHash: '0'.repeat(64) }, { ...record(), extra: true }, { ...record(), cohortId: 'teen' }]) {
      const repo = repository(initial); expect((await createGroqAdultSessionHandler(options(repo))(request(), '127.0.0.1')).status).toBe(403); expect(repo.state).toEqual(initial)
    }
  })
  it('counts attempts globally across independently created handlers and leaves the file intact', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession'), repo = repository()
    for (let i = 0; i < 5; i++) expect((await createGroqAdultSessionHandler(options(repo))(request({ code: 'a'.repeat(32) }), '127.0.0.1')).status).toBe(403)
    expect((await createGroqAdultSessionHandler(options(repo))(request(), '127.0.0.1')).status).toBe(429)
    expect(repo.state).toEqual(record())
  })
  it('bounds body size and rejects client-provided age/cohort authority', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession'), handler = createGroqAdultSessionHandler(options(repository()))
    for (const body of [{ code, audience: 'adult' }, { code, cohortId: 'adult-demo' }, { code: 'x'.repeat(2000) }, { code: 'short' }]) expect((await handler(request(body), '127.0.0.1')).status).toBe(400)
  })
  it('permits only one winner under concurrent valid pairing requests', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession'), handler = createGroqAdultSessionHandler(options(repository()))
    const responses = await Promise.all([handler(request(), '127.0.0.1'), handler(request(), '127.0.0.1')])
    expect(responses.filter(response => response.status === 200)).toHaveLength(1)
    expect(responses.filter(response => response.headers.has('set-cookie'))).toHaveLength(1)
  })
  it('does not issue authority when repository consumption fails', async () => {
    const { createGroqAdultSessionHandler } = await import('./groqAdultSession'), repo = repository(); repo.consume = async () => { throw new Error('private filesystem diagnostic') }
    const response = await createGroqAdultSessionHandler(options(repo))(request(), '127.0.0.1')
    expect(response.status).toBe(503); expect(response.headers.has('set-cookie')).toBe(false); expect(await response.text()).not.toContain('private filesystem')
  })
})
