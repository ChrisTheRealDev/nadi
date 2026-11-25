import { describe, expect, it } from 'vitest'
import { deliverFeedback, feedbackReply, type FeedbackPending } from './feedbackOutbox'

describe('adversarial durable feedback retries', () => {
  it('fails closed before transmission when durable storage fails', async () => {
    let sends = 0
    const store = { put: async () => { throw new Error('quota') }, removeRecord: async () => { throw new Error('must not remove') } }
    await expect(deliverFeedback(store, feedbackReply('comment:t', 'message', null, 'fixed'), async () => { sends++; return { saved: true } })).rejects.toThrow('quota')
    expect(sends).toBe(0)
  })

  it('retains identity and eventual delivery across 120 deterministic uncertain outcomes', async () => {
    const persisted = new Map<string, FeedbackPending>(), committed = new Map<string, string>()
    let seed = 1977, cleanupFails = false, sends = 0
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
    const store = {
      put: async (key: string, value: unknown) => { persisted.set(key, structuredClone(value as FeedbackPending)) },
      removeRecord: async (key: string) => { if (cleanupFails) throw new Error('disk unavailable'); persisted.delete(key) },
    }
    const stable = feedbackReply('comment:thread', 'Synthetic retry message', 'snapshot', 'stable-command')
    for (let i = 0; i < 120; i++) {
      const mode = next() % 4; cleanupFails = mode === 3
      const send = async (pending: FeedbackPending) => {
        sends++; expect(persisted.get(pending.key)).toEqual(stable)
        expect(pending.payload.mutationId).toBe('stable-command')
        if (mode === 0) throw new Error('offline before commit')
        committed.set(String(pending.payload.mutationId), String(pending.payload.message))
        if (mode === 1) throw new Error('response lost after commit')
        return { saved: true }
      }
      if (mode < 2) {
        await expect(deliverFeedback(store, stable, send)).rejects.toThrow()
        expect(persisted.get(stable.key)).toEqual(stable)
      } else {
        expect((await deliverFeedback(store, stable, send)).cleaned).toBe(!cleanupFails)
        expect(persisted.has(stable.key)).toBe(cleanupFails)
      }
    }
    cleanupFails = false
    await deliverFeedback(store, stable, async () => ({ saved: true }))
    expect(persisted.size).toBe(0); expect(committed.size).toBe(1); expect(sends).toBe(120)
  })
})
