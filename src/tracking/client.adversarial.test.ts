import { describe, expect, it, vi } from 'vitest'
import { TrackingClient } from './client'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const identity = (id: string) => ({ profile: { id, display_name: 'Synthetic tester', role: 'student' }, disclosureAccepted: true, learners: [] })
const token = (id: string) => ({ accessToken: `fixture-${id}`, refreshToken: `fixture-refresh-${id}`, expiresIn: 3600 })
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function setup() {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token('a'))).mockResolvedValueOnce(json(identity('a')))
  const client = new TrackingClient(fetcher)
  await client.login('a@example.test', 'synthetic'); await client.workspace()
  return { client, fetcher }
}
const actions: [string, (c: TrackingClient) => Promise<unknown>][] = [
  ['workspace', c => c.workspace()], ['inbox', c => c.feedbackRead('a')],
  ['planner', c => c.plannerRead('a', 'a')], ['shared', c => c.sharedRead('a', 'a')],
  ['feedback write', c => c.feedbackCommand('a', 'question', { mutationId: 'stable', message: 'Synthetic' })],
  ['planner write', c => c.plannerCommand('a', 'step-add', { mutationId: 'stable' })],
  ['shared write', c => c.sharedCommand('a', 'reply', { mutationId: 'stable' })],
  ['capture', c => c.capture('a', 'a', 'synthetic-hash')],
]

describe('adversarial account boundaries with an abort-ignoring transport', () => {
  it.each(actions)('discards %s parsed after a complete switch to another account', async (_name, action) => {
    const { client, fetcher } = await setup()
    const parsing = deferred<void>(), body = deferred<unknown>()
    fetcher.mockResolvedValueOnce({ ok: true, json: () => { parsing.resolve(); return body.promise } } as Response)
    const pending = action(client).then(value => ({ value }), error => ({ error }))
    await parsing.promise
    client.signOut()
    fetcher.mockResolvedValueOnce(json(token('b'))).mockResolvedValueOnce(json(identity('b')))
    await client.login('b@example.test', 'synthetic'); await client.workspace()
    body.resolve({ saved: true, goals: [], projects: [], ...identity('a') })
    const result = await pending
    expect(result).toHaveProperty('error'); expect(String('error' in result && result.error)).toContain('Session changed')
    expect(() => client.sessionGuard('b')).not.toThrow()
    expect(() => client.sessionGuard('a')).toThrow('Account changed')
  })

  it('rejects 48 shuffled old responses without logging out the new account', async () => {
    const { client, fetcher } = await setup()
    const replies = Array.from({ length: 48 }, () => deferred<Response>())
    let started = 0
    fetcher.mockImplementation(() => replies[started++].promise)
    const pending = replies.map(() => client.feedbackRead('a').then(() => 'accepted', () => 'rejected'))
    await vi.waitFor(() => expect(started).toBe(48))
    client.signOut()
    fetcher.mockResolvedValueOnce(json(token('b'))).mockResolvedValueOnce(json(identity('b')))
    await client.login('b@example.test', 'synthetic'); await client.workspace()
    // Coprime permutation gives deterministic out-of-order completion, both success and 401.
    for (let i = 0; i < 48; i++) replies[(i * 13) % 48].resolve(json({ items: [], code: 'auth-session-expired' }, i % 3 ? 200 : 401))
    expect(await Promise.all(pending)).toEqual(Array(48).fill('rejected'))
    expect(() => client.sessionGuard('b')).not.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(52)
  })

  it.each([401, 403, 409, 429, 500])('does not automatically replay a write after status %i', async status => {
    const { client, fetcher } = await setup()
    fetcher.mockResolvedValueOnce(json({ code: 'auth-session-expired' }, status))
    await expect(client.feedbackCommand('a', 'question', { mutationId: 'one-only' })).rejects.toMatchObject({ status })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
