import { describe, expect, it, vi } from 'vitest'
import { TrackingClient } from './client'
import { deliverFeedback, feedbackReply, type FeedbackPending, type FeedbackStorage } from './feedbackOutbox'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function memory() {
  const rows = new Map<string, FeedbackPending>()
  const store: FeedbackStorage = { put: async (key, value) => { rows.set(key, structuredClone(value as FeedbackPending)) }, removeRecord: async key => { rows.delete(key) } }
  return { rows, store }
}
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })

describe('v016 outbox disaster execution with synthetic storage and injected transport', () => {
  it('drains 5,000 independent commands after uncertain commits without changing retry identities', async () => {
    const { rows, store } = memory(), committed = new Map<string, string>(), expectedRetained = new Set<string>()
    const queue = Array.from({ length: 5000 }, (_, index) => feedbackReply(['comment:t', 'question:q', 'checkpoint:c', 'new-question'][index % 4], `Synthetic message ${index}`, 'snapshot', `command-${index}`))
    for (const pending of queue) await store.put(pending.key, pending)
    expect(rows.size).toBe(5000)
    for (const [index, pending] of queue.entries()) {
      const mode = index % 5, before = structuredClone(pending)
      const adapter = { put: store.put, removeRecord: async (key: string) => { if (mode === 3) throw new Error('cleanup unavailable'); await store.removeRecord(key) } }
      const delivery = deliverFeedback(adapter, pending, async command => {
        expect(rows.get(command.key)).toEqual(before)
        if (mode === 0) throw new Error('offline before commit')
        committed.set(String(command.payload.mutationId), String(command.payload.message))
        if (mode === 1) throw new Error('acknowledgement lost after commit')
        if (mode === 2 && pending.shared) return { saved: false }
        return { saved: true, id: `receipt-${index}` }
      })
      if (mode < 2 || mode === 2 && pending.shared) { await expect(delivery).rejects.toThrow(); expectedRetained.add(pending.key) }
      else { expect((await delivery).cleaned).toBe(mode !== 3); if (mode === 3) expectedRetained.add(pending.key) }
      expect(pending).toEqual(before)
    }
    expect(new Set(rows.keys())).toEqual(expectedRetained)
    for (const pending of [...rows.values()]) {
      const expected = queue.find(command => command.key === pending.key)!
      await deliverFeedback(store, pending, async command => {
        expect(command).toEqual(expected)
        const id = String(command.payload.mutationId), message = String(command.payload.message)
        if (committed.has(id)) expect(committed.get(id)).toBe(message)
        else committed.set(id, message)
        return { saved: true }
      })
    }
    expect(rows.size).toBe(0)
    expect(committed.size).toBe(5000)
  }, 20_000)

  it.each(['QuotaExceededError', 'AbortError', 'SecurityError', 'InvalidStateError'])('does not transmit after storage rejects with %s', async name => {
    const { rows, store } = memory(), pending = feedbackReply('comment:t', 'Retained old message', null, 'stable')
    await store.put(pending.key, pending)
    const send = vi.fn(async () => ({ saved: true })), cleanup = vi.fn(store.removeRecord)
    const failing = { put: async () => { throw new DOMException('Synthetic storage failure', name) }, removeRecord: cleanup }
    await expect(deliverFeedback(failing, pending, send)).rejects.toMatchObject({ name })
    expect(send).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled()
    expect(rows.get(pending.key)).toEqual(pending)
  })

  it('snapshots identity before storage yields so caller mutation cannot change the wire command or cleanup key', async () => {
    const { rows, store } = memory(), gate = deferred<void>(), pending = feedbackReply('comment:t', 'Original text', 'snapshot', 'stable')
    const before = structuredClone(pending), other = feedbackReply('comment:other', 'Other saved text', null, 'other')
    await store.put(other.key, other)
    const send = vi.fn(async (command: FeedbackPending) => { expect(command).toEqual(before); return { saved: true } })
    const flight = deliverFeedback({ put: async (key, value) => { await store.put(key, value); await gate.promise }, removeRecord: store.removeRecord }, pending, send)
    pending.key = other.key; pending.payload.mutationId = 'changed'; pending.payload.message = 'Changed during storage'
    gate.resolve()
    await expect(flight).resolves.toMatchObject({ cleaned: true })
    expect(send.mock.calls[0]?.[0]).toEqual(before)
    expect(rows.has(before.key)).toBe(false)
    expect(rows.get(other.key)).toEqual(other)
  })

  it.each(['during-persistence', 'during-network'] as const)('retains the old account queue when account changes %s', async phase => {
    const { rows, store } = memory(), gate = deferred<void>(), network = deferred<Response>(), reached = deferred<void>()
    let actor = 'alpha', commands = 0
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/auth/login')) return response({ accessToken: `synthetic-${actor}`, refreshToken: 'synthetic-refresh', expiresIn: 3600 })
      if (url.endsWith('/workspace')) return response({ profile: { id: actor, display_name: 'Synthetic learner', role: 'student' }, disclosureAccepted: true, learners: [] })
      commands++; reached.resolve(); return network.promise
    })
    const client = new TrackingClient(fetcher, () => 1000)
    await client.login('synthetic@example.test', 'synthetic-password'); await client.workspace()
    const pending = feedbackReply('comment:t', 'Alpha pending', null, 'stable-alpha')
    const flight = deliverFeedback({ put: async (key, value) => { await store.put(key, value); if (phase === 'during-persistence') await gate.promise }, removeRecord: store.removeRecord }, pending, command => client.sharedCommand('alpha', command.kind, command.payload))
    const rejected = expect(flight).rejects.toThrow(/Account changed|Session changed/)
    if (phase === 'during-network') await reached.promise
    client.signOut(); actor = 'beta'
    await client.login('synthetic-beta@example.test', 'synthetic-password'); await client.workspace()
    gate.resolve(); network.resolve(response({ saved: true }))
    await rejected
    expect(commands).toBe(phase === 'during-network' ? 1 : 0)
    expect(rows.get(pending.key)).toEqual(pending)
    expect(() => client.sessionGuard('beta')).not.toThrow()
  })
})
