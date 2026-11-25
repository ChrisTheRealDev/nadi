import { validTrackingCommand, validateCommandResult, type TrackingCommand, type TrackingCommandResult } from './commands'
import { TrackingRequestError, type TrackingClient } from './client'

export type CommandRejection = 'invalid' | 'forbidden' | 'conflict'
export interface PendingCommand { id: string; actorId: string; command: TrackingCommand; createdAt: string; rejection?: CommandRejection }
export interface PendingCommandStorage {
  list(actorId: string): Promise<unknown[]>
  add(record: PendingCommand): Promise<void>
  remove(actorId: string, id: string): Promise<void>
  reject(actorId: string, id: string, rejection: CommandRejection | undefined): Promise<void>
}
const failure = () => new Error('Pending-update storage unavailable. Nothing new was sent. Keep your text and retry.')
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
function validateRecord(raw: unknown, actorId: string): PendingCommand {
  if (!raw || typeof raw !== 'object') throw new Error('A pending update is unreadable. It was retained and not sent.')
  const r = raw as PendingCommand
  if (!['actorId,command,createdAt,id','actorId,command,createdAt,id,rejection'].includes(Object.keys(r).sort().join(',')) || (r.rejection !== undefined && !['invalid','forbidden','conflict'].includes(r.rejection)) || r.actorId !== actorId || !uuid(r.id) || !validTrackingCommand(r.command) || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) || (r.command.kind !== 'disclosure' && r.command.payload.submissionId !== r.id)) throw new Error('A pending update is unreadable. It was retained and not sent.')
  return structuredClone(r)
}
function factory(): IDBFactory | undefined { try { return globalThis.indexedDB } catch { return undefined } }

/** Separate from all musical project databases; key is [verified actor, submission]. */
export class IndexedPendingCommands implements PendingCommandStorage {
  private database?: Promise<IDBDatabase>
  constructor(private idb = factory()) {}
  private open(): Promise<IDBDatabase> {
    if (!this.idb) return Promise.reject(failure())
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = this.idb!.open('nadi-tracking-pending-v1', 1)
        let failed = false
        const timeout = setTimeout(() => { failed = true; reject(failure()) }, 10000)
        request.onupgradeneeded = () => { const store = request.result.createObjectStore('commands', { keyPath: ['actorId','id'] }); store.createIndex('actor','actorId') }
        request.onsuccess = () => { clearTimeout(timeout); if (failed) { request.result.close(); return }; request.result.onversionchange = () => { request.result.close(); this.database = undefined }; resolve(request.result) }
        request.onerror = request.onblocked = () => { failed = true; clearTimeout(timeout); reject(failure()) }
      })
      void this.database.catch(() => { this.database = undefined })
    }
    return this.database
  }
  async list(actorId: string): Promise<unknown[]> {
    const db = await this.open()
    return new Promise((resolve,reject) => {
      const tx = db.transaction('commands','readonly')
      const request = tx.objectStore('commands').index('actor').getAll(actorId)
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(failure())
    })
  }
  async add(record: PendingCommand): Promise<void> {
    const db = await this.open()
    return new Promise((resolve,reject) => {
      const tx = db.transaction('commands','readwrite'), store = tx.objectStore('commands')
      const existing = store.get([record.actorId,record.id])
      const count = store.index('actor').count(record.actorId)
      count.onsuccess = () => {
        if (existing.result) {
          if (JSON.stringify(existing.result.command) !== JSON.stringify(record.command)) tx.abort()
        } else if (count.result >= 100) tx.abort()
        else store.add(record)
      }
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(new Error('Could not keep the pending update: storage conflict, capacity or write failure. Nothing was sent.'))
    })
  }
  async remove(actorId: string, id: string): Promise<void> {
    const db = await this.open()
    return new Promise((resolve,reject) => {
      const tx = db.transaction('commands','readwrite')
      tx.objectStore('commands').delete([actorId,id])
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(failure())
    })
  }
  async reject(actorId: string, id: string, rejection: CommandRejection | undefined): Promise<void> {
    const db = await this.open()
    return new Promise((resolve,reject) => {
      const tx = db.transaction('commands','readwrite'), store = tx.objectStore('commands')
      const request = store.get([actorId,id])
      request.onsuccess = () => { if (request.result) { const next = {...request.result}; if (rejection) next.rejection = rejection; else delete next.rejection; store.put(next) } }
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(failure())
    })
  }
}

export class PendingCommands {
  private flights = new Map<string, Promise<TrackingCommandResult>>()
  constructor(private actorId: string, private storage: PendingCommandStorage = new IndexedPendingCommands()) {
    if (!uuid(actorId)) throw new Error('A verified account is required for pending updates.')
  }
  async list(): Promise<PendingCommand[]> { return (await this.storage.list(this.actorId)).map(r => validateRecord(r,this.actorId)) }
  async prepare(command: TrackingCommand): Promise<PendingCommand> {
    if (!validTrackingCommand(command)) throw new Error('Invalid update. Nothing was kept or sent.')
    const frozen = structuredClone(command)
    const r = { id: frozen.kind === 'disclosure' ? crypto.randomUUID() : frozen.payload.submissionId, actorId:this.actorId, command:frozen, createdAt:new Date().toISOString() }
    await this.storage.add(r)
    return structuredClone(r)
  }
  private async get(id: string) {
    const r = (await this.list()).find(r => r.id === id)
    if (!r) throw new Error('Pending update not found for this account. Nothing was sent.')
    return r
  }
  send(id: string, client: TrackingClient): Promise<TrackingCommandResult> {
    const guard = client.sessionGuard(this.actorId)
    if (this.flights.has(id)) return this.flights.get(id)!.then(result => { guard(); return result })
    const flight = (async () => {
      const r = await this.get(id); guard()
      // A new attempt can commit even if the preceding one was rejected. Clear
      // the old definitive status durably before allowing another transmission.
      if (r.rejection) { await this.storage.reject(this.actorId,id,undefined); guard() }
      let result: TrackingCommandResult
      try { result = validateCommandResult(r.command, await client.command(this.actorId,r.command)); guard() }
      catch (error) {
        guard()
        const rejection = error instanceof TrackingRequestError ? ({400:'invalid',403:'forbidden',409:'conflict'} as const)[error.status as 400|403|409] : undefined
        if (rejection) { try { await this.storage.reject(this.actorId,id,rejection) } catch { /* Keep original pending record on local failure. */ }; guard() }
        throw error
      }
      try { await this.storage.remove(this.actorId,id) }
      catch { guard(); return { ...result, localCleanupPending:true } }
      guard(); return result
    })()
    this.flights.set(id,flight)
    void flight.finally(() => { if (this.flights.get(id) === flight) this.flights.delete(id) }).catch(() => {})
    return flight
  }
  async discardRejected(id: string): Promise<void> {
    if (this.flights.has(id)) throw new Error('Wait for the current attempt before removing its local record.')
    const r = await this.get(id)
    if (!r.rejection) throw new Error('The outcome is unconfirmed. Check status or retry; do not discard this update.')
    await this.storage.remove(this.actorId,id)
  }
  async check(id: string, client: TrackingClient): Promise<{found:boolean;result:TrackingCommandResult|null}> {
    const guard = client.sessionGuard(this.actorId)
    const r = await this.get(id); guard()
    const receipt = r.command.kind === 'disclosure'
      ? { found:(await client.workspace()).disclosureAccepted, result:{accepted:true,version:1} }
      : await client.submission(this.actorId,id)
    guard()
    if (!receipt.found) return {found:false,result:null}
    if (!receipt.result) throw new Error('Confirmation unreadable. Keep the pending update.')
    const result = validateCommandResult(r.command,receipt.result)
    try { await this.storage.remove(this.actorId,id) }
    catch { guard(); return {found:true,result:{...result,localCleanupPending:true}} }
    guard(); return {found:true,result}
  }
}
