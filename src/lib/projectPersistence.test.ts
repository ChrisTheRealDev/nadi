import { describe, expect, it } from 'vitest'
import { createInitialFirstSoundProgress, firstSoundReducer } from './firstSound'
import { createInitialCourseProgress } from './courseProgress'
import { createInitialProgress, defaultSettings } from './progress'
import { STORAGE_KEYS } from './storage'
import {
  PersistenceError,
  NadiProjectStore,
  demoteLegacyProxyProgress,
  extractHistoricalCheckpoints,
  prepareSnapshotForPersistence,
  envelopeFromSnapshot,
  validateEnvelope,
  type LegacyImportArchive,
  type NadiAppSnapshot,
} from './projectPersistence'

function fixture() {
  const snapshot: NadiAppSnapshot = {
    session1: createInitialFirstSoundProgress('now'),
    session3: createInitialProgress('now'),
    course: createInitialCourseProgress('now'),
    settings: defaultSettings,
    connections: { audioConfirmed: false, delay: 'unchecked' },
    rawTakes: [],
    evidence: { current: [], historical: [] },
  }
  const legacyImport: LegacyImportArchive = {
    algorithm: 'SHA-256', fingerprint: 'a'.repeat(64), importedAt: 'now',
    sources: Object.values(STORAGE_KEYS).map((key) => ({ key, raw: null })),
  }
  return envelopeFromSnapshot(snapshot, 0, legacyImport, 'now')
}

describe('v3 envelope validation', () => {
  it('accepts a complete atomic envelope including safe transient audio state', () => {
    const envelope = fixture()
    envelope.state.session1.audioReady = true
    envelope.state.session1.practice.held = [{ note: 60, source: 'midi' }]
    expect(validateEnvelope(envelope)).toBe(envelope)
  })

  it('rejects corrupt nested state instead of normalizing defaults', () => {
    const envelope = fixture()
    envelope.state.session1 = {} as never
    expect(() => validateEnvelope(envelope)).toThrow(PersistenceError)
  })

  it('rejects independent evidence that used help in the current attempt', () => {
    const envelope = fixture()
    envelope.evidence.current.push({ id: 'e1', checkpoint: 'fresh-check', projectRevision: 0, capturedAt: 'now', result: 'independent', supportLevel: 'example' })
    expect(() => validateEnvelope(envelope)).toThrow(PersistenceError)
  })

  it('rejects a corrupt graph or incoherent history before a write', () => {
    const envelope = fixture()
    envelope.project.content.patterns.bad = { id: 'bad', channelId: 'channel-melody', name: 'bad', lengthTicks: 480, notes: [{ id: 'same', channelId: 'channel-melody', pitch: 69, startTick: 0, durationTicks: 240, velocity: 72, source: 'draw' }, { id: 'same', channelId: 'channel-melody', pitch: 72, startTick: 240, durationTicks: 240, velocity: 72, source: 'draw' }] }
    expect(() => validateEnvelope(envelope)).toThrow(PersistenceError)
  })

  it('validates ordered finite raw-take timing and explicit truncation metadata', () => {
    const envelope = fixture()
    envelope.rawTakes.push({
      id: 'take-1', openedAt: 'open', closedAt: 'closed', scope: 'session-6-bar-1', durationMs: 800,
      endReason: 'user-stop', truncated: false, droppedEventCount: 0,
      timingOrigin: { kind: 'transport', countInBars: 1, startTick: 0, bpm: 90, meter: '4/4', audioEpoch: 2 },
      events: [
        { type: 'note-on', order: 0, atMs: 100, channel: 2, note: 69, velocity: 92, source: 'midi', voiceId: 'voice-1' },
        { type: 'note-off', order: 1, atMs: 800, channel: 2, note: 69, releaseVelocity: 0, source: 'midi', voiceId: 'voice-1', termination: 'record-stop' },
      ],
    })
    expect(validateEnvelope(envelope)).toBe(envelope)
    envelope.rawTakes[0].events[1].atMs = Number.NaN
    expect(() => validateEnvelope(envelope)).toThrow(PersistenceError)
  })
})

describe('v3 storage availability', () => {
  it('fails closed without reading a browser global when no IndexedDB factory is supplied', async () => {
    const store = new NadiProjectStore()
    await expect(store.hydrate({
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('demotes readable legacy proxy mastery in the unsaved recovery path', () => {
    const legacy = JSON.stringify({ version: 2, sessions: { 6: { stage: 'evidence', learned: ['heard-motifs'], made: ['made-phrase'], checked: ['explained'], checkpoint: { name: 'legacy-session-6', savedAt: 'old' } } } })
    const storage = {
      getItem: (key: string) => key === STORAGE_KEYS.course ? legacy : null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    const recovered = new NadiProjectStore().createUnsavedRecoverySnapshot(storage)

    expect(recovered.course.sessions['6'].stage).toBe('welcome')
    expect(recovered.course.sessions['6'].checkpoint).toBeUndefined()
    expect(recovered.evidence.historical).toContainEqual(expect.objectContaining({ checkpointName: 'legacy-session-6', classification: 'historical-unverified-proxy' }))
  })
})

describe('persistence snapshots', () => {
  it('clears engine-only audio and held-note transients without changing observed work', () => {
    const envelope = fixture()
    const snapshot: NadiAppSnapshot = {
      session1: envelope.state.session1,
      session3: envelope.state.session3,
      course: { ...envelope.state.course, project: envelope.project, history: envelope.history },
      settings: envelope.state.settings,
      connections: envelope.state.connections,
      rawTakes: [],
      evidence: { current: [], historical: [] },
    }
    snapshot.session1.audioReady = true
    snapshot.session1.practice.noteOns = 2
    snapshot.session1.practice.held = [{ note: 60, source: 'midi' }]

    const persistent = prepareSnapshotForPersistence(snapshot)

    expect(persistent.session1.audioReady).toBe(false)
    expect(persistent.session1.practice.held).toEqual([])
    expect(persistent.session1.practice.noteOns).toBe(2)
    expect(snapshot.session1.practice.held).toHaveLength(1)
  })

  it('produces the same durable snapshot after transient audio and MIDI status changes', () => {
    const envelope = fixture()
    const snapshot: NadiAppSnapshot = {
      session1: envelope.state.session1,
      session3: envelope.state.session3,
      course: { ...envelope.state.course, project: envelope.project, history: envelope.history },
      settings: envelope.state.settings,
      connections: envelope.state.connections,
      rawTakes: [],
      evidence: { current: [], historical: [] },
    }
    const before = JSON.stringify(prepareSnapshotForPersistence(snapshot))
    const audioReady = firstSoundReducer(snapshot.session1, { type: 'AUDIO_READY', ready: true })
    const connected = firstSoundReducer(audioReady, { type: 'MIDI_STATUS', connected: true, deviceName: 'Transient keyboard' })

    expect(JSON.stringify(prepareSnapshotForPersistence({ ...snapshot, session1: connected }))).toBe(before)
  })
})

describe('legacy evidence import', () => {
  it('keeps music and preferences but demotes proxy checkpoints to historical-only state', () => {
    const envelope = fixture()
    const snapshot: NadiAppSnapshot = {
      session1: envelope.state.session1,
      session3: envelope.state.session3,
      course: { ...envelope.state.course, project: envelope.project, history: envelope.history },
      settings: envelope.state.settings,
      connections: envelope.state.connections,
      rawTakes: [],
      evidence: { current: [], historical: [{ sourceKey: STORAGE_KEYS.course, importedAt: 'imported', classification: 'historical-unverified-proxy', checkpointName: 'beat-and-bar-complete', checkpointSavedAt: 'legacy', note: 'retained' }] },
    }
    snapshot.course.sessions['2'] = { stage: 'evidence', learned: ['heard-accent'], made: ['tapped-pulse'], checked: ['counted-bar'], values: { legacyVelocityEditedSlots: ['0:0'] }, checkpoint: { name: 'beat-and-bar-complete', savedAt: 'legacy' } }
    snapshot.session1.checkpoint = { name: 'first-signal-complete', savedAt: 'legacy' }
    snapshot.session3.checkpoint = { name: 'harmony-a-complete', savedAt: 'legacy' }
    const originalContent = structuredClone(snapshot.course.project.content)

    const imported = demoteLegacyProxyProgress(snapshot, 'imported')

    expect(imported.course.project.content).toEqual(originalContent)
    expect(imported.course.sessions['2'].stage).toBe('welcome')
    expect(imported.course.sessions['2'].checkpoint).toBeUndefined()
    expect(imported.session1.checkpoint).toBeUndefined()
    expect(imported.session3.checkpoint).toBeUndefined()
    expect(imported.evidence.historical[0].checkpointName).toBe('beat-and-bar-complete')
  })

  it('retains an original checkpoint name and date even when current normalization rejects it', () => {
    const envelope = fixture()
    const snapshot: NadiAppSnapshot = {
      session1: envelope.state.session1,
      session3: envelope.state.session3,
      course: { ...envelope.state.course, project: envelope.project, history: envelope.history },
      settings: envelope.state.settings,
      connections: envelope.state.connections,
      rawTakes: [],
      evidence: { current: [], historical: [] },
    }
    const raw = JSON.stringify({ version: 2, sessions: { 7: { stage: 'evidence', checkpoint: { name: 'eight-bar-builder-complete', savedAt: 'old-date' } } } })
    const sources = Object.values(STORAGE_KEYS).map((key) => ({ key, raw: key === STORAGE_KEYS.course ? raw : null }))

    const records = extractHistoricalCheckpoints(snapshot, sources, 'imported')

    expect(records).toContainEqual(expect.objectContaining({ sourceKey: STORAGE_KEYS.course, checkpointName: 'eight-bar-builder-complete', checkpointSavedAt: 'old-date', classification: 'historical-unverified-proxy' }))
    expect(sources.find((source) => source.key === STORAGE_KEYS.course)?.raw).toBe(raw)
  })
})
