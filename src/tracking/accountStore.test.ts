import { describe, expect, it, vi } from 'vitest'
import { AccountStudioStore, syncPendingProjects, type PendingRevision, type MiraExchange } from './accountStore'
import { createStudioProject } from '../creation/v4/model'
import { TrackingRequestError, type TrackingClient } from './client'
import { createAudioIdea } from '../creation/ideas'

class MemoryAccount extends AccountStudioStore {
  data = new Map<string, unknown>()
  constructor() { super('learner') }
  override async records<T>(prefix: string) { return [...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) as T })) }
  override async put(key: string, value: unknown) { this.data.set(key, structuredClone(value)) }
  override async acknowledge(key: string, projectId: string, serverRevision: number) { this.data.delete(key); this.data.set(`server:${projectId}`, serverRevision) }
}
function pending(store: MemoryAccount, mutationId: string, revision: number) {
  const project = createStudioProject(); project.id = 'project'; project.revision = revision
  const value: PendingRevision = { mutationId, project, state: 'pending', savedAt: '2026-09-26T00:00:00.000Z' }
  store.data.set(`sync:project:${revision}`, value)
}
describe('account revision delivery', () => {
  it('uploads unchanged original audio once across multiple saved revisions', async () => {
    const store = new MemoryAccount(); pending(store, 'first', 0); pending(store, 'second', 1)
    for (const value of store.data.values()) (value as PendingRevision).project.ideas.push(createAudioIdea('YWJj', 'audio/webm', 3, 1000))
    const uploadCapture = vi.fn(async () => {}), sharedCommand = vi.fn(async (_actor, _kind, payload) => ({ revision: payload.expectedRevision + 1 }))
    const client = { sessionGuard: () => () => {}, sharedCommand, uploadCapture } as unknown as TrackingClient
    expect((await syncPendingProjects(store, client)).status).toBe('synced')
    expect(uploadCapture).toHaveBeenCalledTimes(1); expect(sharedCommand).toHaveBeenCalledTimes(2)
  })
  it('freezes the original remote expectation and mutation identity after a lost acknowledgement', async () => {
    const store = new MemoryAccount(); pending(store, 'stable-id', 0)
    let attempts = 0
    const sharedCommand = vi.fn(async (_actor: string, _kind: string, payload: { expectedRevision: number; mutationId: string }) => { attempts++; if (attempts === 1) throw new Error('Acknowledgement lost'); return { revision: payload.expectedRevision + 1 } })
    const client = { sessionGuard: () => () => {}, sharedCommand } as unknown as TrackingClient
    expect((await syncPendingProjects(store, client)).status).toBe('error')
    expect((store.data.get('sync:project:0') as PendingRevision).expectedServerRevision).toBe(0)
    expect((await syncPendingProjects(store, client)).status).toBe('synced')
    expect(sharedCommand.mock.calls.map(c => [c[2].mutationId, c[2].expectedRevision])).toEqual([['stable-id',0],['stable-id',0]])
    expect(store.data.get('server:project')).toBe(1)
  })
  it('stops on conflict without overwriting or discarding a later local revision', async () => {
    const store = new MemoryAccount(); pending(store, 'first', 0); pending(store, 'next', 1)
    const sharedCommand = vi.fn(async () => { throw new TrackingRequestError('Conflict',409) })
    const client = { sessionGuard: () => () => {}, sharedCommand } as unknown as TrackingClient
    expect((await syncPendingProjects(store,client)).status).toBe('conflict')
    expect((store.data.get('sync:project:0') as PendingRevision).state).toBe('conflict')
    expect(store.data.has('sync:project:1')).toBe(true)
    await syncPendingProjects(store,client); expect(sharedCommand).toHaveBeenCalledTimes(1)
  })
  it('never resends an acknowledged Mira archive entry until its status changes', async () => {
    const store = new MemoryAccount()
    const exchange: MiraExchange = { requestId:'request',projectId:'project',prompt:'How can I improve?',response:'',status:'pending',source:'builtin',createdAt:'2026-09-26T00:00:00.000Z',revision:0 }
    store.data.set('mira:request',exchange)
    const sharedCommand = vi.fn(async () => ({saved:true})), client = {sessionGuard:()=>()=>{},sharedCommand} as unknown as TrackingClient
    await syncPendingProjects(store,client); await syncPendingProjects(store,client)
    expect(sharedCommand).toHaveBeenCalledTimes(1)
    store.data.set('mira:request',{...exchange,status:'complete',response:'Try a shorter phrase.'})
    await syncPendingProjects(store,client)
    expect(sharedCommand).toHaveBeenCalledTimes(2)
  })
})
