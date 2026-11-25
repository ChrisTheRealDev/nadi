import { StudioStore } from '../creation/v4/storage'
import { type StudioProject } from '../creation/v4/model'
import { TrackingClient, TrackingRequestError } from './client'
import { hydrateRevision, parseSharedWork } from './sharedReviewData'

export interface PendingRevision { mutationId: string; project: StudioProject; expectedServerRevision?: number; state: 'pending' | 'conflict'; savedAt: string }
export interface MiraExchange { requestId: string; projectId: string; prompt: string; response: string; status: 'pending' | 'complete' | 'failed'; source: string; createdAt: string; revision: number }
export type SyncState = { status: 'saved-locally' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'; lastSyncedAt?: string; message?: string }
const revisionKey = (p: StudioProject) => `sync:${p.id}:${String(p.revision).padStart(12, '0')}`
export class AccountStudioStore extends StudioStore {
  constructor(public readonly actorId: string, factory: IDBFactory | undefined = globalThis.indexedDB) {
    if (!/^[a-z0-9-]{1,120}$/i.test(actorId)) throw new Error('Invalid account identity.')
    super(factory, { databaseName: `nadi-account-${actorId}`, onSaved: (meta, project) => {
      const item: PendingRevision = { mutationId: crypto.randomUUID(), project, state: 'pending', savedAt: new Date().toISOString() }
      meta.put(item, revisionKey(project))
    } })
  }
  async records<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly'), store = tx.objectStore('meta'), result: { key: string; value: T }[] = []
      const cursor = store.openCursor()
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (String(c.key).startsWith(prefix)) result.push({ key: String(c.key), value: c.value }); c.continue() }
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error)
    })
  }
  async put(key: string, value: unknown): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value, key); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
  }
  async removeRecord(key: string): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').delete(key); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
  }
  async acknowledge(key: string, projectId: string, serverRevision: number): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta'); store.delete(key); store.put(serverRevision, `server:${projectId}`); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
  }
  async archiveExchange(exchange: MiraExchange): Promise<void> { await this.put(`mira:${exchange.requestId}`, exchange) }
  async installRemote(project: StudioProject, serverRevision: number, replacePending = false, expectedLocalRevision: number | null = null): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'meta'], 'readwrite'), meta = tx.objectStore('meta'), projects = tx.objectStore('projects')
      let failure: Error | undefined
      const previous = projects.get(project.id)
      previous.onsuccess = () => {
        if (expectedLocalRevision === null ? previous.result !== undefined : previous.result?.revision !== expectedLocalRevision) { failure = new Error('This composition changed while loading the shared revision. Review the latest local work before resolving.'); tx.abort(); return }
        if (previous.result !== undefined) meta.put(previous.result, `recovery:${project.id}:${Date.now()}`)
        projects.put(project, project.id); meta.put(serverRevision, `server:${project.id}`)
        const active = meta.get('last-active-project-id'); active.onsuccess = () => { if (active.result === undefined) meta.put(project.id, 'last-active-project-id') }
      }
      if (replacePending) {
        const cursor = meta.openCursor()
        cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (String(c.key).startsWith(`sync:${project.id}:`)) { meta.put(c.value, `recovered-pending:${String(c.key)}:${Date.now()}`); c.delete() } c.continue() }
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error)
    })
  }
}

/** Pull only absent projects. Existing local revisions always go through conflict handling. */
export async function loadRemoteAccountProjects(store: AccountStudioStore, client: TrackingClient): Promise<void> {
  const guard = client.sessionGuard(store.actorId), known = new Set((await store.listEntries()).healthy.map(p => p.id)); guard()
  const heads = parseSharedWork(await client.sharedRead(store.actorId, store.actorId)); guard()
  for (const head of heads.projects) {
    if (known.has(head.project_id)) continue
    const detail = parseSharedWork(await client.sharedRead(store.actorId, store.actorId, head.project_id)); guard()
    const latest = detail.revisions[0]; if (!latest) continue
    const project = await hydrateRevision(latest.manifest, client, store.actorId, store.actorId); guard()
    await store.installRemote(project, latest.revision); guard()
  }
}
/** Retains the conflicted local version durably; optionally creates a separately named editable copy. */
export async function resolveAccountConflict(store: AccountStudioStore, client: TrackingClient, projectId: string, keepCopy: boolean): Promise<void> {
  const guard = client.sessionGuard(store.actorId)
  const local = (await store.listEntries()).healthy.find(p => p.id === projectId); guard()
  const detail = parseSharedWork(await client.sharedRead(store.actorId, store.actorId, projectId)); guard()
  const latest = detail.revisions[0]; if (!latest || !local) throw new Error('Both revisions must be available before resolving a conflict.')
  const remote = await hydrateRevision(latest.manifest, client, store.actorId, store.actorId); guard()
  if (keepCopy) { const copy = { ...structuredClone(local), id: crypto.randomUUID(), revision: 0, name: `${local.name.slice(0,100)} (local copy)` }; await store.save(copy, null); guard() }
  await store.installRemote(remote, latest.revision, true, local.revision); guard()
  if (!keepCopy) { await store.activate(remote.id, remote.revision); guard() }
}

export async function captureManifest(project: StudioProject, upload: (capture: { hash: string; base64: string; mimeType: string }) => Promise<void>): Promise<unknown> {
  const copy = structuredClone(project)
  for (const idea of copy.ideas) {
    if (idea.original.kind !== 'audio') continue
    const original = idea.original
    const bytes = Uint8Array.from(atob(original.base64), char => char.charCodeAt(0))
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
    await upload({ hash, base64: original.base64, mimeType: original.mimeType })
    // Remote manifests reference immutable private bytes; the local original is untouched.
    Object.assign(original, { assetHash: hash }); delete (original as Partial<typeof original>).base64
  }
  return copy
}
const flights = new WeakMap<AccountStudioStore, Promise<SyncState>>()
export function syncPendingProjects(store: AccountStudioStore, client: TrackingClient): Promise<SyncState> {
  const current = flights.get(store); if (current) return current
  const flight = sync(store, client).finally(() => flights.delete(store)); flights.set(store, flight); return flight
}
async function sync(store: AccountStudioStore, client: TrackingClient): Promise<SyncState> {
  try {
    // A refresh can invalidate authentication between timer ticks. Report that
    // boundary as a sync state too; never reject the next autosync promise.
    const guard = client.sessionGuard(store.actorId)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' }
    const revisions = await store.records<PendingRevision>('sync:'); guard()
    const uploadedCaptures = new Set((await store.records<boolean>('capture-uploaded:')).filter(r => r.value).map(r => r.key)); guard()
    for (const { key, value: item } of revisions) {
      if (item.state === 'conflict') return { status: 'conflict', message: 'Another session saved this project. Both versions are retained; review before retrying.' }
      if (item.expectedServerRevision === undefined) {
        const remote = await store.records<number>(`server:${item.project.id}`); guard()
        item.expectedServerRevision = remote.find(r => r.key === `server:${item.project.id}`)?.value ?? 0
        await store.put(key, item); guard()
      }
      const manifest = await captureManifest(item.project, async capture => {
        const key = `capture-uploaded:${capture.hash}`
        if (uploadedCaptures.has(key)) return
        await client.uploadCapture(store.actorId, capture); guard()
        await store.put(key, true); guard(); uploadedCaptures.add(key)
      }); guard()
      try {
        const result = await client.sharedCommand(store.actorId, 'revision', { mutationId: item.mutationId, projectId: item.project.id, expectedRevision: item.expectedServerRevision, manifest, savedAt: item.savedAt }) as { revision: number }
        guard(); if (!Number.isInteger(result.revision) || result.revision !== item.expectedServerRevision + 1) throw new Error('Unconfirmed revision response.')
        await store.acknowledge(key, item.project.id, result.revision); guard()
      } catch (error) {
        if (error instanceof TrackingRequestError && error.status === 409) { item.state = 'conflict'; await store.put(key, item) }
        throw error
      }
    }
    const exchanges = await store.records<MiraExchange>('mira:'); guard()
    const receipts = new Map((await store.records<string>('mira-sent:')).map(row => [row.key, row.value])); guard()
    for (const { value } of exchanges) {
      const fingerprint = JSON.stringify(value), receiptKey = `mira-sent:${value.requestId}`
      if (receipts.get(receiptKey) === fingerprint) continue
      await client.sharedCommand(store.actorId, 'exchange', { ...value, mutationId: `${value.requestId}:${value.status}` }); guard()
      await store.put(receiptKey, fingerprint); guard()
    }
    return { status: 'synced', lastSyncedAt: new Date().toISOString() }
  } catch (error) { return { status: error instanceof TrackingRequestError && error.status === 409 ? 'conflict' : 'error', message: error instanceof Error ? error.message : 'Sync unavailable. Local work retained.' } }
}
