import { decodeProject, validateProject, type CreationProject } from './model'

export const CREATION_DATABASE_NAME = 'nadi-creation-v1'
export const CREATION_DATABASE_VERSION = 1

const PROJECTS_STORE = 'projects'
const META_STORE = 'meta'
const LAST_ACTIVE_KEY = 'last-active-project-id'

export class CreationStorageError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'blocked' | 'conflict' | 'corrupt' | 'write-failed',
    message: string,
  ) {
    super(message)
    this.name = 'CreationStorageError'
  }
}

export class CreationStore {
  private databaseFlight?: Promise<IDBDatabase>

  constructor(private readonly factory: IDBFactory | undefined = safeFactory()) {}

  async load(): Promise<CreationProject | undefined> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([PROJECTS_STORE, META_STORE], 'readonly')
      const metaRequest = transaction.objectStore(META_STORE).get(LAST_ACTIVE_KEY)
      let result: unknown
      let hasActiveProject = false
      let failure: CreationStorageError | undefined

      metaRequest.onsuccess = () => {
        if (metaRequest.result === undefined) return
        hasActiveProject = true
        if (typeof metaRequest.result !== 'string') {
          failure = new CreationStorageError('corrupt', 'The last active creation reference is corrupt.')
          return
        }
        const projectRequest = transaction.objectStore(PROJECTS_STORE).get(metaRequest.result)
        projectRequest.onsuccess = () => { result = projectRequest.result }
        projectRequest.onerror = () => { failure = unavailable(projectRequest.error, 'The active creation could not be read.') }
      }
      metaRequest.onerror = () => { failure = unavailable(metaRequest.error, 'The active creation reference could not be read.') }
      transaction.oncomplete = () => {
        if (failure) reject(failure)
        else if (!hasActiveProject) resolve(undefined)
        else if (result === undefined) reject(new CreationStorageError('corrupt', 'The active creation is missing.'))
        else {
          try { resolve(decodeProject(result)) }
          catch { reject(new CreationStorageError('corrupt', 'The active creation is corrupt.')) }
        }
      }
      transaction.onabort = () => reject(failure ?? unavailable(transaction.error, 'The creation read was aborted.'))
    })
  }

  async save(project: CreationProject, expectedRevision: number | null): Promise<void> {
    if (!validateProject(project)) throw new CreationStorageError('corrupt', 'The creation is invalid and was not saved.')
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new CreationStorageError('conflict', 'The expected revision is invalid.')
    }
    const expectedNextRevision = expectedRevision === null ? 0 : expectedRevision + 1
    if (project.revision !== expectedNextRevision) {
      throw new CreationStorageError('conflict', `The creation revision must be ${expectedNextRevision} for this save.`)
    }
    const snapshot = structuredClone(project)
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([PROJECTS_STORE, META_STORE], 'readwrite')
      const projects = transaction.objectStore(PROJECTS_STORE)
      const read = projects.get(snapshot.id)
      let conflict = false
      let failure: unknown

      read.onsuccess = () => {
        let current: CreationProject | undefined
        try { current = read.result === undefined ? undefined : decodeProject(read.result) }
        catch {
          failure = new CreationStorageError('corrupt', 'The saved creation is corrupt and was not overwritten.')
          transaction.abort()
          return
        }
        const matches = expectedRevision === null
          ? current === undefined
          : current !== undefined && current.revision === expectedRevision
        if (!matches) {
          conflict = true
          transaction.abort()
          return
        }
        try {
          projects.put(snapshot, snapshot.id)
          transaction.objectStore(META_STORE).put(snapshot.id, LAST_ACTIVE_KEY)
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
      read.onerror = () => { failure = read.error; transaction.abort() }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(conflict
        ? new CreationStorageError('conflict', 'A different tab changed this creation. Reload it before saving.')
        : failure instanceof CreationStorageError ? failure
          : new CreationStorageError('write-failed', failure instanceof Error ? failure.message : transaction.error?.message ?? 'The creation was not saved.'))
      transaction.onerror = () => { /* onabort reports the durable outcome */ }
    })
  }

  async activate(id: string, expectedRevision: number): Promise<void> {
    if (typeof id !== 'string' || id.length < 1 || id.length > 120 || hasControlCharacter(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new CreationStorageError('conflict', 'The creation identity or expected revision is invalid.')
    }
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([PROJECTS_STORE, META_STORE], 'readwrite')
      const read = transaction.objectStore(PROJECTS_STORE).get(id)
      let conflict = false
      let corrupt = false

      read.onsuccess = () => {
        let current: CreationProject | undefined
        try { current = read.result === undefined ? undefined : decodeProject(read.result) }
        catch {
          corrupt = true
          transaction.abort()
          return
        }
        if (current === undefined || current.revision !== expectedRevision) {
          conflict = true
          transaction.abort()
          return
        }
        transaction.objectStore(META_STORE).put(id, LAST_ACTIVE_KEY)
      }
      read.onerror = () => transaction.abort()
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(corrupt
        ? new CreationStorageError('corrupt', 'The creation to activate is corrupt.')
        : conflict
          ? new CreationStorageError('conflict', 'The creation changed or no longer exists. Refresh before opening it.')
          : new CreationStorageError('write-failed', transaction.error?.message ?? 'The active creation was not changed.'))
      transaction.onerror = () => { /* onabort reports the durable outcome */ }
    })
  }

  async list(): Promise<CreationProject[]> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PROJECTS_STORE, 'readonly')
      const request = transaction.objectStore(PROJECTS_STORE).getAll()
      let result: unknown[] | undefined
      request.onsuccess = () => { result = request.result }
      request.onerror = () => reject(unavailable(request.error, 'Creations could not be listed.'))
      transaction.oncomplete = () => {
        if (!result) return
        try { resolve(result.map(decodeProject)) }
        catch { reject(new CreationStorageError('corrupt', 'One or more saved creations are corrupt.')) }
      }
      transaction.onabort = () => reject(unavailable(transaction.error, 'The creation list read was aborted.'))
    })
  }

  close(): void {
    void this.databaseFlight?.then((database) => database.close())
    this.databaseFlight = undefined
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databaseFlight) this.databaseFlight = openDatabase(this.factory).catch((error) => {
      this.databaseFlight = undefined
      throw error
    })
    return this.databaseFlight
  }
}

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new CreationStorageError('unavailable', 'IndexedDB creation storage is unavailable.'))
  return new Promise((resolve, reject) => {
    let settled = false
    const request = factory.open(CREATION_DATABASE_NAME, CREATION_DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECTS_STORE)) request.result.createObjectStore(PROJECTS_STORE)
      if (!request.result.objectStoreNames.contains(META_STORE)) request.result.createObjectStore(META_STORE)
    }
    request.onblocked = () => {
      settled = true
      reject(new CreationStorageError('blocked', 'Another tab is blocking creation storage.'))
    }
    request.onerror = () => {
      if (!settled) reject(unavailable(request.error, 'Creation storage could not be opened.'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (settled) { database.close(); return }
      settled = true
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

function safeFactory(): IDBFactory | undefined {
  try { return globalThis.indexedDB }
  catch { return undefined }
}

function unavailable(error: DOMException | null, fallback: string): CreationStorageError {
  return new CreationStorageError('unavailable', error?.message || fallback)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
