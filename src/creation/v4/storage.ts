import { decodeStudioProject, validateStudioProject, type StudioProject } from './model'

export const CREATION_DATABASE_NAME = 'nadi-creation-v1'
export const CREATION_DATABASE_VERSION = 1

const PROJECTS_STORE = 'projects'
const META_STORE = 'meta'
const LAST_ACTIVE_KEY = 'last-active-project-id'

export interface StudioEntries {
  healthy: StudioProject[]
  invalid: { key: IDBValidKey; raw: unknown; message: string }[]
}

export class CreationStorageError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'blocked' | 'conflict' | 'corrupt' | 'write-failed',
    message: string,
  ) {
    super(message)
    this.name = 'CreationStorageError'
  }
}

export class StudioStore {
  private databaseFlight?: Promise<IDBDatabase>

  constructor(private readonly factory: IDBFactory | undefined = safeFactory(), private readonly options: { databaseName?: string; onSaved?: (meta: IDBObjectStore, project: StudioProject) => void } = {}) {}

  async load(): Promise<StudioProject | undefined> {
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
          try { resolve(decodeStoredProject(result, metaRequest.result)) }
          catch { reject(new CreationStorageError('corrupt', 'The active creation is corrupt.')) }
        }
      }
      transaction.onabort = () => reject(failure ?? unavailable(transaction.error, 'The creation read was aborted.'))
    })
  }

  async save(project: StudioProject, expectedRevision: number | null, preUpgradeRaw?: unknown): Promise<void> {
    if (!validateStudioProject(project)) throw new CreationStorageError('corrupt', 'The creation is invalid and was not saved.')
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new CreationStorageError('conflict', 'The expected revision is invalid.')
    }
    const expectedNextRevision = expectedRevision === null ? 0 : expectedRevision + 1
    if (project.revision !== expectedNextRevision) {
      throw new CreationStorageError('conflict', `The creation revision must be ${expectedNextRevision} for this save.`)
    }
    const snapshot = structuredClone(project)
    // Imported old archives have no prior durable record. Preserve their validated
    // source alongside the first new save, not inside the strict musical schema.
    let importedRecovery: unknown
    if (preUpgradeRaw !== undefined) {
      if (expectedRevision !== null || !isPreV5(preUpgradeRaw)) throw new CreationStorageError('corrupt', 'An upgrade recovery source is only valid for a new imported project.')
      try { decodeStudioProject(preUpgradeRaw); importedRecovery = structuredClone(preUpgradeRaw) }
      catch { throw new CreationStorageError('corrupt', 'The upgrade recovery source is invalid. Nothing was saved.') }
    }
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([PROJECTS_STORE, META_STORE], 'readwrite')
      const projects = transaction.objectStore(PROJECTS_STORE)
      const read = projects.get(snapshot.id)
      let conflict = false
      let failure: unknown

      read.onsuccess = () => {
        let current: StudioProject | undefined
        try { current = read.result === undefined ? undefined : decodeStoredProject(read.result, snapshot.id) }
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
          // Upgrade and original recovery copy commit atomically after the same
          // optimistic-revision check. A failed backup aborts the whole save.
          const raw = read.result ?? importedRecovery
          if (raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' && raw.version < snapshot.version) {
            const meta = transaction.objectStore(META_STORE)
            const versions = [4, 5, 6].filter(version => version > raw.version && version <= snapshot.version)
            for (const version of versions) {
              const backupKey = `pre-v${version}:${snapshot.id}`
              const backup = meta.get(backupKey)
              backup.onsuccess = () => {
                try { if (backup.result === undefined) meta.put(structuredClone(raw), backupKey) }
                catch (error) { failure = error; transaction.abort() }
              }
              backup.onerror = () => { failure = backup.error; transaction.abort() }
            }
          }
          projects.put(snapshot, snapshot.id)
          transaction.objectStore(META_STORE).put(snapshot.id, LAST_ACTIVE_KEY)
          this.options.onSaved?.(transaction.objectStore(META_STORE), snapshot)
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
        let current: StudioProject | undefined
        try { current = read.result === undefined ? undefined : decodeStoredProject(read.result, id) }
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

  async list(): Promise<StudioProject[]> {
    return (await this.listEntries()).healthy
  }

  /** Corrupt siblings are isolated, retained verbatim and never automatically deleted. */
  async listEntries(): Promise<StudioEntries> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PROJECTS_STORE, 'readonly')
      const store = transaction.objectStore(PROJECTS_STORE)
      const request = store.getAll(), keysRequest = store.getAllKeys()
      let result: unknown[] | undefined
      let keys: IDBValidKey[] | undefined
      request.onsuccess = () => { result = request.result }
      keysRequest.onsuccess = () => { keys = keysRequest.result }
      request.onerror = () => reject(unavailable(request.error, 'Creations could not be listed.'))
      keysRequest.onerror = () => reject(unavailable(keysRequest.error, 'Creation identities could not be listed.'))
      transaction.oncomplete = () => {
        if (!result || !keys || result.length !== keys.length) { reject(new CreationStorageError('corrupt', 'Creation entries could not be read consistently.')); return }
        const entryKeys = keys
        const entries: StudioEntries = { healthy: [], invalid: [] }
        result.forEach((raw, index) => {
          try {
            const project = decodeStoredProject(raw, entryKeys[index])
            entries.healthy.push(project)
          } catch (error) {
            entries.invalid.push({ key: entryKeys[index], raw: structuredClone(raw), message: error instanceof Error ? error.message : 'This saved entry is invalid.' })
          }
        })
        resolve(entries)
      }
      transaction.onabort = () => reject(unavailable(transaction.error, 'The creation list read was aborted.'))
    })
  }

  async recoveryCopy(id: string, targetVersion: 4 | 5 | 6 = 6): Promise<unknown | undefined> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const tx = database.transaction(META_STORE, 'readonly')
      const meta = tx.objectStore(META_STORE)
      const request = meta.get(`pre-v${targetVersion}:${id}`)
      let result: unknown
      request.onsuccess = () => {
        result = request.result
        if (result === undefined && targetVersion >= 5) {
          const older = meta.get(`pre-v${targetVersion - 1}:${id}`)
          older.onsuccess = () => {
            result = older.result
            if (result === undefined && targetVersion === 6) {
              const oldest = meta.get(`pre-v4:${id}`)
              oldest.onsuccess = () => { result = oldest.result }
            }
          }
        }
      }
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(unavailable(tx.error, 'Recovery copy could not be read.'))
    })
  }

  close(): void {
    void this.databaseFlight?.then((database) => database.close())
    this.databaseFlight = undefined
  }

  protected open(): Promise<IDBDatabase> {
    if (!this.databaseFlight) this.databaseFlight = openDatabase(this.factory, this.options.databaseName).catch((error) => {
      this.databaseFlight = undefined
      throw error
    })
    return this.databaseFlight
  }
}

function decodeStoredProject(raw: unknown, key: IDBValidKey): StudioProject {
  const project = decodeStudioProject(raw)
  if (project.id !== key) throw new Error('Saved identity does not match its storage key.')
  return project
}

function isPreV5(value: unknown): value is { version: number } {
  return value !== null && typeof value === 'object' && 'version' in value && typeof value.version === 'number' && [1, 2, 3, 4].includes(value.version)
}

function openDatabase(factory: IDBFactory | undefined, databaseName = CREATION_DATABASE_NAME): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new CreationStorageError('unavailable', 'IndexedDB creation storage is unavailable.'))
  return new Promise((resolve, reject) => {
    let settled = false
    const request = factory.open(databaseName, CREATION_DATABASE_VERSION)
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
