import { unlink } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { DurableMiraBudget, MemoryMiraBudgetRepository, isMiraBudgetLedger } from './budget'
import { NodeFileMiraBudgetRepository } from './nodeFileBudgetRepository'

describe('durable Mira budget', () => {
  it('atomically admits only requests that fit under concurrent reservations', async () => {
    const repository = new MemoryMiraBudgetRepository()
    const budget = new DurableMiraBudget(repository, 1_000)
    const results = await Promise.all([
      budget.reserve('request-a', 600, '2026-09-05T00:00:00.000Z'),
      budget.reserve('request-b', 600, '2026-09-05T00:00:00.000Z'),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect((await budget.snapshot()).entries).toHaveLength(1)
  })

  it('preserves uncertain reservations across store restart', async () => {
    const repository = new MemoryMiraBudgetRepository()
    const first = new DurableMiraBudget(repository, 1_000)
    await first.reserve('request-crash', 700, '2026-09-05T00:00:00.000Z')
    const afterRestart = new DurableMiraBudget(repository, 1_000)
    expect(await afterRestart.reserve('request-next', 400, '2026-09-05T00:01:00.000Z')).toEqual({ ok: false })
    await afterRestart.settle('request-crash')
    expect((await afterRestart.snapshot()).entries[0]).toMatchObject({ amountMicrousd: 700, state: 'uncertain' })
  })

  it('records a known actual cost above the reservation as an overshoot and fails closed afterward', async () => {
    const repository = new MemoryMiraBudgetRepository()
    const budget = new DurableMiraBudget(repository, 1_000_000)
    await budget.reserve('request-over', 200_000, 'now')
    await budget.settle('request-over', 220_000)
    expect((await budget.snapshot()).entries[0]).toMatchObject({ amountMicrousd: 220_000, state: 'overshoot' })
    expect(await budget.reserve('request-blocked', 200_000, 'later')).toEqual({ ok: false })
    const restarted = new DurableMiraBudget(repository, 1_000_000)
    expect(await restarted.reserve('request-after-restart', 200_000, 'later')).toEqual({ ok: false })
  })

  it('flushes an atomic file ledger that a new repository instance can read', async () => {
    const path = `server/mira/.budget-test-${crypto.randomUUID()}.json`
    try {
      const first = new DurableMiraBudget(new NodeFileMiraBudgetRepository(path), 2_000)
      await first.reserve('request-file', 500, '2026-09-05T00:00:00.000Z')
      const restarted = new DurableMiraBudget(new NodeFileMiraBudgetRepository(path), 2_000)
      expect((await restarted.snapshot()).entries[0]).toMatchObject({ requestId: 'request-file', amountMicrousd: 500 })
    } finally {
      await unlink(path).catch(() => undefined)
      await unlink(`${path}.lock`).catch(() => undefined)
    }
  })

  it('treats malformed unknown ledgers as data instead of throwing', () => {
    expect(isMiraBudgetLedger({ version: 1, capMicrousd: 100, entries: [null] })).toBe(false)
    expect(isMiraBudgetLedger({ version: 1, capMicrousd: 100, entries: [{ requestId: 'same', amountMicrousd: 1, reservedAt: 'now', state: 'settled' }, { requestId: 'same', amountMicrousd: 1, reservedAt: 'now', state: 'settled' }] })).toBe(false)
  })
})
