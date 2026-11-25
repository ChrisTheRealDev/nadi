import type { CourseProgress, EmotiveProject } from './courseProgress'
import { createInitialCourseProgress, normalizeCourseProgress } from './courseProgress'
import { isValidCommandHistory, isValidProjectContent, type ProjectCommandHistory } from './projectModel'
import {
  STORAGE_KEYS,
  loadCourseProgress,
  loadFirstSoundProgress,
  loadProgress,
  loadSettings,
  type StorageLike,
} from './storage'
import type { FirstSoundProgress, SessionProgress, Settings } from '../types'
import { createInitialFirstSoundProgress, normalizeFirstSoundProgress } from './firstSound'
import { createInitialProgress } from './progress'

export const V3_DATABASE_NAME = 'nadi-project-v3'
export const V3_DATABASE_VERSION = 1
export const V3_OBJECT_STORE = 'envelopes'
export const V3_ROOT_KEY = 'root'

export type SaveState = 'loading' | 'saving' | 'saved' | 'not-saved' | 'conflict'

export interface RawTake {
  id: string
  openedAt: string
  closedAt: string
  scope: string
  durationMs: number
  endReason: 'user-stop' | 'scope-change'
  truncated: boolean
  droppedEventCount: number
  timingOrigin: {
    kind: 'free' | 'transport'
    countInBars: number
    startTick?: number
    bpm?: number
    meter?: '4/4'
    audioEpoch?: number
  }
  events: RawTakeEvent[]
}

export type RawTakeEvent =
  | { type: 'note-on'; order: number; atMs: number; channel: number; note: number; velocity: number; source: 'midi' | 'screen' | 'computer'; voiceId: string; inputId?: string }
  | { type: 'note-off'; order: number; atMs: number; channel: number; note: number; releaseVelocity: number; source: 'midi' | 'screen' | 'computer'; voiceId?: string; inputId?: string; termination: 'observed' | 'record-stop' }
  | { type: 'cc64'; order: number; atMs: number; channel: number; value: number; source: 'midi'; inputId?: string; termination?: 'record-stop' }

export interface EvidenceRecord {
  id: string
  checkpoint: string
  projectRevision: number
  capturedAt: string
  result: 'supported' | 'independent'
  supportLevel: 'none' | 'nudge' | 'cue' | 'example'
}

export interface HistoricalEvidenceRecord {
  sourceKey: string
  importedAt: string
  classification: 'historical-unverified-proxy'
  note: string
  checkpointName?: string
  checkpointSavedAt?: string
}

export interface ConnectionPrefs {
  audioConfirmed: boolean
  delay: 'unchecked' | 'comfortable' | 'noticeable'
}

export interface LegacySource {
  key: string
  raw: string | null
}

export interface LegacyImportArchive {
  algorithm: 'SHA-256'
  fingerprint: string
  importedAt: string
  sources: LegacySource[]
}

type StoredCourseState = Omit<CourseProgress, 'project' | 'history'>

export interface NadiAppSnapshot {
  session1: FirstSoundProgress
  session3: SessionProgress
  course: CourseProgress
  settings: Settings
  connections: ConnectionPrefs
  rawTakes: RawTake[]
  evidence: {
    current: EvidenceRecord[]
    historical: HistoricalEvidenceRecord[]
  }
}

export interface V3Envelope {
  schemaVersion: 3
  persistedRevision: number
  savedAt: string
  state: {
    session1: FirstSoundProgress
    session3: SessionProgress
    course: StoredCourseState
    settings: Settings
    connections: ConnectionPrefs
  }
  project: EmotiveProject
  history: ProjectCommandHistory
  rawTakes: RawTake[]
  evidence: NadiAppSnapshot['evidence']
  legacyImport: LegacyImportArchive
}

export class PersistenceError extends Error {
  constructor(public readonly code: 'unavailable' | 'blocked' | 'version-change' | 'corrupt' | 'conflict' | 'write-failed', message: string) {
    super(message)
  }
}

export class NadiProjectStore {
  private database?: IDBDatabase
  private persistedRevision = -1
  private base?: Pick<V3Envelope, 'legacyImport' | 'rawTakes' | 'evidence'>
  private writeQueue: Promise<void> = Promise.resolve()
  private frozen = false
  private hydrateFlight?: Promise<NadiAppSnapshot>
  private recoveryEnvelope?: unknown
  private recoveryLegacy?: LegacySource[]

  constructor(
    private readonly factory?: IDBFactory,
    private readonly onVersionChange?: () => void,
  ) {}

  hydrate(storage: StorageLike): Promise<NadiAppSnapshot> {
    if (!this.hydrateFlight) this.hydrateFlight = this.hydrateOnce(storage)
    return this.hydrateFlight
  }

  createUnsavedRecoverySnapshot(storage: StorageLike): NadiAppSnapshot {
    const sources = readLegacySources(storage)
    this.recoveryLegacy = sources
    return buildLegacySnapshotFromSources(sources, new Date().toISOString())
  }

  private async hydrateOnce(storage: StorageLike): Promise<NadiAppSnapshot> {
    if (!this.factory) {
      throw new PersistenceError('unavailable', 'IndexedDB project storage is unavailable in this browser.')
    }
    this.database = await openDatabase(this.factory, () => {
      this.frozen = true
      this.onVersionChange?.()
    })
    const stored = await readEnvelope(this.database)
    if (stored !== undefined) {
      this.recoveryEnvelope = stored
      let envelope: V3Envelope
      try {
        envelope = validateEnvelope(stored)
      } catch (error) {
        try { this.recoveryLegacy = readLegacySources(storage) } catch { /* denied reads remain explicitly unavailable */ }
        throw error
      }
      this.persistedRevision = envelope.persistedRevision
      this.base = { legacyImport: envelope.legacyImport, rawTakes: envelope.rawTakes, evidence: envelope.evidence }
      return snapshotFromEnvelope(envelope)
    }

    const sources = readLegacySources(storage)
    this.recoveryLegacy = sources
    const importedAt = new Date().toISOString()
    const fingerprint = await sha256(JSON.stringify(sources))
    const imported = buildLegacySnapshotFromSources(sources, importedAt)
    const legacyImport: LegacyImportArchive = { algorithm: 'SHA-256', fingerprint, importedAt, sources }
    const envelope = envelopeFromSnapshot(imported, 0, legacyImport, importedAt)
    validateEnvelope(envelope)
    await writeInitialEnvelope(this.database, envelope)
    this.persistedRevision = 0
    this.base = { legacyImport, rawTakes: [], evidence: imported.evidence }
    return imported
  }

  save(snapshot: NadiAppSnapshot): Promise<number> {
    if (this.frozen) return Promise.reject(new PersistenceError('conflict', 'Saving is frozen until the project is reloaded.'))
    const frozenSnapshot = cloneSnapshot(snapshot)
    const expectedRevision = () => this.persistedRevision
    const operation = this.writeQueue.then(async () => {
      if (this.frozen) throw new PersistenceError('conflict', 'Saving is frozen until the project is reloaded.')
      if (!this.database || !this.base) throw new PersistenceError('unavailable', 'Project storage is not hydrated.')
      const nextRevision = expectedRevision() + 1
      const envelope = envelopeFromSnapshot(frozenSnapshot, nextRevision, this.base.legacyImport, new Date().toISOString())
      validateEnvelope(envelope)
      await compareAndWriteEnvelope(this.database, expectedRevision(), envelope)
      this.persistedRevision = nextRevision
      this.base = { legacyImport: this.base.legacyImport, rawTakes: frozenSnapshot.rawTakes, evidence: frozenSnapshot.evidence }
    })
    this.writeQueue = operation.catch((error) => {
      if (error instanceof PersistenceError && error.code === 'conflict') this.frozen = true
    })
    return operation.then(() => this.persistedRevision)
  }

  async createDownloadBackup(snapshot: NadiAppSnapshot): Promise<string> {
    const frozenSnapshot = cloneSnapshot(snapshot)
    if (!this.base) return JSON.stringify({
      recoveryFormat: 'nadi-v3-recovery-bundle',
      generatedAt: new Date().toISOString(),
      lastKnownPersistedRevision: this.persistedRevision,
      savingFrozen: this.frozen,
      memorySnapshot: frozenSnapshot,
      storedEnvelope: this.recoveryEnvelope ?? null,
      legacySources: this.recoveryLegacy ?? 'unavailable',
    }, null, 2)
    return JSON.stringify(envelopeFromSnapshot(frozenSnapshot, Math.max(0, this.persistedRevision), this.base.legacyImport, new Date().toISOString()), null, 2)
  }

  close(): void {
    this.database?.close()
    this.database = undefined
  }
}

function buildLegacySnapshotFromSources(sources: LegacySource[], importedAt: string): NadiAppSnapshot {
  const capturedStorage = storageFromSources(sources)
  const snapshot: NadiAppSnapshot = {
    session1: loadFirstSoundProgress(capturedStorage),
    session3: loadProgress(capturedStorage),
    course: loadCourseProgress(capturedStorage),
    settings: loadSettings(capturedStorage),
    connections: loadConnectionPrefs(capturedStorage),
    rawTakes: [],
    evidence: { current: [], historical: [] },
  }
  snapshot.evidence.historical = extractHistoricalCheckpoints(snapshot, sources, importedAt)
  return demoteLegacyProxyProgress(snapshot, importedAt)
}

export function demoteLegacyProxyProgress(snapshot: NadiAppSnapshot, importedAt: string): NadiAppSnapshot {
  const freshCourse = createInitialCourseProgress(importedAt)
  const freshFirstSound = createInitialFirstSoundProgress(importedAt)
  return {
    ...snapshot,
    session1: {
      ...freshFirstSound,
      preset: { ...snapshot.session1.preset },
    },
    session3: createInitialProgress(importedAt),
    course: {
      ...freshCourse,
      project: snapshot.course.project,
      history: snapshot.course.history,
      updatedAt: snapshot.course.updatedAt,
    },
  }
}

export function prepareSnapshotForPersistence(snapshot: NadiAppSnapshot): NadiAppSnapshot {
  return {
    ...snapshot,
    session1: {
      ...snapshot.session1,
      midi: { connected: false },
      audioReady: false,
      practice: { ...snapshot.session1.practice, held: [] },
      check: { ...snapshot.session1.check, held: [] },
    },
  }
}

export function envelopeFromSnapshot(snapshot: NadiAppSnapshot, persistedRevision: number, legacyImport: LegacyImportArchive, savedAt: string): V3Envelope {
  const persistentSnapshot = prepareSnapshotForPersistence(snapshot)
  const { project, history, ...course } = persistentSnapshot.course
  return {
    schemaVersion: 3,
    persistedRevision,
    savedAt,
    state: { session1: persistentSnapshot.session1, session3: persistentSnapshot.session3, course, settings: persistentSnapshot.settings, connections: persistentSnapshot.connections },
    project,
    history,
    rawTakes: persistentSnapshot.rawTakes,
    evidence: persistentSnapshot.evidence,
    legacyImport,
  }
}

function snapshotFromEnvelope(envelope: V3Envelope): NadiAppSnapshot {
  return {
    session1: normalizeFirstSoundProgress(envelope.state.session1, envelope.state.session1.updatedAt),
    session3: envelope.state.session3,
    course: normalizeCourseProgress({ ...envelope.state.course, project: envelope.project, history: envelope.history }),
    settings: envelope.state.settings,
    connections: envelope.state.connections,
    rawTakes: envelope.rawTakes,
    evidence: envelope.evidence,
  }
}

export function validateEnvelope(value: unknown): V3Envelope {
  if (!isRecord(value)) throw new PersistenceError('corrupt', 'The v3 project envelope is not an object.')
  if (value.schemaVersion !== 3 || !Number.isInteger(value.persistedRevision) || Number(value.persistedRevision) < 0 || typeof value.savedAt !== 'string') {
    throw new PersistenceError('corrupt', 'The v3 project envelope header is invalid.')
  }
  if (!isRecord(value.state) || !isRecord(value.project) || !isValidProjectContent(value.project.content) || !isValidCommandHistory(value.history, value.project.content)) {
    throw new PersistenceError('corrupt', 'The v3 project graph or command history is invalid.')
  }
  if (!isRecord(value.state.course) || !isRecord(value.state.session1) || !isRecord(value.state.session3) || !isRecord(value.state.settings) || !isRecord(value.state.connections)) {
    throw new PersistenceError('corrupt', 'The v3 application state is invalid.')
  }
  if (!Array.isArray(value.rawTakes) || !isRecord(value.evidence) || !Array.isArray(value.evidence.current) || !Array.isArray(value.evidence.historical)) {
    throw new PersistenceError('corrupt', 'The v3 takes or evidence archive is invalid.')
  }
  if (!isRecord(value.legacyImport) || value.legacyImport.algorithm !== 'SHA-256' || typeof value.legacyImport.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.legacyImport.fingerprint) || !Array.isArray(value.legacyImport.sources)) {
    throw new PersistenceError('corrupt', 'The v3 legacy archive is invalid.')
  }
  const envelope = value as unknown as V3Envelope
  if (!validFirstSound(envelope.state.session1) || !validSession3(envelope.state.session3) || !validSettings(envelope.state.settings) || !validConnections(envelope.state.connections) || !validStoredCourse(envelope.state.course)) {
    throw new PersistenceError('corrupt', 'The v3 session or settings state is invalid.')
  }
  if (!envelope.rawTakes.every(validRawTake) || !envelope.evidence.current.every(validEvidence) || !envelope.evidence.historical.every(validHistoricalEvidence)) {
    throw new PersistenceError('corrupt', 'The v3 take or evidence record is invalid.')
  }
  const combinedCourse = { ...envelope.state.course, project: envelope.project, history: envelope.history }
  if (!sameJson(normalizeCourseProgress(combinedCourse, envelope.state.course.updatedAt), combinedCourse)) {
    throw new PersistenceError('corrupt', 'The v3 course state is inconsistent with its canonical project.')
  }
  const expectedKeys = Object.values(STORAGE_KEYS)
  if (envelope.legacyImport.sources.length !== expectedKeys.length ||
    envelope.legacyImport.sources.some((source, index) => !isRecord(source) || source.key !== expectedKeys[index] || (source.raw !== null && typeof source.raw !== 'string')) ||
    typeof envelope.legacyImport.importedAt !== 'string') {
    throw new PersistenceError('corrupt', 'The v3 legacy source archive is invalid.')
  }
  try {
    snapshotFromEnvelope(envelope)
  } catch {
    throw new PersistenceError('corrupt', 'The v3 application state could not be normalized safely.')
  }
  return envelope
}

async function openDatabase(factory: IDBFactory | undefined, onVersionChange: () => void): Promise<IDBDatabase> {
  if (!factory) throw new PersistenceError('unavailable', 'IndexedDB is unavailable.')
  return new Promise((resolve, reject) => {
    let settled = false
    const request = factory.open(V3_DATABASE_NAME, V3_DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort()
        return
      }
      if (!request.result.objectStoreNames.contains(V3_OBJECT_STORE)) request.result.createObjectStore(V3_OBJECT_STORE)
    }
    request.onblocked = () => { settled = true; reject(new PersistenceError('blocked', 'A different app version is blocking the storage upgrade.')) }
    request.onerror = () => { if (!settled) { settled = true; reject(new PersistenceError('unavailable', request.error?.message ?? 'IndexedDB could not be opened.')) } }
    request.onsuccess = () => {
      const database = request.result
      if (settled) { database.close(); return }
      settled = true
      database.onversionchange = () => {
        database.close()
        onVersionChange()
      }
      resolve(database)
    }
  })
}

function readEnvelope(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(V3_OBJECT_STORE, 'readonly')
    const request = transaction.objectStore(V3_OBJECT_STORE).get(V3_ROOT_KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new PersistenceError('unavailable', request.error?.message ?? 'Project read failed.'))
    transaction.onabort = () => reject(new PersistenceError('unavailable', transaction.error?.message ?? 'Project read aborted.'))
  })
}

function writeInitialEnvelope(database: IDBDatabase, envelope: V3Envelope): Promise<void> {
  return new Promise((resolve, reject) => {
    let conflict = false
    let writeError: unknown
    const transaction = database.transaction(V3_OBJECT_STORE, 'readwrite')
    const store = transaction.objectStore(V3_OBJECT_STORE)
    const read = store.get(V3_ROOT_KEY)
    read.onsuccess = () => {
      if (read.result !== undefined) {
        conflict = true
        transaction.abort()
        return
      }
      try {
        store.put(envelope, V3_ROOT_KEY)
      } catch (error) {
        writeError = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new PersistenceError(conflict ? 'conflict' : 'write-failed', conflict ? 'Another tab created the v3 project first.' : writeError instanceof Error ? `Initial project import failed: ${writeError.message}` : 'Initial project import failed.'))
    transaction.onerror = () => { /* onabort reports the durable failure */ }
  })
}

function compareAndWriteEnvelope(database: IDBDatabase, expectedRevision: number, envelope: V3Envelope): Promise<void> {
  return new Promise((resolve, reject) => {
    let conflict = false
    let writeError: unknown
    const transaction = database.transaction(V3_OBJECT_STORE, 'readwrite')
    const store = transaction.objectStore(V3_OBJECT_STORE)
    const read = store.get(V3_ROOT_KEY)
    read.onsuccess = () => {
      const current = read.result
      if (!isRecord(current) || current.persistedRevision !== expectedRevision) {
        conflict = true
        transaction.abort()
        return
      }
      try {
        store.put(envelope, V3_ROOT_KEY)
      } catch (error) {
        writeError = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new PersistenceError(conflict ? 'conflict' : 'write-failed', conflict ? 'A newer writer saved this project. Reload before saving again.' : writeError instanceof Error ? `The project could not be written: ${writeError.message}` : transaction.error?.message ?? 'The project transaction did not complete.'))
    transaction.onerror = () => { /* onabort reports the durable failure */ }
  })
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new PersistenceError('unavailable', 'SHA-256 is unavailable for the legacy import archive.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readLegacySources(storage: StorageLike): LegacySource[] {
  return Object.values(STORAGE_KEYS).map((key) => {
    try { return { key, raw: storage.getItem(key) } }
    catch { throw new PersistenceError('unavailable', `Legacy source ${key} could not be read safely.`) }
  })
}

function storageFromSources(sources: LegacySource[]): StorageLike {
  const values = new Map(sources.map((source) => [source.key, source.raw]))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: () => { throw new Error('Captured legacy storage is read-only.') },
    removeItem: () => { throw new Error('Captured legacy storage is read-only.') },
  }
}

function cloneSnapshot(snapshot: NadiAppSnapshot): NadiAppSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as NadiAppSnapshot
}

function validRawTake(value: unknown): boolean {
  if (!isRecord(value) || !/^[A-Za-z0-9._:-]{1,96}$/.test(String(value.id)) || typeof value.openedAt !== 'string' || typeof value.closedAt !== 'string' || typeof value.scope !== 'string' || value.scope.length < 1 || value.scope.length > 120) return false
  if (!finiteInRange(value.durationMs, 0, 14_400_000) || !['user-stop', 'scope-change'].includes(String(value.endReason)) || typeof value.truncated !== 'boolean' || !integerInRange(value.droppedEventCount, 0, 1_000_000_000)) return false
  if (value.truncated !== (Number(value.droppedEventCount) > 0) || !validRawTimingOrigin(value.timingOrigin) || !Array.isArray(value.events) || value.events.length > 10_000) return false
  return value.events.every((event, index) => validRawTakeEvent(event, index, Number(value.durationMs)))
}

function validRawTimingOrigin(value: unknown): boolean {
  if (!isRecord(value) || !['free', 'transport'].includes(String(value.kind)) || !integerInRange(value.countInBars, 0, 8)) return false
  if (value.kind === 'free') return value.startTick === undefined && value.bpm === undefined && value.meter === undefined && value.audioEpoch === undefined
  return integerInRange(value.startTick, 0, 15_360) && finiteInRange(value.bpm, 30, 300) && value.meter === '4/4' && integerInRange(value.audioEpoch, 0, Number.MAX_SAFE_INTEGER)
}

function validRawTakeEvent(value: unknown, expectedOrder: number, durationMs: number): boolean {
  if (!isRecord(value) || value.order !== expectedOrder || !finiteInRange(value.atMs, 0, durationMs) || !integerInRange(value.channel, 0, 15)) return false
  if (value.inputId !== undefined && (typeof value.inputId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.inputId))) return false
  if (value.type === 'note-on') {
    return integerInRange(value.note, 0, 127) && integerInRange(value.velocity, 1, 127) && ['midi', 'screen', 'computer'].includes(String(value.source)) && typeof value.voiceId === 'string' && /^voice-[1-9][0-9]{0,8}$/.test(value.voiceId)
  }
  if (value.type === 'note-off') {
    return integerInRange(value.note, 0, 127) && integerInRange(value.releaseVelocity, 0, 127) && ['midi', 'screen', 'computer'].includes(String(value.source)) &&
      (value.voiceId === undefined || (typeof value.voiceId === 'string' && /^voice-[1-9][0-9]{0,8}$/.test(value.voiceId))) && ['observed', 'record-stop'].includes(String(value.termination))
  }
  if (value.type === 'cc64') {
    return integerInRange(value.value, 0, 127) && value.source === 'midi' && (value.termination === undefined || value.termination === 'record-stop')
  }
  return false
}

function finiteInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function integerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function validEvidence(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.checkpoint !== 'string' || !Number.isInteger(value.projectRevision) || Number(value.projectRevision) < 0 || typeof value.capturedAt !== 'string') return false
  if (!['supported', 'independent'].includes(String(value.result)) || !['none', 'nudge', 'cue', 'example'].includes(String(value.supportLevel))) return false
  return value.result !== 'independent' || value.supportLevel === 'none'
}

function validHistoricalEvidence(value: unknown): boolean {
  return isRecord(value) && typeof value.sourceKey === 'string' && typeof value.importedAt === 'string' && value.classification === 'historical-unverified-proxy' && typeof value.note === 'string' &&
    (value.checkpointName === undefined || typeof value.checkpointName === 'string') && (value.checkpointSavedAt === undefined || typeof value.checkpointSavedAt === 'string')
}

export function extractHistoricalCheckpoints(snapshot: NadiAppSnapshot, sources: LegacySource[], importedAt: string): HistoricalEvidenceRecord[] {
  const records: HistoricalEvidenceRecord[] = []
  const seen = new Set<string>()
  const add = (sourceKey: string, checkpoint: unknown) => {
    if (!isRecord(checkpoint) || typeof checkpoint.name !== 'string' || typeof checkpoint.savedAt !== 'string' || checkpoint.name.length < 1 || checkpoint.name.length > 120 || checkpoint.savedAt.length < 1 || checkpoint.savedAt.length > 120) return
    const identity = `${sourceKey}\u0000${checkpoint.name}\u0000${checkpoint.savedAt}`
    if (seen.has(identity)) return
    seen.add(identity)
    records.push({ sourceKey, importedAt, classification: 'historical-unverified-proxy', checkpointName: checkpoint.name, checkpointSavedAt: checkpoint.savedAt, note: 'Earlier checkpoint retained as history; it is not promoted to fresh independent evidence.' })
  }
  add(STORAGE_KEYS.firstSound, snapshot.session1.checkpoint)
  add(STORAGE_KEYS.progress, snapshot.session3.checkpoint)
  Object.values(snapshot.course.sessions).forEach((record) => add(STORAGE_KEYS.course, record.checkpoint))
  for (const source of sources) {
    if (source.raw === null) continue
    let parsed: unknown
    try { parsed = JSON.parse(source.raw) } catch { continue }
    if (!isRecord(parsed)) continue
    if (source.key === STORAGE_KEYS.firstSound || source.key === STORAGE_KEYS.progress) {
      add(source.key, parsed.checkpoint)
    }
    if ((source.key === STORAGE_KEYS.course || source.key === STORAGE_KEYS.legacyCourse) && isRecord(parsed.sessions)) {
      for (const id of ['2', '4', '5', '6', '7', '8']) {
        const session = parsed.sessions[id]
        if (isRecord(session)) add(source.key, session.checkpoint)
      }
    }
  }
  if (!records.length && sources.some((source) => source.raw !== null)) {
    records.push({ sourceKey: 'legacy-archive', importedAt, classification: 'historical-unverified-proxy', note: 'Earlier local progress bytes retained; no current independent evidence was created.' })
  }
  return records
}

function validFirstSound(value: unknown): value is FirstSoundProgress {
  if (!isRecord(value) || value.version !== 1 || !['welcome', 'connect', 'practice', 'choose', 'check', 'evidence'].includes(String(value.stage)) || typeof value.updatedAt !== 'string' || typeof value.audioReady !== 'boolean') return false
  if (!isRecord(value.midi) || typeof value.midi.connected !== 'boolean' || (value.midi.deviceName !== undefined && typeof value.midi.deviceName !== 'string')) return false
  if (!isRecord(value.preset) || typeof value.preset.heardWarm !== 'boolean' || typeof value.preset.heardClear !== 'boolean' || (value.preset.choice !== undefined && !['warm', 'clear'].includes(String(value.preset.choice)))) return false
  return validInputEvidence(value.practice) && validInputEvidence(value.check)
}

function validInputEvidence(value: unknown): boolean {
  return isRecord(value) && ['noteOns', 'noteOffs', 'completedCycles', 'midiCycles', 'fallbackCycles', 'audioSignals'].every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0) &&
    Array.isArray(value.held) && value.held.every((held) => isRecord(held) && Number.isInteger(held.note) && ['screen', 'computer', 'midi'].includes(String(held.source)))
}

function validSession3(value: unknown): value is SessionProgress {
  if (!isRecord(value) || value.version !== 1 || !['welcome', 'recall', 'explore', 'learn', 'practice', 'apply', 'check', 'evidence'].includes(String(value.stage)) || typeof value.updatedAt !== 'string' || !isRecord(value.evidence)) return false
  const evidence = value.evidence
  return isRecord(evidence.recall) && Number.isInteger(evidence.recall.taps) &&
    isRecord(evidence.explore) && typeof evidence.explore.heardMinor === 'boolean' && typeof evidence.explore.heardMajor === 'boolean' &&
    isRecord(evidence.learn) && typeof evidence.learn.heardSeparate === 'boolean' && typeof evidence.learn.heardTogether === 'boolean' &&
    validChordCapture(evidence.practice, true) && validChordCapture(evidence.check, true) &&
    isRecord(evidence.apply) && Array.isArray(evidence.apply.notes) && evidence.apply.notes.every(Number.isInteger) && Number.isInteger(evidence.apply.editEvents) && typeof evidence.apply.playedBack === 'boolean'
}

function validChordCapture(value: unknown, hints: boolean): boolean {
  return isRecord(value) && Array.isArray(value.notes) && value.notes.every(Number.isInteger) && Number.isInteger(value.inputEvents) && (!hints || Number.isInteger(value.hintsUsed))
}

function validSettings(value: unknown): value is Settings {
  return isRecord(value) && value.version === 1 && ['midnight', 'daylight'].includes(String(value.theme)) && ['compact', 'comfortable', 'large'].includes(String(value.textSize)) &&
    ['reduceMotion', 'showNoteNames', 'highContrast', 'breakReminders', 'countIn', 'showEstimates'].every((key) => typeof value[key] === 'boolean')
}

function loadConnectionPrefs(storage: StorageLike): ConnectionPrefs {
  try {
    const raw = storage.getItem(STORAGE_KEYS.connections)
    if (!raw) return { audioConfirmed: false, delay: 'unchecked' }
    const parsed: unknown = JSON.parse(raw)
    return validConnections(parsed) ? parsed : { audioConfirmed: false, delay: 'unchecked' }
  } catch {
    return { audioConfirmed: false, delay: 'unchecked' }
  }
}

function validConnections(value: unknown): value is ConnectionPrefs {
  return isRecord(value) && typeof value.audioConfirmed === 'boolean' && ['unchecked', 'comfortable', 'noticeable'].includes(String(value.delay))
}

function validStoredCourse(value: unknown): value is StoredCourseState {
  if (!isRecord(value) || value.version !== 2 || typeof value.updatedAt !== 'string' || !isRecord(value.sessions)) return false
  const sessions = value.sessions
  return ['2', '4', '5', '6', '7', '8'].every((id) => {
    const record = sessions[id]
    return isRecord(record) && ['welcome', 'learn', 'make', 'check', 'evidence'].includes(String(record.stage)) &&
      Array.isArray(record.learned) && record.learned.every((item) => typeof item === 'string') &&
      Array.isArray(record.made) && record.made.every((item) => typeof item === 'string') &&
      Array.isArray(record.checked) && record.checked.every((item) => typeof item === 'string') && isRecord(record.values) &&
      Object.values(record.values).every((item) => ['string', 'number', 'boolean'].includes(typeof item) || (Array.isArray(item) && item.every((entry) => typeof entry === 'string' || typeof entry === 'number'))) &&
      (record.checkpoint === undefined || (isRecord(record.checkpoint) && typeof record.checkpoint.name === 'string' && typeof record.checkpoint.savedAt === 'string'))
  })
}

function sameJson(first: unknown, second: unknown): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value)
    ? value.map(stable)
    : isRecord(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
      : value
  return JSON.stringify(stable(first)) === JSON.stringify(stable(second))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
