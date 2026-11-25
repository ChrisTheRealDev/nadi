import { describe, expect, it, vi } from 'vitest'
import { TrackingClient, TRACKING_SESSION_KEY, type TrackingSessionStorage } from './client'

const tokens = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: 3600 }
const workspace = { profile: { id: 'learner', display_name: 'Alex', role: 'student' }, disclosureAccepted: true, musicSharingAccepted: true, learners: [] }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function storage(): TrackingSessionStorage {
  const entries = new Map<string, string>()
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value) }, removeItem: key => { entries.delete(key) } }
}
async function savedSession(store: TrackingSessionStorage) {
  const client = new TrackingClient(vi.fn<typeof fetch>().mockResolvedValue(response(tokens)), () => 1000, store)
  await client.login('fixture@example.test', 'fixture-password')
  return client
}

describe('tab-scoped tracking session restoration', () => {
  it('restores tokens into a new client but requires fresh server identity before account writes', async () => {
    const store = storage(); await savedSession(store)
    const persisted = store.getItem(TRACKING_SESSION_KEY)!
    expect(persisted).not.toMatch(/fixture-password|fixture@example|actorId|display_name/)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(workspace))
    const restored = new TrackingClient(fetcher, () => 2000, store)
    expect(restored.hasSession()).toBe(true)
    expect(() => restored.sessionGuard('learner')).toThrow('Account changed')
    expect(fetcher).not.toHaveBeenCalled()
    expect(await restored.workspace()).toEqual(workspace)
    expect(() => restored.sessionGuard('learner')).not.toThrow()
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-access' })
  })
  it('clears saved sign-in on signout so another client cannot restore it', async () => {
    const store = storage(), client = await savedSession(store)
    client.signOut()
    expect(store.getItem(TRACKING_SESSION_KEY)).toBeNull()
    expect(new TrackingClient(fetch, Date.now, store).hasSession()).toBe(false)
  })
  it('does not restore rejected refresh tokens repeatedly', async () => {
    const store = storage(); await savedSession(store)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 401))
    const restored = new TrackingClient(fetcher, () => 4000000, store)
    await expect(restored.workspace()).rejects.toMatchObject({ status: 401 })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/refresh')
    expect(store.getItem(TRACKING_SESSION_KEY)).toBeNull()
    expect(restored.hasSession()).toBe(false)
  })
  it('retains a session after network failure and refreshes it on retry', async () => {
    const store = storage(); await savedSession(store)
    const rotated = { ...tokens, refreshToken: 'rotated-fixture' }
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(rotated)).mockResolvedValueOnce(response(workspace))
    const restored = new TrackingClient(fetcher, () => 4000000, store)
    await expect(restored.workspace()).rejects.toThrow('connection unavailable')
    expect(restored.hasSession()).toBe(true)
    expect(store.getItem(TRACKING_SESSION_KEY)).not.toBeNull()
    expect(await restored.workspace()).toEqual(workspace)
    expect(JSON.parse(store.getItem(TRACKING_SESSION_KEY)!).refreshToken).toBe('rotated-fixture')
  })
  it('clears a session rejected by workspace verification', async () => {
    const store = storage(); await savedSession(store)
    const restored = new TrackingClient(vi.fn<typeof fetch>().mockResolvedValue(response({}, 401)), () => 2000, store)
    await expect(restored.workspace()).rejects.toMatchObject({ status: 401 })
    expect(store.getItem(TRACKING_SESSION_KEY)).toBeNull()
    expect(() => restored.sessionGuard('learner')).toThrow()
  })
  it('remains usable in memory when tab storage is blocked', async () => {
    const blocked = () => { throw new Error('storage blocked') }
    const store = { getItem: blocked, setItem: blocked, removeItem: blocked }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(tokens)).mockResolvedValueOnce(response(workspace))
    const client = new TrackingClient(fetcher, () => 1000, store)
    await client.login('fixture@example.test', 'fixture-password')
    expect(await client.workspace()).toEqual(workspace)
    expect(() => client.signOut()).not.toThrow()
  })
  it.each(['not json', '{}', '{"version":1,"accessToken":"a","refreshToken":"r","expiresAt":-1}'])('ignores corrupt saved state %s', value => {
    const store = storage(); store.setItem(TRACKING_SESSION_KEY, value)
    const fetcher = vi.fn<typeof fetch>()
    expect(new TrackingClient(fetcher, Date.now, store).hasSession()).toBe(false)
    expect(store.getItem(TRACKING_SESSION_KEY)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('cannot repersist tokens when signout interrupts restoration refresh', async () => {
    const store = storage(); await savedSession(store)
    let finish!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const restored = new TrackingClient(fetcher, () => 4000000, store)
    const pending = restored.workspace()
    restored.signOut(); finish(response(tokens))
    await expect(pending).rejects.toThrow('Session changed')
    expect(store.getItem(TRACKING_SESSION_KEY)).toBeNull()
    expect(restored.hasSession()).toBe(false)
  })
})
