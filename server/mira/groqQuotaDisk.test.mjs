import { expect, it } from 'vitest'
import { mkdtemp, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DurableMiraBudget } from './budget'
import { NodeFileMiraBudgetRepository } from './nodeFileBudgetRepository'
import { durableGroqRequestQuota } from './groqHandler'

it('persists request units to a dedicated file and prevents concurrent or restarted overspending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nadi-groq-quota-test-')), filename = join(directory, 'groq-requests.json')
  try {
    const first = durableGroqRequestQuota(new DurableMiraBudget(new NodeFileMiraBudgetRepository(filename), 1))
    const second = durableGroqRequestQuota(new DurableMiraBudget(new NodeFileMiraBudgetRepository(filename), 1))
    const results = await Promise.all([first.reserve('first-request', new Date(0).toISOString()), second.reserve('second-request', new Date(0).toISOString())])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    await first.settle(results[0].ok ? 'first-request' : 'second-request')
    const reopened = new DurableMiraBudget(new NodeFileMiraBudgetRepository(filename), 1)
    expect(await durableGroqRequestQuota(reopened).reserve('reopened-request', new Date(1).toISOString())).toMatchObject({ ok: false })
    expect((await reopened.snapshot()).entries).toMatchObject([{ amountMicrousd: 1, state: 'settled' }])
  } finally { await unlink(filename).catch(() => undefined); await rmdir(directory) }
})
