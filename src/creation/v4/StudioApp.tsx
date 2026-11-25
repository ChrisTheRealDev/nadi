import { FirstBeatTutorial } from './FirstBeatTutorial'
import { SOUND_LABELS } from './model'
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { useMidi } from '../../hooks/useMidi'
import { StudioWorkspace, type StudioWorkspaceHandle } from '../StudioWorkspace'
import type { StudioPanelId } from '../workspacePreferencesV2'
import { NotesPanel } from './NotesPanel'
import { ExternalMidiSettings } from './ExternalMidiSettings'
import { describeStudioEdit, describeWorkbenchAction } from './editDescription'
import { acceptedEditObservations } from './editObservations'
import { useModalFocus } from '../useModalFocus'
import { LiveOccurrences, type LiveInputScope } from './liveOccurrences'
import { emptyEditingViews, noteView, patchNoteView, resolvePlayback, type LoopOwner } from './editingContext'
import type { NotesPanelView } from './notesPanelState'
import type { HistoryDescription } from './history'
import type { EditResult } from './editResult'
import { loadWorkspacePreferences, type WorkspacePreferences } from '../workspacePreferences'
import { createStudioProject as createProject, validateStudioProject as validateProject, compileArrangement, isMelodicSound, SOUND_IDS, type StudioProject as CreationProject, type SoundId } from './model'
import { type CreationProject as LegacyProject, type Note } from '../model'
import { addTrack, addPattern, duplicateClip, makeIndependent, moveClip, deleteClip, deleteTrack, updatePatternNotes, placePattern, pastePattern, moveClips, deleteClips, duplicateClips, pasteClips, updateTrackProduction } from './operations'
import { editorProjection, applyEditorProjection, preserveOriginals, patternNotes } from './editorAdapter'
import { StudioHistory } from './history'
import { decodeRecovery } from './recovery'
import { RecoveryControls } from './RecoveryControls'
import { NumericDraft } from '../NumericDraft'
import { CombinedDrums } from './CombinedDrums'
import { TrackControls, SoundBrowser, PatternPlaylist, TrackMixer, type WorkbenchAction } from './Workbench'
import { StudioMira } from './StudioMira'
import { StudioStore as CreationStore } from './storage'
import { packStudioProject as packProject } from './archive'
import { StudioAudio as CreationAudio, studioMidi as creationMidi } from './audio'
import { isSampledSound } from './sounds'
import { duplicateBarToEnd, repeatBarNext } from '../edits'
import { IdeaPad, type IdeaPadHandle } from '../IdeaPad'
import { createMidiIdea, ideaToNotes, type Idea, type MidiOriginal } from '../ideas'
import { appendStudioOriginal, finishStudioOriginal, type StudioOriginalBuffer, type StudioRawInput } from '../studioFoundation'
import '../creation.css'
import './session.css'
import { createSirensStudy } from './sirensStudy'
import { SheetMusic } from './SheetMusicDialog'
import { clearScoreViews, createScoreViewCache } from './scoreViewCache'
import { AccountStudioStore, loadRemoteAccountProjects, syncPendingProjects, type SyncState } from '../../tracking/accountStore'
import AccountSyncControls from '../../tracking/AccountSyncControls'
import AccountImportControls from '../../tracking/AccountImportControls'
import { useTrackingSession } from '../../tracking/TrackingSession'
import { FeedbackButton } from '../../tracking/FeedbackInbox'
import { DEFAULT_METRONOME, countInSchedule, type MetronomeSettings } from './metronome'
import { MetronomeControls } from './MetronomeControls'
import { PlayabilityPanel } from './playabilityPanel'
import { defaultNotation, DEFAULT_TRACK } from './notationModel'

const clone = <T,>(value: T): T => structuredClone(value)
// Read only from input/transport event handlers, never while rendering.
const inputClockNow = () => performance.now()
const failure = (error: unknown) => error instanceof Error ? error.message : 'Something could not finish. Your music stays here.'
function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export default function CreationApp({ accountId }: { accountId?: string } = {}) {
  const tracking = useTrackingSession()
  const trackingClient = tracking?.client
  const [syncState, setSyncState] = useState<SyncState>({ status: 'saved-locally' })
  const [initialWorkspace] = useState(loadWorkspacePreferences)
  const [workspace, setWorkspace] = useState(initialWorkspace.preferences)
  const workspaceCurrent = useRef(workspace)
  const [workspaceConfigured] = useState(initialWorkspace.configured)
  const [setupOpen, setSetupOpen] = useState(false)
  const setupActive = useRef(false)
  const workspaceHandle = useRef<StudioWorkspaceHandle>(null)
  const [activeHelpPanel, setActiveHelpPanel] = useState<StudioPanelId>('notes')
  const [noteUi, setNoteUi] = useState<{ tool: 'draw' | 'select' | 'erase'; selectedCount: number; selectedIds?: string[]; trackId?: string; clipId?: string }>({ tool: 'draw', selectedCount: 0 })
  const [latestRejection, setLatestRejection] = useState<'none' | 'note' | 'drum' | 'clip' | 'other'>('none')
  const midiReferenceActive = useRef(false)
  const [visiblePanels, setVisiblePanels] = useState<string[]>(['notes'])
  const [miraOpen, setMiraOpen] = useState(initialWorkspace.preferences.mira)
  const [restoreSelection, setRestoreSelection] = useState<{ sequence: number; ids: string[]; patternId: string; projectId: string }>()
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const setupOpener = useRef<HTMLElement | null>(null)
  const [project, setProject] = useState<CreationProject>(() => createProject())
  const [showScore, setShowScore] = useState(false)
  // Reopening this dialog for the same project can reuse its pages. Every edit,
  // project switch and account remount owns a fresh cache.
  const scoreViews = useMemo(() => createScoreViewCache(project, true), [project])
  useEffect(() => () => clearScoreViews(scoreViews), [scoreViews])
  const performerModes = useMemo(() => Object.fromEntries(Object.entries(project.notation?.tracks ?? {}).map(([id, track]) => [id, track.performerMode ?? 'default'])), [project.notation])
  const current = useRef(project)
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [selectedClipId, setSelectedClipId] = useState('')
  const [selectedClipIds, setSelectedClipIds] = useState<string[] | undefined>()
  const selectedTrack = project.tracks.find(track => track.id === selectedTrackId) ?? project.tracks[0]
  const selectedClip = project.clips.find(clip => clip.id === selectedClipId && clip.trackId === selectedTrack?.id) ?? project.clips.find(clip => clip.trackId === selectedTrack?.id)
  const selectedPattern = project.patterns.find(pattern => pattern.id === selectedClip?.patternId)
  const projection = useMemo(() => {
    const track = project.tracks.find(item => item.id === selectedTrackId) ?? project.tracks[0]
    const clip = project.clips.find(item => item.id === selectedClipId && item.trackId === track?.id) ?? project.clips.find(item => item.trackId === track?.id)
    const pattern = project.patterns.find(item => item.id === clip?.patternId)
    return editorProjection(project, track?.id, pattern?.id)
  }, [project, selectedTrackId, selectedClipId])
  const [store] = useState(() => accountId ? new AccountStudioStore(accountId) : new CreationStore())
  const [audio] = useState(() => new CreationAudio())
  const blockedMidiInputs = useRef(new Set<string>())
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState('Not saved yet')
  const [message, setMessage] = useState('Your studio is open. Ask Mira whenever you want a hand.')
  const [audioLabel, setAudioLabel] = useState(audio.label)
  const [soundStates, setSoundStates] = useState<Partial<Record<SoundId, { state: 'loading' | 'ready' | 'error'; message?: string }>>>({})
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [selectedBarChoice, setSelectedBar] = useState(0)
  const selectedBar = Math.min(selectedBarChoice, projection.bars - 1)
  const [drumView, setDrumView] = useState({ bar: 0, visible: 4 as 1 | 2 | 4 })
  const [editingViews, setEditingViews] = useState(emptyEditingViews)
  const editingViewsCurrent = useRef(editingViews)
  const [loopOwner, setLoopOwner] = useState<LoopOwner>()
  const lastEditorPanel = useRef<'notes' | 'drums'>('notes')
  const [visibleBars, setVisibleBars] = useState<1 | 2 | 4>(4)


  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [loopBar, setLoopBar] = useState(false)
  const [focusedEditor, setFocusedEditor] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [metronomeSettings, setMetronomeSettings] = useState<MetronomeSettings>(DEFAULT_METRONOME)
  const [listenMode, setListenMode] = useState<'song' | 'part'>('song')
  const [cursorTick, setCursorTick] = useState(0)
  const [noteCursorTick, setNoteCursorTick] = useState(0)
  const playbackPosition = useRef(0)
  const [paused, setPaused] = useState(false)
  const [pinnedDevice, setPinnedDevice] = useState<string | null | undefined>(undefined)
  const [linkedRecording, setLinkedRecording] = useState(false)
  const [soloTracks, setSoloTracks] = useState<string[]>([])
  const [meters, setMeters] = useState({ tracks: {} as Record<string, number>, master: 0, clipping: false })
  const [rangeEnabled, setRangeEnabled] = useState(false)
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(4)
  const [rememberedDestination, setRememberedDestination] = useState<{ piano?: { trackId: string; clipId?: string }; drums?: { trackId: string; clipId?: string } }>({})
  const [activeNotes, setActiveNotes] = useState<number[]>([])
  const [recording, setRecording] = useState(false)
  const [recordPreparing, setRecordPreparing] = useState(false)
  const [counting, setCounting] = useState(0)
  const [hasTake, setHasTake] = useState(false)
  const switching = useRef(false)
  const [switchPending, setSwitchPending] = useState(false)
  const ideaPadOpen = workspace.browser
  const changeWorkspace = (patch: Partial<WorkspacePreferences>) => {
    const next = { ...workspaceCurrent.current, ...patch }
    if (workspaceConfigured && Object.keys(next).every(key => next[key as keyof WorkspacePreferences] === workspaceCurrent.current[key as keyof WorkspacePreferences])) return
    workspaceCurrent.current = next; setWorkspace(next)

  }
  const setIdeaPadOpen = (value: boolean | ((open: boolean) => boolean)) => changeWorkspace({ browser: typeof value === 'function' ? value(workspaceCurrent.current.browser) : value })
  const [revealIdeaPadToken, setRevealIdeaPadToken] = useState(0)
  const revealIdeaPad = () => { workspaceHandle.current?.openIdeas(); setRevealIdeaPadToken(token => token + 1) }
  const ideaPad = useRef<IdeaPadHandle>(null)
  const [projects, setProjects] = useState<CreationProject[] | null>(null)
  const projectDialog = useRef<HTMLElement>(null)
  const linkedDialog = useRef<HTMLElement>(null)
  const projectOpener = useRef<HTMLElement>(null)
  const recordOpener = useRef<HTMLElement>(null)
  useModalFocus(projects !== null, projectDialog, () => { if (!switchPending) setProjects(null) }, projectOpener)
  useModalFocus(linkedRecording, linkedDialog, () => setLinkedRecording(false), recordOpener)
  const [invalidProjects, setInvalidProjects] = useState<{ key: IDBValidKey; raw: unknown; message: string }[]>([])
  const [exporting, setExporting] = useState(false)
  const [historyAvailable, setHistoryAvailable] = useState({ undo: false, redo: false })
  type HelpAction = 'sound-tested' | 'note-played' | 'record-started' | 'note-changed' | 'drum-hit-changed' | 'bar-duplicated' | 'mix-changed' | 'project-saved' | 'project-exported'
  const [observedAction, setObservedAction] = useState<{ sequence: number; type: HelpAction } | null>(null)
  const [observedMiraAction, setObservedMiraAction] = useState<{ sequence: number; type: string; projectId: string; trackId?: string; clipId?: string; resultTrackId?: string; resultClipId?: string } | null>(null)
  const actionSequence = useRef(0)
  const observeMira = (type: string, destination?: { trackId?: string; clipId?: string }, result?: { trackId: string; clipId: string }) => setObservedMiraAction({ sequence: ++actionSequence.current, type, projectId: current.current.id, trackId: destination ? destination.trackId : selectedTrack?.id, clipId: destination ? destination.clipId : selectedClip?.id, resultTrackId: result?.trackId, resultClipId: result?.clipId })
  const observe = (type: HelpAction, destination?: { trackId?: string; clipId?: string }) => { const action = { sequence: ++actionSequence.current, type }; setObservedAction(action); setObservedMiraAction({ ...action, projectId: current.current.id, trackId: destination?.trackId ?? selectedTrack?.id, clipId: destination?.clipId ?? selectedClip?.id }) }
  const [sessionHistory] = useState(() => new StudioHistory())
  const expected = useRef(new Map<string, number>())
  const queue = useRef(Promise.resolve())
  const saveFault = useRef(false)
  const pendingSaves = useRef(0)
  const importedRecovery = useRef(new Map<string, unknown>())
  const run = useRef(0)
  const record = useRef<{ start: number; startTick: number; bpm: number; trackId: string; patternId: string; original: StudioOriginalBuffer } | null>(null)
  const preparingRecord = useRef(false)
  const preparation = useRef<AbortController | null>(null)
  const takeDestination = useRef<{ trackId: string; patternId: string } | null>(null)
  const inputPitch = useRef(new Map<string, number>())
  const screenHeld = useRef(new Set<number>())
  const take = useRef<Note[]>([])
  const takeOriginal = useRef<MidiOriginal | null>(null)
  const [liveOccurrences] = useState(() => new LiveOccurrences())
  const [ideaCapturing, setIdeaCapturing] = useState(false)
  const [anyIdeaCapture, setAnyIdeaCapture] = useState(false)
  const [ideaPinnedDevice, setIdeaPinnedDevice] = useState<string | null | undefined>()

  const monitoringTrackId = selectedTrack?.id
  // Prepare samples on destination changes, before the performer presses a key.
  useEffect(() => {
    if (!ready || !monitoringTrackId) return
    let active = true
    void audio.preloadTrack(monitoringTrackId).then(() => { if (active) setAudioLabel(audio.label) })
      .catch(error => { if (active) setMessage(failure(error)) })
    const enable = () => { void audio.unlock().catch(() => { /* A key can retry browser activation. */ }) }
    window.addEventListener('pointerdown', enable, { once: true })
    window.addEventListener('keydown', enable, { once: true })
    return () => { active = false; window.removeEventListener('pointerdown', enable); window.removeEventListener('keydown', enable) }
  }, [audio, ready, monitoringTrackId, selectedTrack?.soundId])

  // Monitoring shares the absolute song envelope, even while transport is stopped.
  // Playback/overdub own their clock and must not be repositioned by panel renders.
  useEffect(() => {
    if (!playing && !recording && !recordPreparing) {
      audio.setExpressionPosition(selectedTrack && isMelodicSound(selectedTrack.soundId)
        ? (selectedClip?.startTick ?? 0) + noteCursorTick : cursorTick)
    }
  }, [audio, playing, recording, recordPreparing, selectedTrack, selectedClip?.startTick, noteCursorTick, cursorTick])

  const write = (next: CreationProject) => {
    pendingSaves.current++; setSaved('Saving…')
    queue.current = queue.current.then(async () => {
      if (saveFault.current) throw new Error('Saving is paused after a storage conflict or failure. Download your project before reopening.')
      if (!expected.current.has(next.id) && next.revision === 1) {
        await store.save({ ...next, revision: 0 }, null, importedRecovery.current.get(next.id))
        importedRecovery.current.delete(next.id)
        expected.current.set(next.id, 0)
      }
      await store.save(next, expected.current.get(next.id) ?? null, expected.current.has(next.id) ? undefined : importedRecovery.current.get(next.id))
      importedRecovery.current.delete(next.id)
      expected.current.set(next.id, next.revision)
      if (current.current.id === next.id && current.current.revision === next.revision) setSaved('Saved')
    }).catch(error => { saveFault.current = true; setSaved('Not saved'); setMessage(`${failure(error)} Download .nadi to keep a copy.`) })
      .finally(() => { pendingSaves.current-- })
  }
  const install = (next: CreationProject) => {
    current.current = next; setProject(next)
    audio.setProject(next)
    const remainingSolo = soloTracks.filter(id => next.tracks.some(track => track.id === id))
    if (remainingSolo.length !== soloTracks.length) { setSoloTracks(remainingSolo); if (!audio.setSolo(remainingSolo)) { stop(); setMessage('Solo destination changed. Press Play to prepare the newly audible sounds.') } }
    setSelectedBar(bar => Math.min(bar, next.bars - 1))
    setRangeStart(bar => Math.min(bar, next.bars)); setRangeEnd(bar => Math.min(bar, next.bars))
  }
  const stop = () => {
    midiReferenceActive.current = false
    run.current++
    preparingRecord.current = false
    setRecordPreparing(false)
    preparation.current?.abort(); preparation.current = null
    const active = record.current
    if (active) {
      takeOriginal.current = finishStudioOriginal(active.original, inputClockNow())
      try { take.current = ideaToNotes(takeOriginal.current, active.bpm, active.startTick) }
      catch { take.current = [] }
      record.current = null
      const captured = take.current.length > 0 || takeOriginal.current.events.length > 0
      setHasTake(captured)
      setMessage(captured ? 'Recording stopped. Keep recording preserves the original key/controller events beside an editable note copy. Timing has not been snapped.' : 'No notes recorded. You can try again or place notes on screen.')
    }
    audio.stop(); audio.setProject(current.current); ideaPad.current?.stopReference(); inputPitch.current.clear(); screenHeld.current.clear(); liveOccurrences.allNotesOff()
    setActiveNotes([]); setPlaying(false); setRecording(false); setCounting(0); setPinnedDevice(undefined)
  }
  const applyEdit = (value: CreationProject, keepingTake = false, description?: HistoryDescription): EditResult => {
    const reject = (message: string): EditResult => { setLatestRejection(description?.context?.panel === 'notes' ? 'note' : description?.context?.panel === 'drums' ? 'drum' : description?.context?.panel === 'arrangement' ? 'clip' : 'other'); setMessage(message); return { status: 'rejected', message } }
    setFeedbackId(null)
    if (switching.current || setupActive.current || !ready || value.id !== current.current.id) return { status: 'cancelled', message: 'Editing is temporarily unavailable.' }
    if (value.revision !== current.current.revision) { return reject('The project changed. Please retry that edit.') }
    if (JSON.stringify({ ...value, revision: 0 }) === JSON.stringify({ ...current.current, revision: 0 })) return { status: 'unchanged' }
    const next = { ...clone(value), revision: current.current.revision + 1 }
    if (!validateProject(next)) { audio.setProject(current.current); return reject('That change would put notes outside the song or use an unsupported value. Your existing music is unchanged.') }
    if (!preserveOriginals(current.current, next)) { return reject('Captured originals cannot be rewritten. Copy a keyboard idea into the studio to edit its notes instead.') }
    const arrangementChanged = JSON.stringify([next.tracks, next.patterns, next.clips, next.bpm, next.bars, next.notation]) !== JSON.stringify([current.current.tracks, current.current.patterns, current.current.clips, current.current.bpm, current.current.bars, current.current.notation])
    const musical = arrangementChanged
    if (musical && !keepingTake && (preparingRecord.current || record.current || take.current.length || takeOriginal.current?.events.length)) { return reject('Stop and Keep or Discard the recording before changing its destination or music.') }
    let playbackWarning: string | undefined
    if (arrangementChanged && !audio.updateSong(next)) {
      stop()
      if (playing) playbackWarning = 'Playback stopped: the range or sound changed. Press Play to prepare audible instruments. For a failed sound, open Sounds → Retry.'
    }
    const ideaMetadataChanged = JSON.stringify(next.ideas.map(idea => [idea.id, idea.name, idea.attachedTick])) !== JSON.stringify(current.current.ideas.map(idea => [idea.id, idea.name, idea.attachedTick]))
    if (musical || ideaMetadataChanged || next.name !== current.current.name) { sessionHistory.push(current.current, description ?? describeStudioEdit(current.current, next)); setHistoryAvailable(sessionHistory.availability); setFeedbackId(sessionHistory.undoCommand?.id ?? null); setMessage(sessionHistory.undoCommand?.label ?? 'Edited music') }
    if (playbackWarning) setMessage(playbackWarning)
    for (const event of acceptedEditObservations(current.current, next, description)) {
      const scoped = { ...event, sequence: ++actionSequence.current }
      setObservedMiraAction(scoped)
      if (event.type !== 'note-deleted') setObservedAction({ sequence: scoped.sequence, type: event.type })
    }
    setLatestRejection('none'); install(next); write(clone(next))
    return { status: 'accepted' }
  }
  const edit = (value: CreationProject, keepingTake = false, description?: HistoryDescription) => applyEdit(value, keepingTake, description).status === 'accepted'
  const duplicate = () => {
    try {
      const copied = duplicateBarToEnd({ ...projection, ideas: [] }, selectedBar)
      if (selectedPattern && edit(updatePatternNotes(current.current, selectedPattern.id, patternNotes(copied.notes), copied.bars * 1920))) {
        observe('bar-duplicated'); setSelectedBar(projection.bars)
        setMessage('Copied this bar to the end. Change the copy freely; the original stays the same.')
      }
    } catch (error) { setMessage(failure(error)) }
  }
  const repeatNext = () => {
    try {
      const targetBar = selectedBar + 1
      const copied = repeatBarNext({ ...projection, ideas: [] }, selectedBar)
      if (selectedPattern && edit(updatePatternNotes(current.current, selectedPattern.id, patternNotes(copied.notes), copied.bars * 1920))) {
        if (loopBar && playing) stop()
        observe('bar-duplicated'); setSelectedBar(targetBar)
        setMessage(`Repeated into bar ${targetBar + 1}. The copy is independent; no existing notes were overwritten.`)
      }
    } catch (error) { setMessage(failure(error)) }
  }
  const saveNow = async () => {
    if (switching.current) return
    const snapshot = clone(current.current)
    await queue.current
    if (switching.current) return
    if (saveFault.current) { setMessage('Local saving is paused. Download .nadi to keep your current work before reopening.'); return }
    if (!expected.current.has(snapshot.id) && current.current.id === snapshot.id) {
      write(clone(current.current)); await queue.current
    }
    if (!saveFault.current && current.current.id === snapshot.id && expected.current.get(snapshot.id) === current.current.revision) {
      observe('project-saved'); setMessage('Saved in this browser. Download .nadi as a portable backup.')
    }
  }
  const testSound = async () => {
    if (switching.current) return
    try {
      if (!selectedTrack) return
      await audio.noteOn('sound-check', 60, 90, selectedTrack.id)
      setAudioLabel(audio.label); observe('sound-tested')
      window.setTimeout(() => audio.noteOff('sound-check'), 350)
      setMessage('Test note requested. Can you hear it? If not, check Piano Mute, volume and your output device.')
    } catch (error) { setMessage(failure(error)) }
  }
  const inputScope = (key: string): LiveInputScope => {
    const match = /^midi:(.*):(\d+):(\d+)$/.exec(key)
    return match ? { source: 'midi', deviceId: match[1], channel: Number(match[2]) } : { source: 'screen', channel: 0 }
  }
  const releaseVoices = (keys: string[]) => { keys.forEach(key => { audio.noteOff(key); inputPitch.current.delete(key) }); setActiveNotes([...inputPitch.current.values()]) }
  const release = (key: string) => {
    const id = liveOccurrences.noteOff(inputScope(key), Number(key.slice(key.lastIndexOf(':') + 1)))
    if (id) releaseVoices([id])
  }
  const press = (key: string, pitch: number, velocity = 90, atMs = inputClockNow()) => {
    if (switching.current || setupActive.current) return
    if (preparingRecord.current && !record.current || record.current && atMs < record.current.original.startedAtMs) return
    const scope = inputScope(key)
    const occurrence = liveOccurrences.noteOn(scope, pitch)
    inputPitch.current.set(occurrence, pitch); setActiveNotes([...inputPitch.current.values()])
    observe('note-played')
    const trackId = record.current?.trackId ?? selectedTrack?.id
    if (trackId) void audio.noteOn(occurrence, pitch, velocity, trackId, scope.source === 'screen').then(() => setAudioLabel(audio.label)).catch(error => { liveOccurrences.cancel(occurrence); releaseVoices([occurrence]); setMessage(failure(error)) })
  }
  const captureInput = (event: StudioRawInput, atMs: number, deviceId?: string) => {
    if (switching.current || setupActive.current) return
    ideaPad.current?.pushMidi(event, atMs, deviceId)
    const active = record.current
    if (active && appendStudioOriginal(active.original, event, atMs) === 'limit') {
      stop(); setMessage('Studio capture stopped at its 60-second / 10,000-event limit. Keep this original, then record another take.')
    }
  }
  const midi = useMidi({
    onNoteOn: (pitch, _velocity, metadata) => {
      captureInput({ type: 'note-on', pitch, velocity: metadata.rawVelocity, channel: metadata.channel, source: 'midi' }, metadata.atMs, metadata.inputId)
      press(`midi:${metadata.inputId}:${metadata.channel}:${pitch}`, pitch, metadata.rawVelocity, metadata.atMs)
    },
    onNoteOff: (pitch, metadata) => {
      captureInput({ type: 'note-off', pitch, velocity: metadata.releaseVelocity, channel: metadata.channel, source: 'midi' }, metadata.atMs, metadata.inputId)
      release(`midi:${metadata.inputId}:${metadata.channel}:${pitch}`)
    },
    onControlChange: (controller, value, metadata) => {
      if (switching.current || setupActive.current) return
      captureInput({ type: 'controller', controller, value, channel: metadata.channel, source: 'midi' }, metadata.atMs, metadata.inputId)
      if (![64, 120, 123].includes(controller)) return
      if (preparingRecord.current && !record.current || record.current && metadata.atMs < record.current.original.startedAtMs) return
      releaseVoices(liveOccurrences.controller({ source: 'midi', deviceId: metadata.inputId, channel: metadata.channel }, controller, value))
    },
    onPitchBend: (value, metadata) => captureInput({ type: 'pitch-bend', value, channel: metadata.channel, source: 'midi' }, metadata.atMs, metadata.inputId),
    onAllNotesOff: metadata => {
      releaseVoices(liveOccurrences.allNotesOff(metadata ? { source: 'midi', deviceId: metadata.inputId, channel: metadata.channel } : undefined))
    },
    onInputDisconnected: id => { ideaPad.current?.stopCaptureForDisconnectedDevice(id); if (record.current || preparingRecord.current) { stop(); setMessage('Recording stopped because the selected MIDI device disconnected. Keep or download the captured take before reconnecting.') } },
  }, {
    pinnedDeviceId: pinnedDevice !== undefined ? pinnedDevice : ideaPinnedDevice,
    excludeInput: id => blockedMidiInputs.current.has(id),
  })
  const { refreshInputs } = midi
  const setExternalMidiRoute = useCallback((output?: MIDIOutput, trackId?: string, channel?: number, monitorLocal?: boolean, matchingInputs: string[] = [], onFailure?: () => void) => {
    blockedMidiInputs.current = new Set(matchingInputs)
    audio.setMidiOutput(output, trackId, channel, monitorLocal, { onFailure, projectId: current.current.id })
    refreshInputs()
  }, [audio, refreshInputs])

  useEffect(() => {
    let active = true
    const load = async () => {
      if (store instanceof AccountStudioStore && trackingClient) {
        try { await loadRemoteAccountProjects(store, trackingClient) }
        catch { if (active) setSyncState({ status: 'offline', message: 'Shared projects could not be loaded. Your saved account projects remain available on this device.' }) }
      }
      return store.load()
    }
    void load().then(value => {
      if (!active) return
      if (value) { current.current = value; setProject(value); audio.setProject(value); expected.current.set(value.id, value.revision); setSaved('Saved') }
      else audio.setProject(current.current)
      setReady(true)
    }).catch(error => { if (active) { saveFault.current = true; setSaved('Not saved'); setMessage(`${failure(error)} You can still create and download a .nadi copy.`); setReady(true) } })
    return () => { active = false }
  }, [store, audio, trackingClient])
  useEffect(() => {
    if (!(store instanceof AccountStudioStore) || !trackingClient || !ready) return
    let active = true
    const sync = () => {
      if (document.hidden) return
      void syncPendingProjects(store, trackingClient).then(result => {
        if (!active) return
        // Keep this account's local studio mounted until the musician chooses
        // to reconnect; changing accountId here could discard an active take.
        setSyncState(!trackingClient.hasSession() ? { status: 'error', message: 'Your sign-in expired. Finish any recording and save or download your work, then open My work & tutor feedback to sign in again. Pending updates remain on this device.' } : result)
      }).catch(() => { if (active) setSyncState({ status: 'error', message: 'Synchronization could not finish. Your local music and pending updates are retained. Open My work & tutor feedback to reconnect.' }) })
    }
    const soon = window.setTimeout(sync, 1000)
    const timer = window.setInterval(sync, 5000)
    const visible = () => { if (!document.hidden) sync() }
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; clearTimeout(soon); clearInterval(timer); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', visible) }
  }, [store, trackingClient, ready])
  useEffect(() => {
    const timer = window.setInterval(() => {
      setAudioLabel(audio.label)
      const states: typeof soundStates = {}
      for (const id of SOUND_IDS) { const status = audio.soundStatus(id); if (status !== 'idle') states[id] = { state: status === 'fallback' ? 'error' : status } }
      setSoundStates(previous => JSON.stringify(previous) === JSON.stringify(states) ? previous : states)
      setMeters(audio.meterSnapshot())
    }, 150)
    const warn = (event: BeforeUnloadEvent) => { if (pendingSaves.current || saveFault.current || record.current || take.current.length || takeOriginal.current?.events.length || ideaPad.current?.isDirty()) { event.preventDefault(); event.returnValue = '' } }
    const leave = () => audio.releaseMidiOutput()
    window.addEventListener('beforeunload', warn)
    window.addEventListener('pagehide', leave)
    return () => { window.clearInterval(timer); window.removeEventListener('beforeunload', warn); window.removeEventListener('pagehide', leave); audio.dispose() }
  }, [audio])
  useEffect(() => {
    audio.setInterruptionHandler(() => { stop(); setMessage('Sound was paused by the browser. Your project is safe. Press Play to resume.') })
    return () => { audio.setInterruptionHandler(undefined) }
  })

  const listening = (resume?: number) => resolvePlayback(current.current, editingViewsCurrent.current, { mode: listenMode, cursor: cursorTick, clipId: selectedClip?.id, range: rangeEnabled ? { startTick: (rangeStart - 1) * 1920, endTick: Math.min(current.current.bars, rangeEnd) * 1920 } : undefined, loop: loopBar ? loopOwner : undefined, resume })
  const chosenStart = () => { try { return listening().returnTick } catch { return 0 } }
  const play = async () => {
    if (switching.current || preparingRecord.current || record.current || hasTake) return
    if (!loopBar && listenMode === 'part' && !selectedClip) { setMessage('Choose a placed part in Playlist before using Selected part playback.'); return }
    let resolved: ReturnType<typeof resolvePlayback>
    try { resolved = listening(paused ? playbackPosition.current : undefined) } catch (error) { setMessage(failure(error)); return }
    stop(); const token = run.current
    const snapshot = clone(current.current)
    if (!compileArrangement(snapshot).length) { setMessage('Your song is empty. Click the piano grid to place notes, or press Record and play after the count-in. Captured originals remain in the Idea Pad.'); return }
    setPlaying(true); setPaused(false)
    setMessage(`Playing ${resolved.label}.`)
    try { await audio.play(snapshot, tick => { if (token === run.current) { playbackPosition.current = tick; setPlayhead(tick) } }, () => { if (token === run.current) { audio.setProject(current.current); setPlaying(false); setPlayhead(resolved.returnTick); setMessage('Playback finished.') } }, { live: true, clipIds: resolved.clipIds, startTick: resolved.startTick, endTick: resolved.endTick, metronome, metronomeSettings, loopRange: resolved.loopRange, failed: error => { if (token === run.current) setMessage(failure(error)) } }); if (token === run.current) observeMira('song-played') }
    catch (error) { if (token === run.current) { stop(); setMessage(failure(error)) } }
  }
  const pause = () => { if (!playing || recording) return; const position = playbackPosition.current; stop(); playbackPosition.current = position; setPlayhead(position); setPaused(true); setMessage('Paused. Play resumes from here.') }
  const playScore = async () => {
    if (switching.current || preparingRecord.current || record.current || hasTake) return
    stop(); const token = run.current, snapshot = clone(current.current)
    if (!compileArrangement(snapshot).length) { setMessage('Add notes to the score before playing.'); return }
    setPlaying(true); setPaused(false)
    try {
      await audio.play(snapshot, tick => { if (token === run.current) { playbackPosition.current = tick; setPlayhead(tick) } }, () => { if (token === run.current) { audio.setProject(current.current); setPlaying(false); setPlayhead(0) } }, { live: true, startTick: 0, endTick: snapshot.bars * 1920, metronome, metronomeSettings, failed: error => { if (token === run.current) { stop(); setMessage(failure(error)) } } })
    } catch (error) { if (token === run.current) { stop(); setMessage(failure(error)) } }
  }
  const seek = (tick: number) => { if (recording || hasTake) return; stop(); setPaused(false); setListenMode('song'); setLoopBar(false); setRangeEnabled(false); setCursorTick(tick); playbackPosition.current = tick; setPlayhead(tick) }
  const replayMidi = async (idea: Idea, loop: boolean) => {
    if (switching.current) return
    if (record.current || preparingRecord.current || hasTake || ideaPad.current?.isCapturing()) { setMessage('Stop and keep your capture before replaying a reference.'); return }
    if (idea.original.kind !== 'midi') return
    stop(); const token = run.current
    try {
      let snapshot = createProject()
      snapshot.bpm = 120
      const notes = ideaToNotes(idea.original, snapshot.bpm)
      if (!notes.length) { setMessage('This original contains controller events but no playable notes. Download original events to inspect them.'); return }
      const end = notes.reduce((last, note) => Math.max(last, note.startTick + note.durationTicks), Math.ceil(idea.original.durationMs * snapshot.bpm * 480 / 60000))
      snapshot = updatePatternNotes(snapshot, snapshot.patterns[0].id, patternNotes(notes), Math.max(1920, Math.ceil(end / 1920) * 1920))
      if (!validateProject(snapshot)) throw new Error('This original exceeds the temporary replay limits. Download its original events instead.')
      setMessage(`Replaying your captured keyboard timing through the piano. Sustain is supported; other controllers and pitch bend remain saved but are not rendered.${loop ? ' Loop restarts at the rounded bar boundary plus a half-second release tail; it is not seamless.' : ''}`)
      midiReferenceActive.current = true; setPlaying(true)
      const restart = async () => {
        if (token !== run.current) return
        await audio.play(snapshot, () => {}, () => {
          if (token !== run.current) return
          if (loop) void restart().catch(error => { if (token === run.current) { setPlaying(false); setMessage(failure(error)); audio.setProject(current.current) } })
          else { midiReferenceActive.current = false; audio.setProject(current.current); setPlaying(false); setPlayhead(0) }
        })
      }
      await restart()
    } catch (error) { if (token === run.current) { midiReferenceActive.current = false; setPlaying(false); audio.setProject(current.current); setMessage(failure(error)) } }
  }
  const pauseMidiReference = () => {
    if (!midiReferenceActive.current) return
    midiReferenceActive.current = false; run.current++; audio.stop(); audio.setProject(current.current); setPlaying(false); setMessage('Reference playback stopped. Your capture is unchanged.')
  }
  const captureIdea = (idea: Idea) => {
    if (switching.current) { setMessage('Project switching is in progress. Your capture remains in the Idea Pad; keep or download it once this operation finishes.'); return false }
    if (saveFault.current) { setMessage('Browser saving is paused. This capture remains in the Idea Pad as an unsaved original: download it before closing or switching projects.'); return false }
    const existing = current.current.ideas.find(item => item.id === idea.id)
    if (existing) {
      const sameOriginal = existing.createdAt === idea.createdAt && JSON.stringify(existing.original) === JSON.stringify(idea.original)
      if (!sameOriginal) setMessage('That capture identifier already belongs to a different original. It was not overwritten; download the unsaved original from the Idea Pad.')
      return sameOriginal
    }
    const accepted = edit({ ...current.current, ideas: [...current.current.ideas, clone(idea)] })
    if (accepted) setMessage('Original captured. Undo changes music or idea names/attachments, but never discards a captured original. Check the save indicator and download a project backup.')
    return accepted
  }
  const changeIdea = (id: string, patch: { name?: string; attachedTick?: number | null }) => {
    edit({ ...current.current, ideas: current.current.ideas.map(idea => idea.id === id ? { ...idea, ...patch } : idea) })
  }
  const copyIdea = (id: string) => {
    try {
      const idea = current.current.ideas.find(item => item.id === id)
      if (!selectedTrack || !isMelodicSound(selectedTrack.soundId) || !selectedPattern || idea?.original.kind !== 'midi') throw new Error('Select a melodic track and part before copying keyboard notes.')
      const copied = patternNotes(ideaToNotes(idea.original, current.current.bpm, selectedBar * 1920))
      if (edit(updatePatternNotes(current.current, selectedPattern.id, [...selectedPattern.notes, ...copied]))) setMessage('Copied your performance into the selected part without snapping. Its original remains in the Idea Pad.')
    }
    catch (error) { setMessage(failure(error)) }
  }
  const startRecord = async (linkedChoice?: 'independent' | 'linked') => {
    if (switching.current) return
    if (ideaPad.current?.isCapturing()) { revealIdeaPad(); setMessage('Finish the Idea Pad capture before recording into the song.'); return }
    if (record.current || preparingRecord.current) { stop(); return }
    if (!selectedTrack || !isMelodicSound(selectedTrack.soundId) || !selectedPattern || !selectedClip) { setMessage('Select a placed melodic part before recording. Add an instrument or place a part in the Playlist.'); return }
    if (!linkedChoice && project.clips.filter(clip => clip.patternId === selectedPattern.id).length > 1) { recordOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setLinkedRecording(true); return }
    setLinkedRecording(false)
    if ((take.current.length || takeOriginal.current?.events.length) && !window.confirm('Discard the unkept recording and try again?')) return
    stop(); take.current = []; takeOriginal.current = null; setHasTake(false)
    if (linkedChoice === 'independent' && !edit(makeIndependent(current.current, selectedClip.id))) return
    const frozen = clone(current.current), targetClip = frozen.clips.find(clip => clip.id === selectedClip.id)!, targetPattern = frozen.patterns.find(pattern => pattern.id === targetClip.patternId)!
    const token = run.current
    const controller = new AbortController(); preparation.current = controller
    setPinnedDevice(midi.state.selectedDeviceId ?? null)
    preparingRecord.current = true; setRecording(true); setRecordPreparing(true); setMessage(`Preparing recording into ${selectedTrack.name} / ${selectedPattern.name}… Press Stop to cancel loading.`)
    try {
      const populated = new Set(compileArrangement(frozen).map(note => note.trackId))
      const audible = frozen.tracks.filter(track => populated.has(track.id) && !track.muted && track.level > 0 && (!soloTracks.length || soloTracks.includes(track.id))).map(track => track.id)
      await audio.prepareTracks(frozen, [...new Set([...audible, selectedTrack.id])], controller.signal, true)
      if (switching.current || token !== run.current) return
      const beat = 60 / current.current.bpm, start = audio.time + .15
      const destinationView = noteView(frozen, targetClip.id, editingViewsCurrent.current)
      const localStart = Math.min(targetPattern.lengthTicks - 1, destinationView.cursor), songStart = targetClip.startTick + localStart
      const countIn = countInSchedule(frozen, songStart, metronomeSettings.countInBars)
      const deadline = start + countIn.durationTicks / 480 * beat
      takeDestination.current = { trackId: selectedTrack.id, patternId: targetPattern.id }
      record.current = { ...takeDestination.current, start: deadline, startTick: localStart, bpm: frozen.bpm, original: { startedAtMs: inputClockNow() + (deadline - audio.time) * 1000, events: [] } }
      const maxDuration = Math.min(60, (256 * 1920 - songStart) * 60 / frozen.bpm / 480)
      const backing = { ...frozen, bars: Math.max(frozen.bars, Math.min(256, Math.ceil((songStart + maxDuration * frozen.bpm * 480 / 60) / 1920))) }
      await audio.play(backing, tick => { if (token === run.current) { playbackPosition.current = tick; setPlayhead(tick) } }, () => {}, { startTick: songStart, startAt: deadline, metronome, metronomeSettings, live: false })
      if (token !== run.current) return
      setRecordPreparing(false); setRecording(true); setCounting(countIn.pulses.length); setMessage(`Recording into ${selectedTrack.name} / ${selectedPattern.name}, part bar ${Math.floor(localStart / 1920) + 1}. Play after the count-in; Stop when finished.`)
      observe('record-started')
      for (const pulse of countIn.pulses) audio.click(start + pulse.tick / 480 * beat, { volume: metronomeSettings.volume, accent: metronomeSettings.accent && pulse.accent })
      const timer = window.setInterval(() => {
        if (token !== run.current || !record.current) { window.clearInterval(timer); return }
        const remaining = record.current.start - audio.time
        setCounting(remaining > 0 ? Math.ceil(remaining / (countIn.pulseTicks / 480 * beat)) : 0)
        if (remaining <= 0) setPlayhead(songStart - remaining * frozen.bpm * 480 / 60)
        if (-remaining >= maxDuration) { window.clearInterval(timer); stop(); setMessage('Studio capture reached its duration/song boundary. Keep this original and its editable notes, then record another take to continue.') }
      }, 50)
    } catch (error) { if (token === run.current) { stop(); setMessage(failure(error)) } }
    finally { if (token === run.current) preparingRecord.current = false }
  }
  const keep = () => {
    if (switching.current) return
    const original = takeOriginal.current
    if (!take.current.length && !original?.events.length) return
    try {
      const target = current.current.patterns.find(pattern => pattern.id === takeDestination.current?.patternId && pattern.trackId === takeDestination.current?.trackId)
      if (!target) throw new Error('The recording destination is unavailable. Download the unkept original before discarding.')
      const idea = original?.events.length ? createMidiIdea(original.events, original.durationMs, 'Original studio performance') : null
      const next = updatePatternNotes(current.current, target.id, [...target.notes, ...patternNotes(clone(take.current))])
      if (idea) next.ideas = [...next.ideas, idea]
      if (!validateProject(next)) { setMessage('This recording exceeds this browser project’s note/capture limits. Use Download unkept original (.json) to preserve its exact events before closing or discarding. Your unkept original and notes remain here.'); return }
      if (!edit(next, true)) return
      take.current = []; takeOriginal.current = null; setHasTake(false)
      setMessage('Original performance kept in the Idea Pad alongside editable studio notes. Undo removes the note copy, not the original capture.')
    } catch (error) { setMessage(`${failure(error)} The unkept performance remains here. Use Download unkept original (.json) before closing or discarding.`) }
  }
  const downloadUnkeptOriginal = () => {
    const original = takeOriginal.current
    if (!original) { setMessage('Stop the studio recording before downloading its original events.'); return }
    // Recovery is independent of project limits and schema validation: preserve
    // exactly the captured payload even when it cannot be added to the project.
    download(new TextEncoder().encode(JSON.stringify(original, null, 2)), 'NADI-unkept-original.midi-capture.json', 'application/json')
    setMessage('Downloaded the exact unkept original events (.json). The take remains here until you Keep or Discard it. This recovery file is not a .nadi project or a standard MIDI file.')
  }
  const history = (direction: 'undo' | 'redo') => {
    if (switching.current) return
    if (preparingRecord.current || record.current || take.current.length || takeOriginal.current?.events.length) { setMessage('Keep or Discard the recording before Undo/Redo.'); return }
    try {
      const next = sessionHistory[direction](current.current)
      if (!next) return
      const changedArrangement = JSON.stringify([next.tracks, next.patterns, next.clips, next.bpm, next.bars, next.notation]) !== JSON.stringify([current.current.tracks, current.current.patterns, current.current.clips, current.current.bpm, current.current.bars, current.current.notation])
      if (changedArrangement && !audio.updateSong(next)) stop()
      install(next); write(clone(next)); setHistoryAvailable(sessionHistory.availability)
      observeMira(direction, sessionHistory.lastTravel?.context ?? {})
      setFeedbackId(null)
      const command = sessionHistory.lastTravel, context = command?.context
      if (context?.trackId && next.tracks.some(track => track.id === context.trackId)) chooseDestination(context.trackId, next.clips.some(clip => clip.id === context.clipId) ? context.clipId : undefined)
      if (context?.panel === 'arrangement' && command?.affectedIds) setSelectedClipIds(command.affectedIds.filter(id => next.clips.some(clip => clip.id === id)))
      if (context?.panel) workspaceHandle.current?.openPanel(context.panel)
      if (context?.noteIds) { const restoredClip = next.clips.find(item => item.id === context.clipId); if (restoredClip) setRestoreSelection({ sequence: ++actionSequence.current, ids: context.noteIds, patternId: restoredClip.patternId, projectId: next.id }) }
      setMessage(`${direction === 'undo' ? 'Undid' : 'Redid'}: ${command?.label ?? 'edit'}`)
    } catch (error) { setMessage(failure(error)) }
  }
  const safeSwitch = async () => {
    if (ideaPad.current?.isDirty()) { revealIdeaPad(); setMessage('Keep or download the Idea Pad draft and stop/finalize any active capture before switching projects. Your current project stays open.'); return false }
    if ((record.current || take.current.length || takeOriginal.current?.events.length) && !window.confirm('Discard this unkept recording before switching projects?')) return false
    stop(); await queue.current
    if (ideaPad.current?.isDirty()) { revealIdeaPad(); setMessage('A new Idea Pad capture or draft started while saving. Stop and keep it before switching; this project stays open.'); return false }
    if (saveFault.current && !window.confirm('Your current project is not saved. Download a .nadi copy before leaving. Leave it anyway?')) return false
    return true
  }
  const switchTo = async (next: CreationProject, persisted: boolean) => {
    if (ideaPad.current?.isDirty()) { revealIdeaPad(); setMessage('Keep/finalize the Idea Pad draft before switching projects.'); return false }
    if (persisted) {
      try { await store.activate(next.id, next.revision) }
      catch (error) { setMessage(`Could not open that project: ${failure(error)} Your current work and any unkept take are still open.`); return false }
      if (ideaPad.current?.isDirty()) {
        // A permission request or draft can begin while IndexedDB activation is
        // pending. Keep this mounted panel and restore the current active marker.
        await queue.current
        try {
          if (!expected.current.has(current.current.id)) { write(clone(current.current)); await queue.current }
          if (!saveFault.current) await store.activate(current.current.id, current.current.revision)
        } catch (error) { saveFault.current = true; setSaved('Not saved'); setMessage(`${failure(error)} Download this project and any draft originals before closing.`); return false }
        revealIdeaPad(); setMessage('Capture started while opening the other project. Your current studio and draft remain open; stop/keep the capture before switching.'); return false
      }
    }
    saveFault.current = false; sessionHistory.clear(); setRestoreSelection(undefined); setFeedbackId(null); setHistoryAvailable(sessionHistory.availability)
    audio.setSolo([]); setSoloTracks([]); setSelectedClipIds(undefined); setSelectedClipId(''); setSelectedTrackId(''); setPaused(false); setCursorTick(0); setNoteCursorTick(0); setRangeEnabled(false); setRememberedDestination({})
    const emptyViews = emptyEditingViews(); editingViewsCurrent.current = emptyViews; setEditingViews(emptyViews); setDrumView(emptyViews.drums); setLoopOwner(undefined); setLoopBar(false)
    if (persisted) expected.current.set(next.id, next.revision)
    take.current = []; takeOriginal.current = null; setHasTake(false)
    install(next); setSelectedBar(0); setPlayhead(0); setSaved(persisted ? 'Saved' : 'Not saved yet'); setProjects(null)
    setObservedAction(null); observeMira('project-opened')
    setMessage('Your project is open. Ask Mira is always available.')
    if (!persisted) write(clone(next))
    return true
  }
  const withSwitchLock = async (operation: () => Promise<void>) => {
    if (switching.current) return
    // Reject before input is paused: an existing free-time capture must keep
    // receiving its exact events even when an import file takes time to read.
    if (ideaPad.current?.isDirty()) { revealIdeaPad(); setMessage('Keep or download the Idea Pad draft and stop/finalize any active capture before switching projects. Your capture continues in this project.'); return }
    switching.current = true; setSwitchPending(true)
    // Finish any live take before asynchronous file reads or storage waits; the
    // lock must never leave a recording running while incoming MIDI is paused.
    try { stop(); await operation() }
    catch (error) { setMessage(`Could not switch projects: ${failure(error)} Your current work remains open.`) }
    finally { switching.current = false; setSwitchPending(false) }
  }
  const newProject = () => withSwitchLock(async () => { if (await safeSwitch()) await switchTo(createProject(), false) })
  const beginSharedSwitch = async () => {
    if (switching.current || record.current || preparingRecord.current || take.current.length || takeOriginal.current?.events.length || ideaPad.current?.isDirty()) throw new Error('Finish and keep your recording or Idea Pad draft before changing shared projects.')
    switching.current = true; setSwitchPending(true); stop()
    await queue.current
    if (saveFault.current) throw new Error('Download a project backup and resolve the local save problem before changing shared projects.')
  }
  const endSharedSwitch = () => { switching.current = false; setSwitchPending(false) }
  const openSharedProject = async (next: CreationProject) => { if (!await switchTo(next, true)) throw new Error('The shared project is saved, but could not be opened. Your current work is retained.') }
  const newSirensStudy = () => withSwitchLock(async () => {
    if (!await safeSwitch()) return
    if (await switchTo(createSirensStudy(), false)) {
      workspaceHandle.current?.resetLayout()
      setMessage('Blank Sirens study ready. 120 BPM / 80 bars are provisional working-grid defaults, not the original tempo or structure. Sounds are approximations; enter your own notes. Record in sections (60 seconds per take).')
    }
  })
  const openProject = (next: CreationProject) => withSwitchLock(async () => { if (await safeSwitch()) await switchTo(next, true) })
  const importProject = async (file: File) => {
    await withSwitchLock(async () => {
      try {
      if (file.size > 16 * 1024 * 1024) throw new Error('This .nadi file is too large for this prototype (16 MB maximum).')
      const recovered = decodeRecovery(new Uint8Array(await file.arrayBuffer()))
      if (recovered.kind === 'original') {
        if (take.current.length || takeOriginal.current?.events.length) { setMessage('Keep or discard your take before importing another original.'); return }
        const idea = createMidiIdea(recovered.original.events, recovered.original.durationMs, 'Recovered performance')
        // Explicit recovery attaches the performance as a reference, never as composition notes.
        switching.current = false
        try { if (captureIdea(idea)) { revealIdeaPad(); setMessage('Recovered the raw performance into Idea Pad. Your composition was not changed.') } }
        finally { switching.current = true }
        return
      }
      const parsed = recovered.project
      if (!await safeSwitch()) return
      // Open as a new local copy: imported IDs cannot overwrite an existing project.
      const next = { ...parsed, id: createProject().id, revision: 0 }
      if (recovered.preUpgradeRaw !== undefined) importedRecovery.current.set(next.id, recovered.preUpgradeRaw)
      if (await switchTo(next, false)) setMessage('Opened an editable copy of your .nadi project. The original local project was not overwritten.')
      else importedRecovery.current.delete(next.id)
      } catch (error) { setMessage(`Could not open that file: ${failure(error)} Your current project is unchanged.`) }
    })
  }
  const exportFile = async (kind: 'nadi' | 'midi' | 'wav') => {
    if (exporting) return
    const snapshot = clone(current.current), stem = snapshot.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'My song'
    try {
      if (kind === 'nadi') { download(packProject(snapshot), `${stem}.nadi`, 'application/zip'); observe('project-exported'); setMessage('Downloaded your editable project with kept Idea Pad originals. Open .nadi brings it back. Unsaved drafts and unkept studio recordings are not included: download draft originals separately.'); return }
      if (kind === 'midi') { download(creationMidi(snapshot), `${stem}.mid`, 'audio/midi'); observe('project-exported'); setMessage('MIDI exported: editable notes and drum mapping. Choose instruments after importing in FL Studio; sounds and effects are not included.'); return }
      setExporting(true); setMessage('Rendering studio instrument notes to WAV… Idea Pad microphone originals are references only and are not mixed into this export. You can continue editing; this export uses a fixed snapshot.')
      const result = await audio.wav(snapshot, rangeEnabled ? { startTick: (rangeStart - 1) * 1920, endTick: Math.min(snapshot.bars * 1920, rangeEnd * 1920) } : undefined); download(result.bytes, `${stem}.wav`, 'audio/wav')
      if (current.current.id === snapshot.id) observe('project-exported')
      setMessage(`WAV downloaded from revision ${snapshot.revision}: studio instrument notes only; Idea Pad microphone originals are not included. Master sample peak: ${result.peak.toFixed(3)}${result.peak > 1 ? ' — clipping detected; lower track volumes before exporting again.' : '.'}`)
    } catch (error) { setMessage(failure(error)) } finally { setExporting(false) }
  }
  const blockSwitchInteraction = (event: SyntheticEvent) => {
    if (switching.current) { event.preventDefault(); event.stopPropagation() }
  }
  const customizeWorkspace = () => {
    if (preparingRecord.current || record.current || ideaPad.current?.isCapturing()) { setMessage('Stop and keep your active recording before customizing the workspace. Your recording is still running.'); return }
    setupOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stop(); setupActive.current = true; setSetupOpen(true)
  }
  const previewNote = (note: Note) => {
    if (!previewEnabled || switching.current || setupActive.current) return
    if (selectedTrack) void audio.previewNote(note, selectedTrack.id).then(() => setAudioLabel(audio.label)).catch(error => setMessage(failure(error)))
  }
  const editProjection = (next: LegacyProject) => {
    if (next.revision !== current.current.revision) { setMessage('The project changed during that edit. Please try again.'); return }
    try {
      edit(applyEditorProjection(current.current, selectedPattern?.id, projection, next))
    } catch (error) { setMessage(failure(error)) }
  }
  const chooseDestination = (trackId: string, clipId?: string) => {
    audio.silenceKeys(); inputPitch.current.clear(); screenHeld.current.clear(); liveOccurrences.allNotesOff(); setActiveNotes([])
    const track = current.current.tracks.find(item => item.id === trackId)
    const destinationClip = clipId ?? current.current.clips.find(clip => clip.trackId === trackId)?.id
    if (track) setRememberedDestination(previous => ({ ...previous, [isMelodicSound(track.soundId) ? 'piano' : 'drums']: { trackId, clipId: destinationClip } }))
    if (loopBar && loopOwner?.panel === 'notes' && track && isMelodicSound(track.soundId) && destinationClip && destinationClip !== loopOwner.clipId) {
      if (playing) stop()
      setLoopOwner({ panel: 'notes', clipId: destinationClip }); setPaused(false); setMessage('Loop destination changed. Press Play to hear the new shown range.')
    }
    const restored = noteView(current.current, destinationClip, editingViewsCurrent.current)
    setSelectedTrackId(trackId); setSelectedClipId(destinationClip ?? ''); setSelectedBar(restored.bar); setNoteCursorTick(restored.cursor); setVisibleBars(restored.visible)
    setSelectedClipIds(destinationClip ? [destinationClip] : [])
  }
  const lastInstrumentAdd = useRef<{ soundId: SoundId; trackId: string; at: number } | null>(null)
  const workbenchAction = (action: WorkbenchAction) => {
    if (switching.current || setupActive.current || preparingRecord.current || record.current || hasTake) { setMessage('Keep or Discard your recording before changing tracks or parts.'); return }
    const before = current.current
    try {
      if (action.type === 'track-add' && lastInstrumentAdd.current?.soundId === action.soundId
        && inputClockNow() - lastInstrumentAdd.current.at < 650
        && before.tracks.some(track => track.id === lastInstrumentAdd.current!.trackId)) {
        chooseDestination(lastInstrumentAdd.current.trackId)
        return
      }
      if (action.type === 'track-select') { chooseDestination(action.trackId); observeMira(action.type, { trackId: action.trackId }); return }
      if (action.type === 'clip-select') { const clip = before.clips.find(item => item.id === action.clipId); if (clip) { chooseDestination(clip.trackId, clip.id); observeMira(action.type, { trackId: clip.trackId, clipId: clip.id }) } return }
      if (action.type === 'clips-select') { const clip = before.clips.find(item => item.id === action.primary); if (clip) { chooseDestination(clip.trackId, clip.id); observeMira('clip-select') } setSelectedClipIds(action.clipIds); return }
      let next: CreationProject
      switch (action.type) {
        case 'track-add': next = addTrack(before, action.soundId); break
        case 'track-update': next = { ...before, tracks: before.tracks.map(track => track.id === action.trackId ? { ...track, ...action.patch } : track) }; break
        case 'track-production': next = updateTrackProduction(before, action.trackId, action.patch); break
        case 'track-delete': next = deleteTrack(before, action.trackId); break
        case 'pattern-create': next = addPattern(before, action.trackId, action.startTick); break
        case 'pattern-rename': next = { ...before, patterns: before.patterns.map(pattern => pattern.id === action.patternId ? { ...pattern, name: action.name } : pattern) }; break
        case 'clip-place': next = placePattern(before, action.patternId, action.startTick, true); break
        case 'clip-move': next = moveClip(before, action.clipId, action.startTick); break
        case 'clip-duplicate': next = duplicateClip(before, action.clipId, action.linked); break
        case 'clip-independent': next = makeIndependent(before, action.clipId); break
        case 'clip-delete': next = deleteClip(before, action.clipId); break
        case 'clip-paste': next = pastePattern(before, action.trackId, action.pattern, action.startTick); break
        case 'clips-move': next = moveClips(before, action.clipIds, action.deltaTicks); break
        case 'clips-delete': next = deleteClips(before, action.clipIds); break
        case 'clips-duplicate': next = duplicateClips(before, action.clipIds); break
        case 'clips-paste': next = pasteClips(before, action.clipboard, action.startTick); break
      }
      const description = describeWorkbenchAction(action, before, next)
      if (edit(next, false, description)) {
        const destination = description.context
        const added = next.clips.find(clip => !before.clips.some(old => old.id === clip.id))
        const resultDestination = added ? { trackId: added.trackId, clipId: added.id } : undefined
        const duplicateSource = action.type === 'clip-duplicate' ? before.clips.find(clip => clip.id === action.clipId)
          : action.type === 'clips-duplicate' && action.clipIds.length === 1 ? before.clips.find(clip => clip.id === action.clipIds[0]) : undefined
        const duplicateDestination = duplicateSource ? { trackId: duplicateSource.trackId, clipId: duplicateSource.id } : {}
        if (action.type === 'clip-duplicate') observeMira(action.linked ? 'clip-repeated-linked' : 'clip-duplicated-independent', duplicateDestination, resultDestination)
        else if (action.type === 'clips-duplicate') observeMira('clips-duplicate', duplicateDestination, resultDestination)
        else if (action.type === 'track-update') { const old = before.tracks.find(track => track.id === action.trackId); if (action.patch.soundId && action.patch.soundId !== old?.soundId) observeMira('sound-changed', { trackId: action.trackId }) }
        else if (action.type === 'track-production') observeMira(action.patch.expression !== undefined ? 'expression-changed' : action.patch.pan !== undefined ? 'pan-changed' : 'space-changed', { trackId: action.trackId })
        else observeMira(action.type.replace('clips-', 'clip-'), destination, resultDestination)
        if (added) { chooseDestination(added.trackId, added.id); setSelectedClipIds(next.clips.filter(clip => !before.clips.some(old => old.id === clip.id)).map(clip => clip.id)) }
        if (action.type === 'track-add' && added) {
          const track = next.tracks.find(item => item.id === added.trackId)!
          lastInstrumentAdd.current = { soundId: action.soundId, trackId: track.id, at: inputClockNow() }
          workspaceHandle.current?.openPanel(isMelodicSound(track.soundId) ? 'notes' : 'drums')
          setMessage(`${track.name} added and selected. Your keyboard now plays this instrument.`)
        }
        const sounding = new Set(compileArrangement(next).map(note => note.trackId))
        const unavailable = next.tracks.find(track => sounding.has(track.id) && !track.muted && track.level > 0 && (!soloTracks.length || soloTracks.includes(track.id)) && isSampledSound(track.soundId) && audio.soundStatus(track.soundId) !== 'ready')
        if (playing && unavailable) setMessage(`Playback stopped: ${unavailable.name} needs its sound. Press Play to retry.`)
      }
    } catch (error) { setMessage(failure(error)) }
  }
  const previewSound = (soundId: SoundId) => {
    setMessage(`Preparing ${SOUND_LABELS[soundId]} preview…`)
    void audio.previewSound(soundId).then(() => setMessage(`${SOUND_LABELS[soundId]} preview started. If silent, check your output volume and browser audio.`))
      .catch(error => setMessage(failure(error)))
  }
  const chooseDrumClip = (clipId: string) => {
    const songBar = editingViewsCurrent.current.drums.bar
    const destination = current.current.clips.find(clip => clip.id === clipId)
    workbenchAction({ type: 'clip-select', clipId })
    if (destination) setSelectedBar(Math.max(0, songBar - Math.floor(destination.startTick / 1920)))
  }
  const changeNoteView = (clipId: string | undefined, patch: Partial<NotesPanelView>) => {
    if (recording || recordPreparing || hasTake) return
    const before = noteView(current.current, clipId, editingViewsCurrent.current)
    const next = patchNoteView(current.current, clipId, editingViewsCurrent.current, patch)
    const after = noteView(current.current, clipId, next)
    const rangeChanged = before.visible !== after.visible || Math.floor(before.bar / before.visible) !== Math.floor(after.bar / after.visible)
    if (rangeChanged && loopBar && loopOwner?.panel === 'notes' && loopOwner.clipId === clipId) { if (playing) stop(); setPaused(false); setMessage('Shown Notes range changed. Press Play to loop this range.') }
    editingViewsCurrent.current = next; setEditingViews(next)
    setSelectedBar(after.bar); setNoteCursorTick(after.cursor); setVisibleBars(after.visible)
  }
  const changeDrumView = (bar: number, visible: 1 | 2 | 4) => {
    if (recording || recordPreparing || hasTake) return
    if (loopBar && loopOwner?.panel === 'drums' && (bar !== drumView.bar || visible !== drumView.visible)) { if (playing) stop(); setPaused(false); setMessage('Shown Drums range changed. Press Play to loop this range.') }
    const next = { ...editingViewsCurrent.current, drums: { bar, visible } }
    editingViewsCurrent.current = next; setEditingViews(next); setDrumView({ bar, visible })
  }
  const retrySound = (soundId: SoundId) => { void audio.retrySound(soundId).then(() => { setAudioLabel(audio.label); observeMira('sound-retried') }).catch(error => setMessage(failure(error))) }
  const recoveryDownload = async () => {
    try { const copy = await store.recoveryCopy(current.current.id); if (!copy) { setMessage('This project has no pre-upgrade copy. A recovery copy is created when a stored project is upgraded.'); return }
      download(new TextEncoder().encode(JSON.stringify(copy)), 'NADI-pre-upgrade-project.json', 'application/json')
      setMessage('Downloaded the exact pre-upgrade recovery project. Your current music is unchanged.')
    } catch (error) { setMessage(failure(error)) }
  }
  if (!ready) return <main className="storage-loading">Opening your studio without changing earlier lesson saves…</main>
  const workbench = { project, selectedTrackId: selectedTrack?.id ?? null, selectedClipId: selectedClip?.id ?? null, selectedClipIds, onAction: workbenchAction, disabled: recording || recordPreparing || hasTake || setupOpen }
  const effectiveWorkspace = focusedEditor ? { ...workspace, browser: false, mira: false, playlist: false, mixer: false, keyboard: false } : workspace
  const toggleSolo = (trackId: string) => { if (recording) return; const next = soloTracks.includes(trackId) ? soloTracks.filter(id => id !== trackId) : [...soloTracks, trackId]; const continued = audio.setSolo(next); setSoloTracks(next); if (!continued) { stop(); setMessage('Sound needs loading. Press Play or Retry sound. Your music is unchanged.') } }
  const continueClean = async (next: CreationProject) => { let opened = false; await withSwitchLock(async () => { if (!await safeSwitch()) return; if (!expected.current.has(current.current.id)) { write(clone(current.current)); await queue.current } if (saveFault.current) { setMessage('Save the source project successfully before continuing in a clean copy.'); return } opened = await switchTo(next, false) }); return opened }
  const editor = !selectedTrack || isMelodicSound(selectedTrack.soundId) ? 'piano' : 'drums'
  const pianoTrack = selectedTrack && isMelodicSound(selectedTrack.soundId) ? selectedTrack : project.tracks.find(track => track.id === rememberedDestination.piano?.trackId && isMelodicSound(track.soundId)) ?? project.tracks.find(track => isMelodicSound(track.soundId))
  const pianoClip = project.clips.find(clip => clip.id === (pianoTrack?.id === selectedTrack?.id ? selectedClip?.id : rememberedDestination.piano?.clipId) && clip.trackId === pianoTrack?.id) ?? project.clips.find(clip => clip.trackId === pianoTrack?.id)
  const pianoWorkbench = { ...workbench, selectedTrackId: pianoTrack?.id ?? null, selectedClipId: pianoClip?.id ?? null, onRepeated: (destination: { trackId: string; clipId: string }) => observeMira('bar-duplicated', destination) }
  const pianoView = noteView(project, pianoClip?.id, editingViews)
  const pianoStart = Math.floor(pianoView.bar / pianoView.visible) * pianoView.visible
  const pianoBars = Math.ceil((project.patterns.find(part => part.id === pianoClip?.patternId)?.lengthTicks ?? 1920) / 1920)
  const notesView = <NotesPanel {...pianoWorkbench} onGuidanceAction={(type, destination) => observeMira(type, destination)} controlledView={pianoView} onViewChange={patch => changeNoteView(pianoClip?.id, patch)} onUiState={state => setNoteUi({ ...state, trackId: pianoTrack?.id, clipId: pianoClip?.id })} onRejected={() => { setFeedbackId(null); setLatestRejection('note') }} active={visiblePanels.includes('notes')} onPreviewSound={previewSound} onRetrySound={retrySound} soundStatus={soundStates} playhead={playhead} playing={playing || recording} previewEnabled={previewEnabled} onTogglePreview={() => { audio.stopPreview(); setPreviewEnabled(value => !value) }} onPreview={(note, trackId) => { void audio.previewNote(note, trackId).catch(error => setMessage(failure(error))) }} onMessage={setMessage} onUndo={() => history('undo')} onEdit={(next, description) => edit(next, false, description)} onPosition={(bar, tick, visible) => { if (!recording && !recordPreparing && !hasTake) { setSelectedBar(bar); setNoteCursorTick(tick); setVisibleBars(visible) } }} onActivate={() => { if (pianoTrack && selectedTrack?.id !== pianoTrack.id && !recording && !recordPreparing && !hasTake) chooseDestination(pianoTrack.id, pianoClip?.id) }} restoreSelection={restoreSelection?.projectId === project.id && restoreSelection.patternId === pianoClip?.patternId ? restoreSelection : undefined} />
  const drumsView = <div className="minimal-drums-panel"><CombinedDrums key={project.id} project={project} startBar={Math.min(drumView.bar, project.bars - 1)} visibleBars={Math.min(drumView.visible, project.bars - Math.min(drumView.bar, project.bars - 1))} zoomBars={drumView.visible} onNavigate={changeDrumView} onMakeIndependent={clipId => workbenchAction({ type: 'clip-independent', clipId })} selectedClipId={selectedTrack && !isMelodicSound(selectedTrack.soundId) ? selectedClip?.id ?? null : rememberedDestination.drums?.clipId ?? null} onSelectClip={chooseDrumClip} onEdit={(next, description) => applyEdit(next, false, description)} onRejected={() => { setFeedbackId(null); setLatestRejection('drum') }} onMessage={setMessage} onUndo={() => history('undo')} previewEnabled={previewEnabled} playhead={playhead} playing={playing || recording} disabled={recording || recordPreparing || hasTake || !visiblePanels.includes('drums')} onPreview={(note, trackId) => { if (previewEnabled) void audio.previewNote(note, trackId).catch(error => setMessage(failure(error))) }} /></div>
  return <><div className="nadi-account-strip"><FeedbackButton />
    <a className="nadi-work-link" href="#progress"><strong>{accountId ? 'My work & tutor feedback' : 'Sign in for tutor feedback'}</strong><small>Questions · progress · tutor comments</small><small role="status">{accountId ? `Shared with your tutor · ${syncState.status.replaceAll('-', ' ')}${syncState.lastSyncedAt ? ` · Last sync ${new Date(syncState.lastSyncedAt).toLocaleTimeString()}` : ''}` : 'Anonymous studio · saved on this browser'}</small></a>
    {syncState.message && <span className="nadi-sync-message" role="status">{syncState.message}</span>}
    <button className="nadi-score-link" type="button" disabled={recording || recordPreparing || anyIdeaCapture} onClick={() => { stop(); setShowScore(true) }}><span aria-hidden="true">♫</span> Sheet music <small>Full score · instrument parts · export</small></button>
    {store instanceof AccountStudioStore && trackingClient && <details className="nadi-account-tools"><summary>Account tools</summary><div><AccountSyncControls store={store} client={trackingClient} currentProject={project} beforeResolve={beginSharedSwitch} onResolveFinished={endSharedSwitch} onOpenRemote={openSharedProject} onForkLocal={openSharedProject} onMessage={setMessage} disabled={!ready || switchPending || recording || recordPreparing || hasTake || anyIdeaCapture} /><AccountImportControls store={store} beforeImport={beginSharedSwitch} onImportFinished={endSharedSwitch} onImported={openSharedProject} onMessage={setMessage} disabled={!ready || switchPending || recording || recordPreparing || hasTake || anyIdeaCapture} /></div></details>}
  </div><FirstBeatTutorial onReveal={target => workspaceHandle.current?.revealTarget(target)} project={project} disabled={recording || recordPreparing || hasTake || setupOpen || !ready} onOpen={panel => { changeDrumView(0, 1); workspaceHandle.current?.openPanel(panel) }} /><div className="studio-minimal" inert={switchPending || setupOpen || linkedRecording || projects !== null || undefined} aria-busy={switchPending} onClickCapture={blockSwitchInteraction} onPointerDownCapture={blockSwitchInteraction} onKeyDownCapture={blockSwitchInteraction} onInputCapture={blockSwitchInteraction} onChangeCapture={blockSwitchInteraction}><StudioWorkspace ref={workspaceHandle} onPanelActivate={panel => { setActiveHelpPanel(panel); if (panel === 'notes' || panel === 'drums') lastEditorPanel.current = panel }} notesContent={notesView} drumsContent={drumsView} onPanelVisibilityChange={panels => { setVisiblePanels(panels); if (!panels.includes('ideas')) { ideaPad.current?.pauseReference(); pauseMidiReference() } }} onMiraVisibilityChange={setMiraOpen} undoLabel={sessionHistory.undoCommand?.label} redoLabel={sessionHistory.redoCommand?.label} historyContent={<><p>Undo is for this session; reopening a project clears it.</p>{sessionHistory.recent.map(command => <div key={command.id}>{command.label}</div>)}</>} feedbackContent={message === sessionHistory.undoCommand?.label && feedbackId && feedbackId === sessionHistory.undoCommand?.id ? <button disabled={recording || recordPreparing || hasTake} onClick={() => { if (feedbackId === sessionHistory.undoCommand?.id) history('undo') }}>Undo</button> : null} recoveryContent={<RecoveryControls project={project} store={store} disabled={recording || hasTake || switchPending} onEdit={edit} onContinue={continueClean} onMessage={setMessage} />} project={projection} saved={saved} message={message}
    controlledEditor={editor} onEditorChange={mode => { if (mode === editor) return; const remembered = rememberedDestination[mode]; const target = project.tracks.find(track => track.id === remembered?.trackId && isMelodicSound(track.soundId) === (mode === 'piano')) ?? project.tracks.find(track => isMelodicSound(track.soundId) === (mode === 'piano')); if (target) { const clip = project.clips.find(item => item.id === remembered?.clipId && item.trackId === target.id); workbenchAction(clip ? { type: 'clip-select', clipId: clip.id } : { type: 'track-select', trackId: target.id }) } else setMessage('Add a matching instrument using Add instrument first.') }}
    onPause={pause}
    transportTick={playhead}
    recordingStatus={recordPreparing ? 'Preparing instrument sounds… Stop cancels. Count-in has not started.' : undefined}
    metronomeEnabled={metronome}
    projectDetails={<><strong>{project.name}</strong><span>{project.bars} bars · {project.tracks.length} {project.tracks.length === 1 ? 'instrument' : 'instruments'} · {project.patterns.length} {project.patterns.length === 1 ? 'part' : 'parts'}</span></>}
    onToggleMetronome={() => { stop(); setMetronome(value => !value) }}
    metronomeControls={<MetronomeControls project={project} enabled={metronome} settings={metronomeSettings} tick={playhead} active={playing || recording} disabled={recording || recordPreparing} onEnabled={value => { stop(); setMetronome(value) }} onSettings={value => { stop(); setMetronomeSettings(value) }} />}
    studioControls={<div className="studio-session-controls"><button type="button" aria-pressed={focusedEditor} onClick={() => workspaceHandle.current?.openPanel('notes')}>{focusedEditor ? 'Restore workspace' : 'Focus editor'}</button><label>Listen<select aria-label="Listening mode" disabled={recording} value={listenMode} onChange={event => { stop(); setPaused(false); setListenMode(event.target.value as 'song' | 'part') }}><option value="song">Song</option><option value="part">Selected part</option></select></label><label>MIDI input<select aria-label="MIDI input" value={midi.state.selectedDeviceId ?? ''} disabled={recording || ideaCapturing} onChange={event => midi.selectDevice(event.target.value)}>{!midi.state.devices.length && <option value="">No keyboard connected</option>}{midi.state.devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
      <ExternalMidiSettings key={project.id} tracks={project.tracks} disabled={!ready || recording || recordPreparing || hasTake || ideaCapturing} onRouteChange={setExternalMidiRoute} />
      <details><summary>Playback / WAV range</summary><div className="studio-range"><label><input type="checkbox" checked={rangeEnabled} disabled={recording} onChange={event => { stop(); setRangeEnabled(event.target.checked) }} />Use range for song playback and WAV</label><label>First bar<NumericDraft label="Range first bar" value={rangeStart} min={1} max={Math.min(rangeEnd, project.bars)} integer disabled={recording} onCommit={value => { stop(); setRangeStart(value) }} /></label><label>Last bar<NumericDraft label="Range last bar" value={rangeEnd} min={rangeStart} max={project.bars} integer disabled={recording} onCommit={value => { stop(); setRangeEnd(value) }} /></label><p>Sustaining notes and release tails are preserved. MIDI and .nadi keep the whole song. WAV uses saved volume/Mute, not temporary Solo.</p></div></details></div>}
    trackControls={<span className="sw-record-destination" data-help-target="record-destination">Record to: <strong>{selectedTrack?.name ?? 'Choose a track'}</strong>{selectedPattern ? ` · ${selectedPattern.name}` : ' · Choose a placed part'}</span>}
    arrangementContent={<PatternPlaylist {...workbench} active={visiblePanels.includes('arrangement')} onEditClip={id => { const clip = project.clips.find(item => item.id === id); const track = project.tracks.find(item => item.id === clip?.trackId); workspaceHandle.current?.openPanel(track && isMelodicSound(track.soundId) ? 'notes' : 'drums') }} playhead={playhead} playing={playing || recording} onSeek={seek} />}
    mixerContent={<TrackMixer {...workbench} active={visiblePanels.includes('mixer')} soloTracks={soloTracks} onSolo={toggleSolo} meters={meters} onPreviewLevel={(trackId, level) => audio.setProject({ ...current.current, tracks: current.current.tracks.map(track => track.id === trackId ? { ...track, level } : track) })} onPreviewProduction={(trackId, patch) => audio.setProject({ ...current.current, tracks: current.current.tracks.map(track => track.id === trackId ? { ...track, ...patch } : track) })} />}
    soundBrowserContent={<><TrackControls {...workbench} hideAdd /><SoundBrowser {...workbench} onPreviewSound={previewSound} onRetrySound={retrySound} soundStatus={soundStates} /></>}

    barActionsContent={editor === 'drums' ? <div className="bar-actions">Each row edits its named part. Use Playlist to repeat a complete drum part independently.</div> : undefined}
    customMira={<StudioMira onArchiveExchange={store instanceof AccountStudioStore ? exchange => store.archiveExchange(exchange) : undefined} key={project.id} audioContext={{ soundReadiness: selectedTrack ? (() => { const status = audio.soundStatus(selectedTrack.soundId); return status === 'idle' ? 'unknown' : status === 'fallback' ? 'error' : status })() : 'unknown', playback: playing ? 'playing' : paused ? 'paused' : 'stopped', recording: recording || recordPreparing || hasTake || ideaCapturing || anyIdeaCapture }} passageContext={pianoTrack && pianoClip ? { trackId: pianoTrack.id, clipId: pianoClip.id, selectedNoteIds: noteUi.trackId === pianoTrack.id && noteUi.clipId === pianoClip.id ? noteUi.selectedIds ?? [] : [], shownRange: { startTick: pianoStart * 1920, endTick: Math.min(pianoBars, pianoStart + pianoView.visible) * 1920 } } : undefined} uiContext={{ activePanel: activeHelpPanel, noteSelection: activeHelpPanel === 'notes' ? noteUi.selectedCount > 1 ? 'multiple' : noteUi.selectedCount ? 'one' : 'none' : 'unknown', activeTool: activeHelpPanel === 'notes' ? noteUi.tool : 'unknown', latestRejection, shownBars: activeHelpPanel === 'notes' ? pianoView.visible : activeHelpPanel === 'drums' ? drumView.visible : 0 }} observedAction={observedMiraAction ?? undefined} canUndo={historyAvailable.undo} saved={saved === 'Saved'} open={miraOpen} onClose={() => workspaceHandle.current?.setMiraOpen(false)} project={project} selectedTrackId={selectedTrack?.id} selectedClipId={selectedClip?.id} onRevealTarget={(target, destination) => {
      if (setupActive.current) return
      if (target === 'make-independent' && selectedTrack && !isMelodicSound(selectedTrack.soundId) && selectedClip) {
        const shown = editingViewsCurrent.current.drums
        const part = current.current.patterns.find(item => item.id === selectedClip.patternId)
        if (selectedClip.startTick >= (shown.bar + shown.visible) * 1920 || selectedClip.startTick + (part?.lengthTicks ?? 0) <= shown.bar * 1920) changeDrumView(Math.floor(selectedClip.startTick / 1920), shown.visible)
      }
      workspaceHandle.current?.revealTarget(target, { ...destination, ...(target === 'make-independent' ? { panel: selectedTrack && !isMelodicSound(selectedTrack.soundId) ? 'drums' as const : 'notes' as const } : {}) })
      


      if (target === 'open-projects') { const details = document.querySelector<HTMLDetailsElement>('.file-menu'); if (details) details.open = true }
      // StudioWorkspace reveals only the target's visible panel. Do not open
      // hidden Notes menus while Mira is navigating to Sounds.
    }} />}
    workspace={effectiveWorkspace} onWorkspaceChange={patch => { setFocusedEditor(false); changeWorkspace(patch) }} onCustomizeWorkspace={customizeWorkspace} workspaceSetupOpen={setupOpen}
    startBar={pianoStart} visibleBars={Math.min(pianoView.visible, pianoBars - pianoStart)} zoomBars={pianoView.visible} onZoomBars={value => changeNoteView(pianoClip?.id, { visible: value })}
    previewEnabled={previewEnabled} onPreviewNote={previewNote} onTogglePreview={() => { audio.stopPreview(); setPreviewEnabled(value => !value) }}
    playing={playing} playhead={playhead} activeNotes={activeNotes} recording={recording} counting={counting}
    loopBar={loopBar} onToggleLoopBar={() => { stop(); setPaused(false); const enabling = !loopBar; const owner: LoopOwner = lastEditorPanel.current === 'drums' ? { panel: 'drums' } : { panel: 'notes', clipId: pianoClip?.id ?? '' }; if (enabling && owner.panel === 'notes' && !owner.clipId) { setMessage('Choose a placed Notes part before looping it.'); return } setLoopOwner(enabling ? owner : undefined); setLoopBar(enabling); setMessage(enabling ? 'Loop follows the selected editor range. Press Play to listen.' : 'Loop off. Press Play to hear your song.') }}
    midiLabel={midi.state.deviceName ? `MIDI: ${midi.state.deviceName}` : midi.state.message.replace(/Rescan|rescan/g, 'Connect MIDI')} audioLabel={audioLabel}
    canUndo={historyAvailable.undo && !recording && !recordPreparing && !hasTake} canRedo={historyAvailable.redo && !recording && !recordPreparing && !hasTake} onEdit={editProjection}
    onPlay={() => void play()} onStop={() => { const wasRecording = !!record.current || preparingRecord.current; stop(); setPaused(false); const start = chosenStart(); setPlayhead(start); playbackPosition.current = start; if (!wasRecording) setMessage('Stopped.') }} onUndo={() => history('undo')} onRedo={() => history('redo')}
    onNoteOn={pitch => { if (switching.current || setupActive.current || screenHeld.current.has(pitch)) return; captureInput({ type: 'note-on', pitch, velocity: 90, channel: 0, source: 'screen' }, inputClockNow()); screenHeld.current.add(pitch); press(`screen:${pitch}`, pitch) }} onNoteOff={pitch => { if (!screenHeld.current.delete(pitch)) return; captureInput({ type: 'note-off', pitch, velocity: 0, channel: 0, source: 'screen' }, inputClockNow()); release(`screen:${pitch}`) }}
    onRecord={() => void startRecord()} onKeep={keep}
    onDiscard={() => { if (switching.current) return; stop(); take.current = []; takeOriginal.current = null; setHasTake(false); setMessage('Unkept take discarded. Your saved song and kept original captures are unchanged.') }}
    onDownloadUnkeptOriginal={downloadUnkeptOriginal}
    hasTake={hasTake} onDownload={() => void exportFile('nadi')}
    ideaPadOpen={ideaPadOpen && !focusedEditor} onToggleIdeaPad={() => { setFocusedEditor(false); setIdeaPadOpen(open => !open) }} revealIdeaPadToken={revealIdeaPadToken} onMessage={setMessage}
    ideaPad={<IdeaPad key={project.id} onCaptureActiveChange={setAnyIdeaCapture} ref={ideaPad} onAudioReferenceStart={pauseMidiReference} captureDisabled={recording || recordPreparing || hasTake} captureDeviceId={midi.state.selectedDeviceId ?? null} onMidiCaptureChange={(capturing, id) => { setIdeaCapturing(capturing); setIdeaPinnedDevice(capturing ? id : undefined) }} project={editorProjection(project)} selectedTick={(selectedClip?.startTick ?? 0) + selectedBar * 1920} onCapture={captureIdea} onChangeIdea={changeIdea} onCopyMidi={copyIdea} onReplayMidi={(idea, loop) => void replayMidi(idea, loop)} onStopReplay={stop} />}
    onImport={file => void importProject(file)} onWav={() => void exportFile('wav')} onMidi={() => void exportFile('midi')}
    onSheetMusic={() => { if (recording || recordPreparing || ideaCapturing || anyIdeaCapture) { setMessage('Finish recording before opening sheet music.'); return } stop(); setShowScore(true) }}
    onNew={() => void newProject()} onOpen={() => { projectOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; void store.listEntries().then(result => { setProjects(result.healthy); setInvalidProjects(result.invalid) }).catch(error => setMessage(failure(error))) }}
    onNewSirensStudy={() => void newSirensStudy()} onDownloadSirensStudy={() => download(packProject(createSirensStudy()), 'Sirens-study.nadi', 'application/zip')}
    onConnect={midi.rescan} selectedBar={selectedBar} onSelectBar={bar => { if (loopBar && playing && Math.floor(bar / visibleBars) !== Math.floor(selectedBar / visibleBars)) { stop(); setMessage('Shown bars changed. Press Play to loop this range.'); } setSelectedBar(bar) }}
    onDuplicateBar={duplicate} onRepeatNextBar={repeatNext} observedAction={observedAction} onSave={() => void saveNow()} onTestSound={() => void testSound()} /></div>
  <PlayabilityPanel project={project} performerModes={performerModes} onPerformerModeChange={(trackId, mode) => { const notation = clone(project.notation ?? defaultNotation()); notation.tracks[trackId] = { ...(notation.tracks[trackId] ?? DEFAULT_TRACK), performerMode: mode }; edit({ ...project, version: 6, notation }, false, { label: 'Change performer assumption' }) }} onReveal={finding => {
    const first = finding.affected.find(note => note.clipId)
    if (!first?.clipId) { setMessage('These notes are in an unplaced part. Place that part in Arrangement to edit it.'); return }
    chooseDestination(first.trackId, first.clipId)
    workspaceHandle.current?.openPanel('notes')
    const clip = project.clips.find(item => item.id === first.clipId)
    if (clip) { changeNoteView(clip.id, { bar: Math.floor((first.startTick - clip.startTick) / 1920), cursor: first.startTick - clip.startTick }); setRestoreSelection({ sequence: ++actionSequence.current, ids: finding.affected.filter(note => note.clipId === first.clipId).map(note => note.noteId), patternId: first.patternId, projectId: project.id }) }
  }} />
  {showScore && <SheetMusic project={project} viewCache={scoreViews} onChange={(next, label) => edit(next, false, { label })} onUndo={() => history('undo')} onRedo={() => history('redo')} canUndo={historyAvailable.undo} canRedo={historyAvailable.redo} onPlay={() => void playScore()} onStop={stop} playing={playing} onClose={() => { stop(); setShowScore(false) }} />}
  {projects !== null && <div className="creation-project-overlay"><section ref={projectDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Open a saved project" className="creation-project-dialog"><h2>Your projects</h2><p>Each project stays separate. Open .nadi or recovery JSON to restore a new copy.</p>{projects.length ? projects.map(item => <button key={item.id} disabled={switchPending} onClick={() => { void openProject(item) }}>{item.name} · {item.bars} bars</button>) : <p>No healthy projects saved on this browser yet.</p>}{invalidProjects.length > 0 && <section><h3>Records needing recovery</h3><p>These were not deleted. Download their raw data for recovery.</p>{invalidProjects.map((item, index) => <div key={index}><p>{String(item.key)}: {item.message}</p><button onClick={() => download(new TextEncoder().encode(JSON.stringify(item.raw)), `NADI-recovery-${index + 1}.json`, 'application/json')}>Download raw record {index + 1}</button></div>)}</section>}<label>Restore project or performance<input type="file" accept=".nadi,.json" disabled={switchPending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importProject(file) }} /></label><button type="button" onClick={() => void recoveryDownload()}>Download pre-upgrade recovery copy</button><button autoFocus disabled={switchPending} onClick={() => setProjects(null)}>Close</button></section></div>}{linkedRecording && <div className="creation-project-overlay"><section ref={linkedDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Record into linked part" className="creation-project-dialog"><h2>This part has linked copies</h2><p>Choose what should happen before the count-in.</p><button onClick={() => void startRecord('independent')}>Make independent and record</button><button onClick={() => void startRecord('linked')}>Record into all linked copies</button><button onClick={() => setLinkedRecording(false)}>Cancel</button></section></div>}{switchPending && <div role="status" className="creation-message" style={{ position: 'fixed', top: 70, left: 20, right: 20, zIndex: 100 }}>Opening project… Recording, capture and editing are paused until this finishes.</div>}</>
}

