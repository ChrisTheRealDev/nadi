import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from '../creation/v4/model'
import { AccountStudioStore, syncPendingProjects, type PendingRevision } from './accountStore'
import { TrackingClient, TRACKING_SESSION_KEY } from './client'

class LocalAccount extends AccountStudioStore {
  recordsByKey = new Map<string, unknown>()
  constructor() { super('learner') }
  override async records<T>(prefix: string) { return [...this.recordsByKey].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) as T })) }
  override async put(key: string, value: unknown) { this.recordsByKey.set(key, structuredClone(value)) }
  override async acknowledge(key: string, projectId: string, revision: number) { this.recordsByKey.delete(key); this.recordsByKey.set(`server:${projectId}`, revision) }
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('expired authentication during account autosync', () => {
  it('returns a handled state on every later poll and preserves the original pending music', async () => {
    let clock = 0
    const saved = new Map<string, string>()
    const sessionStorage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) }, removeItem: (key: string) => { saved.delete(key) } }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: 3600 }))
      .mockResolvedValueOnce(response({ profile: { id: 'learner', display_name: 'Synthetic learner', role: 'student' }, disclosureAccepted: true, learners: [] }))
      .mockResolvedValueOnce(response({ code: 'auth-session-expired' }, 401))
    const client = new TrackingClient(fetcher, () => clock, sessionStorage)
    await client.login('synthetic@example.test', 'fixture-password'); await client.workspace()
    const store = new LocalAccount(), project = createStudioProject()
    project.patterns[0].notes.push({ id: 'kept-note', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 })
    const key = `sync:${project.id}:0`
    const pending: PendingRevision = { mutationId: 'unchanged-mutation', project, state: 'pending', savedAt: '2026-09-27T00:00:00.000Z' }
    store.recordsByKey.set(key, structuredClone(pending))
    clock = 3_600_000
    expect((await syncPendingProjects(store, client)).status).toBe('error')
    expect(client.hasSession()).toBe(false)
    expect(saved.has(TRACKING_SESSION_KEY)).toBe(false)
    // Studio's timer consumes returned states, so a rejected promise here escapes its handler.
    for (let poll = 0; poll < 3; poll++) await expect(syncPendingProjects(store, client)).resolves.toMatchObject({ status: 'error' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(store.recordsByKey.get(key)).toMatchObject(pending)
    expect((store.recordsByKey.get(key) as PendingRevision).project).toEqual(project)
    expect([...store.recordsByKey.keys()]).toEqual([key])
    // Intentional reauthentication resumes the original durable update, rather
    // than generating another mutation or losing the composition.
    fetcher.mockResolvedValueOnce(response({ accessToken: 'renewed-fixture', refreshToken: 'renewed-refresh', expiresIn: 3600 }))
      .mockResolvedValueOnce(response({ profile: { id: 'learner', display_name: 'Synthetic learner', role: 'student' }, disclosureAccepted: true, learners: [] }))
      .mockResolvedValueOnce(response({ revision: 1 }))
    await client.login('synthetic@example.test', 'fixture-password'); await client.workspace()
    expect((await syncPendingProjects(store, client)).status).toBe('synced')
    const write = fetcher.mock.calls.find(([path]) => path === '/api/v1/shared')!
    expect(JSON.parse(String(write[1]?.body))).toMatchObject({ kind: 'revision', payload: { mutationId: pending.mutationId, expectedRevision: 0, manifest: project } })
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/v1/shared')).toHaveLength(1)
    expect(store.recordsByKey.has(key)).toBe(false)
    expect(store.recordsByKey.get(`server:${project.id}`)).toBe(1)
  })
})
