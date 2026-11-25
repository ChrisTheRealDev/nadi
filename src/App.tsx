import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { computerKeyMap } from './data'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useMidi } from './hooks/useMidi'
import {
  createInitialFirstSoundProgress,
  firstSoundReducer,
} from './lib/firstSound'
import { createInitialProgress, defaultSettings, progressReducer } from './lib/progress'
import { courseReducer, createInitialCourseProgress, type CourseAction, type CourseProgress } from './lib/courseProgress'
import {
  NadiProjectStore,
  PersistenceError,
  prepareSnapshotForPersistence,
  type NadiAppSnapshot,
  type SaveState,
  type ConnectionPrefs,
} from './lib/projectPersistence'
import { NavigationShell, type NavigationPage } from './pages/NavigationPages'
import { FirstSoundPage } from './pages/FirstSoundPage'
import { StudioPage } from './pages/StudioPage'
import { GuidedSessionPage } from './pages/GuidedSessionPage'
import type {
  FirstSoundProgress,
  GuidedSessionId,
  InputSource,
  Page,
  SessionProgress,
  Settings,
} from './types'
import { RawTakeRecorder } from './lib/rawTakeRecorder'
import { renderProjectToWav, type FrozenWavExport } from './lib/offlineProjectRender'
import { createFrozenProjectJson, createFrozenProjectMidi, MIDI_EXPORT_LIMITATION, type FrozenDownload } from './lib/projectExport'

function pageFromLocation(): Page {
  const candidate = window.location.hash.replace('#', '')
  const pages: Page[] = [
    'home',
    'paths',
    'projects',
    'notebook',
    'connections',
    'settings',
    'first-sound',
    'studio',
  ]
  if (candidate === 'studio-1') return 'first-sound'
  if (candidate === 'studio-3') return 'studio'
  if (/^session-(2|4|5|6|7|8)$/.test(candidate)) return candidate as Page
  return pages.includes(candidate as Page) ? (candidate as Page) : 'home'
}

export default function App() {
  const [versionChanged, setVersionChanged] = useState(false)
  const [store] = useState(() => {
    let browserDatabase: IDBFactory | undefined
    try {
      browserDatabase = window.indexedDB
    } catch {
      browserDatabase = undefined
    }
    return new NadiProjectStore(browserDatabase, () => setVersionChanged(true))
  })
  const [boot, setBoot] = useState<{ snapshot?: NadiAppSnapshot; error?: string }>({})

  useEffect(() => {
    let active = true
    let browserStorage: Storage
    try {
      browserStorage = window.localStorage
    } catch {
      browserStorage = {
        length: 0,
        clear: () => { throw new Error('Browser storage is unavailable.') },
        getItem: () => { throw new Error('Browser storage is unavailable.') },
        key: () => null,
        removeItem: () => { throw new Error('Browser storage is unavailable.') },
        setItem: () => { throw new Error('Browser storage is unavailable.') },
      }
    }
    void store.hydrate(browserStorage).then(
      (snapshot) => { if (active) setBoot({ snapshot }) },
      (error: unknown) => {
        if (!active) return
        let recovery: NadiAppSnapshot
        try {
          recovery = store.createUnsavedRecoverySnapshot(browserStorage)
        } catch {
          const recoveredAt = new Date().toISOString()
          recovery = {
            session1: createInitialFirstSoundProgress(recoveredAt),
            session3: createInitialProgress(recoveredAt),
            course: createInitialCourseProgress(recoveredAt),
            settings: defaultSettings,
            connections: { audioConfirmed: false, delay: 'unchecked' },
            rawTakes: [],
            evidence: { current: [], historical: [] },
          }
        }
        setBoot({
          snapshot: recovery,
          error: error instanceof Error ? error.message : 'Project storage could not be opened.',
        })
      },
    )
    return () => { active = false }
  }, [store])

  if (!boot.snapshot) {
    return <main className="storage-loading" aria-live="polite"><strong>Opening your NADI project…</strong><span>Legacy saves remain untouched while the v3 project is checked.</span></main>
  }
  return <WorkspaceApp initial={boot.snapshot} store={store} initialError={versionChanged ? 'A newer app version opened this project. Reload before saving.' : boot.error} />
}

function WorkspaceApp({ initial, store, initialError }: { initial: NadiAppSnapshot; store: NadiProjectStore; initialError?: string }) {
  const [page, setPage] = useState<Page>(pageFromLocation)
  const [progress, dispatch] = useReducer(
    progressReducer,
    initial.session3,
  )
  const [firstSound, dispatchFirstSound] = useReducer(
    firstSoundReducer,
    initial.session1,
  )
  const [course, dispatchCourse] = useReducer(
    courseReducer,
    initial.course,
  )
  const [settings, setSettings] = useState<Settings>(initial.settings)
  const [connections, setConnections] = useState<ConnectionPrefs>(initial.connections)
  const [rawTakes, setRawTakes] = useState(initial.rawTakes)
  const [recordingScope, setRecordingScope] = useState<string>()
  const [wavExportState, setWavExportState] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [latestWavExport, setLatestWavExport] = useState<FrozenWavExport>()
  const [wavExportMessage, setWavExportMessage] = useState('')
  const [fileExportMessage, setFileExportMessage] = useState('')
  const [saveState, setSaveState] = useState<SaveState>(initialError ? 'not-saved' : 'saved')
  const [saveMessage, setSaveMessage] = useState(initialError ?? 'Project saved on this device.')
  const lastQueuedSnapshot = useRef(JSON.stringify(prepareSnapshotForPersistence(initial)))
  const saveSequence = useRef(0)
  const [activeNotes, setActiveNotes] = useState<number[]>([])
  const [activeDemo, setActiveDemo] = useState<
    'emotive' | 'guitar' | 'cinematic' | 'electronic' | undefined
  >()
  const progressRef = useRef<SessionProgress>(progress)
  const firstSoundRef = useRef<FirstSoundProgress>(firstSound)
  const courseRef = useRef<CourseProgress>(course)
  const pageRef = useRef<Page>(page)
  const heldComputerKeys = useRef(new Map<string, number>())
  const demoTimerRef = useRef<number | undefined>(undefined)
  const rawTakeRecorder = useRef(new RawTakeRecorder())
  const audio = useAudioEngine()

  const dispatchCourseSafely = useCallback((action: CourseAction) => {
    if (['SET_CHORD', 'ADD_MELODY_NOTE', 'REMOVE_MELODY_NOTE', 'SET_MELODY_PITCH', 'SET_MELODY_TIMING', 'DUPLICATE_MELODY', 'MAKE_UNIQUE_CLIP', 'SET_EVENT_VELOCITY', 'SET_MIX', 'UNDO_PROJECT', 'REDO_PROJECT', 'RESET_SESSION'].includes(action.type)) {
      audio.stopAll()
    }
    dispatchCourse(action)
  }, [audio])

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  useEffect(() => {
    firstSoundRef.current = firstSound
  }, [firstSound])

  useEffect(() => {
    courseRef.current = course
  }, [course])

  useEffect(() => {
    pageRef.current = page
  }, [page])

  const recordInput = useCallback((note: number, source: InputSource) => {
    if (pageRef.current !== 'studio') return
    const stage = progressRef.current.stage
    if (stage === 'practice') {
      dispatch({ type: 'PRACTICE_NOTE', note, source })
    } else if (stage === 'check') {
      dispatch({ type: 'CHECK_NOTE', note, source })
    }
  }, [])

  const pressNote = useCallback(
    (note: number, source: InputSource, velocity = 0.78, atMs = performance.now(), channel = 0, rawVelocity = Math.round(velocity * 127), inputId?: string) => {
      rawTakeRecorder.current.noteOn(note, rawVelocity, channel, source, atMs, inputId)
      setActiveNotes((current) => [...new Set([...current, note])])
      const firstSoundPhase = firstSoundRef.current.stage
      const isFirstSoundInput =
        pageRef.current === 'first-sound' &&
        (firstSoundPhase === 'practice' || firstSoundPhase === 'check')
      if (isFirstSoundInput) {
        dispatchFirstSound({
          type: 'NOTE_ON',
          phase: firstSoundPhase,
          note,
          source,
        })
      }
      const guidedMatch = /^session-(2|4|5|6|7|8)$/.exec(pageRef.current)
      if (guidedMatch) {
        const session = Number(guidedMatch[1]) as GuidedSessionId
        const record = courseRef.current.sessions[String(session)]
        if (record.stage === 'make' && session === 2) {
          const taps =
            typeof record.values.pulseTaps === 'number'
              ? record.values.pulseTaps
              : 0
          dispatchCourseSafely({
            type: 'INCREMENT',
            session: 2,
            key: 'pulseTaps',
            max: 8,
          })
          if (taps + 1 >= 8) {
            dispatchCourseSafely({
              type: 'MARK',
              session: 2,
              area: 'made',
              key: 'tapped-pulse',
            })
          }
        }
        if (record.stage === 'make' && (session === 6 || session === 7)) {
          const pitchNames = ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B']
          const pitch = pitchNames[((note % 12) + 12) % 12]
          const activeBar =
            typeof record.values.activeBar === 'number'
              ? record.values.activeBar
              : 0
          if (pitch) {
            dispatchCourseSafely({
              type: 'ADD_MELODY_NOTE',
              half: session === 6 ? 'A' : 'B',
              bar: Math.min(3, Math.max(0, activeBar)),
              note: pitch,
              pitch: note,
              velocity: Math.round(velocity * 127),
              source,
            })
          }
        }
      }
      const audioOwner = `${source}:${inputId ?? 'default'}:${channel}`
      void audio.noteOn(note, velocity, audioOwner).then((played) => {
        if (played && isFirstSoundInput) {
          dispatchFirstSound({
            type: 'AUDIO_SIGNAL',
            phase: firstSoundPhase,
            source,
          })
        }
      })
      recordInput(note, source)
    },
    [audio, dispatchCourseSafely, recordInput],
  )

  const releaseNote = useCallback(
    (note: number, source: InputSource = 'screen', atMs = performance.now(), channel = 0, releaseVelocity = 0, inputId?: string) => {
      rawTakeRecorder.current.noteOff(note, releaseVelocity, channel, source, atMs, inputId)
      setActiveNotes((current) => current.filter((item) => item !== note))
      audio.noteOff(note, `${source}:${inputId ?? 'default'}:${channel}`)
      const stage = firstSoundRef.current.stage
      if (
        pageRef.current === 'first-sound' &&
        (stage === 'practice' || stage === 'check')
      ) {
        dispatchFirstSound({ type: 'NOTE_OFF', phase: stage, note, source })
      }
    },
    [audio],
  )

  const clearActiveNotes = useCallback(() => {
    setActiveNotes([])
    heldComputerKeys.current.clear()
    audio.allNotesOff()
    if (pageRef.current === 'first-sound') {
      dispatchFirstSound({ type: 'CANCEL_HELD' })
    }
  }, [audio])

  const midi = useMidi({
    onNoteOn: (note, velocity, metadata) => pressNote(note, 'midi', velocity, metadata.atMs, metadata.channel, metadata.rawVelocity, metadata.inputId),
    onNoteOff: (note, metadata) => releaseNote(note, 'midi', metadata.atMs, metadata.channel, metadata.releaseVelocity, metadata.inputId),
    onControlChange: (controller, value, metadata) => {
      if (controller === 64) rawTakeRecorder.current.sustain(value, metadata.channel, metadata.atMs, metadata.inputId)
    },
    onAllNotesOff: clearActiveNotes,
  })

  const navigate = useCallback(
    (nextPage: Page) => {
      if (nextPage !== pageRef.current) {
        audio.stopAll()
        clearActiveNotes()
        window.history.pushState({ page: nextPage }, '', `#${nextPage}`)
        setPage(nextPage)
      }
      if (activeDemo) {
        audio.stopAll()
        setActiveDemo(undefined)
      }
      window.requestAnimationFrame(() => {
        document.getElementById('main-content')?.focus()
      })
    },
    [activeDemo, audio, clearActiveNotes],
  )

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState({ page: 'home' }, '', '#home')
    }
    const handleBack = () => {
      audio.stopAll()
      clearActiveNotes()
      setActiveDemo(undefined)
      setPage(pageFromLocation())
      window.requestAnimationFrame(() => {
        document.getElementById('main-content')?.focus()
      })
    }
    window.addEventListener('popstate', handleBack)
    return () => window.removeEventListener('popstate', handleBack)
  }, [audio, clearActiveNotes])

  useEffect(() => {
    const snapshot = prepareSnapshotForPersistence({
      session1: firstSound,
      session3: progress,
      course,
      settings,
      connections,
      rawTakes,
      evidence: initial.evidence,
    })
    const serializedSnapshot = JSON.stringify(snapshot)
    if (serializedSnapshot === lastQueuedSnapshot.current) return
    lastQueuedSnapshot.current = serializedSnapshot
    const sequence = ++saveSequence.current
    setSaveState('saving')
    setSaveMessage('Saving the complete project…')
    void store.save(snapshot).then(
      () => {
        if (sequence !== saveSequence.current) return
        setSaveState('saved')
        setSaveMessage('Project saved on this device.')
      },
      (error: unknown) => {
        if (sequence !== saveSequence.current) return
        const conflict = error instanceof PersistenceError && error.code === 'conflict'
        setSaveState(conflict ? 'conflict' : 'not-saved')
        setSaveMessage(error instanceof Error ? error.message : 'The project is not saved. Your work remains open.')
      },
    )
  }, [connections, course, firstSound, initial.evidence, progress, rawTakes, settings, store])

  useEffect(() => {
    dispatchFirstSound({
      type: 'MIDI_STATUS',
      connected: midi.state.status === 'connected',
      deviceName: midi.state.deviceName,
    })
  }, [midi.state.deviceName, midi.state.status])

  useEffect(() => {
    dispatchFirstSound({ type: 'AUDIO_READY', ready: audio.status === 'ready' })
  }, [audio.status])

  useEffect(() => {
    if (firstSound.preset.choice) audio.setPreset(firstSound.preset.choice)
  }, [audio, firstSound.preset.choice])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.textSize = settings.textSize
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
    root.dataset.contrast = settings.highContrast ? 'high' : 'normal'
  }, [settings])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const guidedInput = /^session-(2|6|7)$/.test(pageRef.current)
      if (!['studio', 'first-sound'].includes(pageRef.current) && !guidedInput) return
      if (event.code === 'Space' && progressRef.current.stage === 'recall' && !target?.closest('button, a, [role="button"]')) {
        event.preventDefault()
        if (!event.repeat) {
          const taps = progressRef.current.evidence.recall.taps
          void audio.trigger(taps === 0 ? 84 : 79, 0.12, taps === 0 ? 0.92 : 0.64)
          dispatch({ type: 'RECALL_TAP' })
        }
        return
      }
      const note = computerKeyMap[event.key.toLowerCase()]
      if (note === undefined || event.repeat) return
      const harmonyInput =
        pageRef.current === 'studio' &&
        ['practice', 'check'].includes(progressRef.current.stage)
      const firstSoundInput =
        pageRef.current === 'first-sound' &&
        ['practice', 'check'].includes(firstSoundRef.current.stage)
      if (!harmonyInput && !firstSoundInput && !guidedInput) return
      event.preventDefault()
      heldComputerKeys.current.set(event.key.toLowerCase(), note)
      pressNote(note, 'computer', 0.74)
    }
    const keyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const note = heldComputerKeys.current.get(key)
      if (note === undefined) return
      heldComputerKeys.current.delete(key)
      releaseNote(note, 'computer')
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [audio, pressNote, releaseNote])

  useEffect(() => {
    return () => {
      if (demoTimerRef.current) window.clearTimeout(demoTimerRef.current)
    }
  }, [])

  const onPlayDemo = (
    id: 'emotive' | 'guitar' | 'cinematic' | 'electronic',
  ) => {
    if (demoTimerRef.current) window.clearTimeout(demoTimerRef.current)
    audio.stopAll()
    if (activeDemo === id) {
      setActiveDemo(undefined)
      return
    }
    setActiveDemo(id)
    void audio.playDemo(id)
    demoTimerRef.current = window.setTimeout(
      () => setActiveDemo(undefined),
      3300,
    )
  }

  const resetSession = () => {
    audio.stopAll()
    clearActiveNotes()
    dispatch({ type: 'RESET_SESSION' })
  }

  const resetFirstSound = () => {
    audio.stopAll()
    clearActiveNotes()
    dispatchFirstSound({ type: 'RESET' })
    audio.setPreset('warm')
  }

  const resetGuidedSession = (session: GuidedSessionId) => {
    audio.stopAll()
    clearActiveNotes()
    dispatchCourseSafely({ type: 'RESET_SESSION', session })
  }

  const toggleRawTake = (scope: string) => {
    if (rawTakeRecorder.current.recording) {
      const take = rawTakeRecorder.current.stop(performance.now())
      setRecordingScope(undefined)
      if (take) setRawTakes((current) => [...current, take].slice(-100))
      return
    }
    const id = `take-${Date.now().toString(36)}-${(rawTakes.length + 1).toString(36)}`
    if (rawTakeRecorder.current.start(id, scope, performance.now())) setRecordingScope(scope)
  }

  const displaySaveState: SaveState = initialError ? (initialError.includes('newer') ? 'conflict' : 'not-saved') : saveState
  const displaySaveMessage = initialError ?? saveMessage
  const storageOk = displaySaveState === 'saved'
  const currentSnapshot = (): NadiAppSnapshot => prepareSnapshotForPersistence({
    session1: firstSound,
    session3: progress,
    course,
    settings,
    connections,
    rawTakes,
    evidence: initial.evidence,
  })
  const downloadBackup = () => {
    void store.createDownloadBackup(currentSnapshot()).catch(() => JSON.stringify(currentSnapshot(), null, 2)).then((contents) => {
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `nadi-project-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      link.click()
      URL.revokeObjectURL(url)
    })
  }
  const downloadWav = () => {
    const frozenProject = JSON.parse(JSON.stringify(course.project)) as CourseProgress['project']
    setWavExportState('rendering')
    setWavExportMessage('Rendering the frozen project with verified local samples…')
    void renderProjectToWav(frozenProject).then((rendered) => {
      const wavBuffer = new ArrayBuffer(rendered.bytes.byteLength)
      new Uint8Array(wavBuffer).set(rendered.bytes)
      const url = URL.createObjectURL(new Blob([wavBuffer], { type: rendered.mimeType }))
      const link = document.createElement('a')
      link.href = url
      link.download = rendered.filename
      link.click()
      URL.revokeObjectURL(url)
      setLatestWavExport(rendered)
      setWavExportState('ready')
      setWavExportMessage(rendered.clippedSampleCount > 0
        ? `WAV downloaded. Full-render master sample peak (not true peak) ${rendered.samplePeakDbfs.toFixed(1)} dBFS; ${rendered.clippedSampleCount} PCM samples exceeded 0 dBFS and were clipped in PCM16 encoding. The per-lane meter is not yet available.`
        : `WAV downloaded. Full-render master sample peak (not true peak) ${rendered.samplePeakDbfs.toFixed(1)} dBFS; no PCM samples exceeded 0 dBFS. The per-lane meter is not yet available.`)
    }).catch((error: unknown) => {
      setWavExportState('error')
      setWavExportMessage(error instanceof Error ? error.message : 'WAV export could not be created.')
    })
  }
  const downloadFrozenBytes = (download: FrozenDownload) => {
    const buffer = new ArrayBuffer(download.bytes.byteLength)
    new Uint8Array(buffer).set(download.bytes)
    const url = URL.createObjectURL(new Blob([buffer], { type: download.mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = download.filename
    link.click()
    URL.revokeObjectURL(url)
    setFileExportMessage(`Downloaded revision ${download.projectRevision} · ${download.projectContentFingerprint}.`)
  }
  const downloadProjectJson = () => {
    try { downloadFrozenBytes(createFrozenProjectJson(currentSnapshot())) } catch (error: unknown) {
      setFileExportMessage(error instanceof Error ? error.message : 'JSON export could not be created.')
    }
  }
  const downloadProjectMidi = () => {
    try { downloadFrozenBytes(createFrozenProjectMidi(course.project.content, course.project.id, course.project.revision)) } catch (error: unknown) {
      setFileExportMessage(error instanceof Error ? error.message : 'MIDI export could not be created.')
    }
  }
  const runHistoryCommand = (type: 'UNDO_PROJECT' | 'REDO_PROJECT') => {
    audio.stopAll()
    clearActiveNotes()
    dispatchCourseSafely({ type })
  }
  const persistenceToolbar = <div className={`persistence-toolbar persistence-toolbar--${displaySaveState}`} role="status" aria-live="polite">
    <span><strong>{displaySaveState === 'saving' ? 'Saving…' : displaySaveState === 'saved' ? 'Saved' : 'Not saved'}</strong> {displaySaveMessage}</span>
    <span><strong>Piano</strong> {audio.assetStatus === 'loading' ? 'Loading and verifying 30.4 MB local samples…' : audio.assetStatus === 'ready' ? 'Verified local 3-layer samples ready.' : audio.assetStatus === 'fallback' ? 'Lightweight Tone synth fallback active.' : 'Local samples load after the first audio click.'}</span>
    {wavExportState !== 'idle' && <span><strong>{wavExportState === 'rendering' ? 'Rendering…' : wavExportState === 'ready' ? 'WAV ready' : 'WAV unavailable'}</strong> {wavExportMessage}{latestWavExport && ` Frozen ${latestWavExport.projectContentFingerprint}.`}</span>}
    {fileExportMessage && <span><strong>Frozen export</strong> {fileExportMessage}</span>}
    <span><strong>MIDI note</strong> {MIDI_EXPORT_LIMITATION}</span>
    {initial.evidence.historical.length > 0 && <details><summary>Earlier progress retained</summary><div className="historical-progress-list">{initial.evidence.historical.map((record, index) => <span key={`${record.sourceKey}-${record.checkpointName ?? index}`}><b>{record.checkpointName ?? 'Earlier local progress'}</b>{record.checkpointSavedAt ? ` · ${record.checkpointSavedAt}` : ''}<small>Historical · not promoted to fresh independent evidence</small></span>)}</div></details>}
    <div>
      <button type="button" disabled={!course.history.past.length} onClick={() => runHistoryCommand('UNDO_PROJECT')}>Undo</button>
      <button type="button" disabled={!course.history.future.length} onClick={() => runHistoryCommand('REDO_PROJECT')}>Redo</button>
      <button type="button" onClick={downloadBackup}>Download backup</button>
      <button type="button" disabled={wavExportState === 'rendering'} onClick={downloadWav}>Download WAV</button>
      <button type="button" onClick={downloadProjectMidi} title={MIDI_EXPORT_LIMITATION}>Download MIDI</button>
      <button type="button" onClick={downloadProjectJson}>Download project JSON</button>
      {audio.assetStatus === 'fallback' && <button type="button" onClick={() => void audio.retryPianoAssets()}>Retry piano samples</button>}
    </div>
  </div>

  const guidedMatch = /^session-(2|4|5|6|7|8)$/.exec(page)
  if (guidedMatch) {
    const session = Number(guidedMatch[1]) as GuidedSessionId
    return (
      <>{persistenceToolbar}<GuidedSessionPage
        session={session}
        progress={course}
        dispatch={dispatchCourseSafely}
        navigate={navigate}
        audio={audio}
        storageOk={storageOk}
        saveState={displaySaveState}
        onReset={resetGuidedSession}
        recordingScope={recordingScope}
        onToggleRawTake={toggleRawTake}
      /></>
    )
  }

  if (page === 'first-sound') {
    return (
      <>{persistenceToolbar}<FirstSoundPage
        progress={firstSound}
        dispatch={dispatchFirstSound}
        navigate={navigate}
        settings={settings}
        midi={midi.state}
        rescanMidi={midi.rescan}
        selectMidiDevice={midi.selectDevice}
        audio={audio}
        activeNotes={activeNotes}
        pressScreenNote={(note) => pressNote(note, 'screen')}
        releaseScreenNote={(note) => releaseNote(note, 'screen')}
        clearActiveNotes={clearActiveNotes}
        onReset={resetFirstSound}
        storageOk={storageOk}
        saveState={displaySaveState}
      /></>
    )
  }

  if (page === 'studio') {
    return (
      <>{persistenceToolbar}<StudioPage
        progress={progress}
        dispatch={dispatch}
        navigate={navigate}
        settings={settings}
        midi={midi.state}
        audio={audio}
        activeNotes={activeNotes}
        pressScreenNote={(note) => pressNote(note, 'screen')}
        releaseNote={(note) => releaseNote(note, 'screen')}
        clearActiveNotes={clearActiveNotes}
        onReset={resetSession}
        storageOk={storageOk}
        saveState={displaySaveState}
      /></>
    )
  }

  return (
    <>{persistenceToolbar}<NavigationShell
      page={page as NavigationPage}
      navigate={navigate}
      progress={progress}
      firstSound={firstSound}
      course={course}
      settings={settings}
      setSettings={setSettings}
      connectionPrefs={connections}
      setConnectionPrefs={setConnections}
      midi={midi.state}
      rescanMidi={midi.rescan}
      silenceMidi={midi.silence}
      audio={audio}
      activeDemo={activeDemo}
      onPlayDemo={onPlayDemo}
      storageOk={storageOk}
      saveState={displaySaveState}
    /></>
  )
}
