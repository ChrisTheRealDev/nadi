import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { useMidi } from '../hooks/useMidi'
import { CreationView } from './CreationView'
import { WorkspaceSetup } from './WorkspaceSetup'
import { loadWorkspacePreferences, saveWorkspacePreferences, type WorkspacePreferences } from './workspacePreferences'
import { createProject, validateProject, type CreationProject, type Note } from './model'
import { CreationStore } from './storage'
import { packProject, unpackProject } from './archive'
import { CreationAudio, creationMidi } from './audio'
import { duplicateBarToEnd, repeatBarNext } from './edits'
import { IdeaPad, type IdeaPadHandle } from './IdeaPad'
import { copyMidiIdea, createMidiIdea, ideaToNotes, preservesOriginalIdeas, type Idea, type MidiOriginal } from './ideas'
import { appendStudioOriginal, finishStudioOriginal, restoreStudioHistory, type StudioOriginalBuffer, type StudioRawInput } from './studioFoundation'
import './creation.css'

const clone = <T,>(value: T): T => structuredClone(value)
// Read only from input/transport event handlers, never while rendering.
const inputClockNow = () => performance.now()
const failure = (error: unknown) => error instanceof Error ? error.message : 'Something could not finish. Your music stays here.'
function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export default function CreationApp() {
  const [initialWorkspace] = useState(loadWorkspacePreferences)
  const [workspace, setWorkspace] = useState(initialWorkspace.preferences)
  const workspaceCurrent = useRef(workspace)
  const [workspaceConfigured, setWorkspaceConfigured] = useState(initialWorkspace.configured)
  const [setupOpen, setSetupOpen] = useState(!initialWorkspace.configured)
  const setupActive = useRef(!initialWorkspace.configured)
  const setupOpener = useRef<HTMLElement | null>(null)
  const [project, setProject] = useState<CreationProject>(() => createProject())
  const current = useRef(project)
  const [store] = useState(() => new CreationStore())
  const [audio] = useState(() => new CreationAudio())
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState('Not saved yet')
  const [message, setMessage] = useState('Your studio is open. Ask Mira whenever you want a hand.')
  const [audioLabel, setAudioLabel] = useState(audio.label)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [selectedBar, setSelectedBar] = useState(0)
  const [visibleBars, setVisibleBars] = useState<1 | 2 | 4>(4)
  const startBar = Math.floor(selectedBar / visibleBars) * visibleBars
  const shownBars = Math.min(visibleBars, project.bars - startBar)
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [loopBar, setLoopBar] = useState(false)
  const [activeNotes, setActiveNotes] = useState<number[]>([])
  const [recording, setRecording] = useState(false)
  const [counting, setCounting] = useState(0)
  const [hasTake, setHasTake] = useState(false)
  const switching = useRef(false)
  const [switchPending, setSwitchPending] = useState(false)
  const ideaPadOpen = workspace.browser
  const changeWorkspace = (patch: Partial<WorkspacePreferences>) => {
    const next = { ...workspaceCurrent.current, ...patch }
    if (workspaceConfigured && Object.keys(next).every(key => next[key as keyof WorkspacePreferences] === workspaceCurrent.current[key as keyof WorkspacePreferences])) return
    workspaceCurrent.current = next; setWorkspace(next)
    if (!saveWorkspacePreferences(next)) setMessage('Workspace changed for this visit. Browser storage is unavailable, so your layout may reset next time. Your music is unchanged.')
  }
  const setIdeaPadOpen = (value: boolean | ((open: boolean) => boolean)) => changeWorkspace({ browser: typeof value === 'function' ? value(workspaceCurrent.current.browser) : value })
  const [revealIdeaPadToken, setRevealIdeaPadToken] = useState(0)
  const revealIdeaPad = () => { setIdeaPadOpen(true); setRevealIdeaPadToken(token => token + 1) }
  const ideaPad = useRef<IdeaPadHandle>(null)
  const [projects, setProjects] = useState<CreationProject[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [historyAvailable, setHistoryAvailable] = useState({ undo: false, redo: false })
  type HelpAction = 'sound-tested' | 'note-played' | 'record-started' | 'note-changed' | 'drum-hit-changed' | 'bar-duplicated' | 'mix-changed' | 'project-saved' | 'project-exported'
  const [observedAction, setObservedAction] = useState<{ sequence: number; type: HelpAction } | null>(null)
  const actionSequence = useRef(0)
  const observe = (type: HelpAction) => setObservedAction({ sequence: ++actionSequence.current, type })
  const undo = useRef<CreationProject[]>([]), redo = useRef<CreationProject[]>([])
  const expected = useRef(new Map<string, number>())
  const queue = useRef(Promise.resolve())
  const saveFault = useRef(false)
  const pendingSaves = useRef(0)
  const run = useRef(0)
  const record = useRef<{ start: number; startTick: number; bpm: number; original: StudioOriginalBuffer } | null>(null)
  const held = useRef(new Map<string, { pitch: number; velocity: number; tick: number }>())
  const inputPitch = useRef(new Map<string, number>())
  const screenHeld = useRef(new Set<number>())
  const take = useRef<Note[]>([])
  const takeOriginal = useRef<MidiOriginal | null>(null)
  const sustain = useRef(false)
  const sustained = useRef(new Set<string>())

  const write = (next: CreationProject) => {
    pendingSaves.current++; setSaved('Saving…')
    queue.current = queue.current.then(async () => {
      if (saveFault.current) throw new Error('Saving is paused after a storage conflict or failure. Download your project before reopening.')
      if (!expected.current.has(next.id) && next.revision === 1) {
        await store.save({ ...next, revision: 0 }, null)
        expected.current.set(next.id, 0)
      }
      await store.save(next, expected.current.get(next.id) ?? null)
      expected.current.set(next.id, next.revision)
      if (current.current.id === next.id && current.current.revision === next.revision) setSaved('Saved')
    }).catch(error => { saveFault.current = true; setSaved('Not saved'); setMessage(`${failure(error)} Download .nadi to keep a copy.`) })
      .finally(() => { pendingSaves.current-- })
  }
  const install = (next: CreationProject) => {
    current.current = next; setProject(next)
    audio.setMix(next.mix)
    setSelectedBar(bar => Math.min(bar, next.bars - 1))
  }
  const stop = () => {
    run.current++
    const active = record.current
    if (active) {
      const endTick = active.startTick + Math.min(60, Math.max(0, audio.time - active.start)) * active.bpm * 480 / 60
      held.current.forEach(note => take.current.push({ id: crypto.randomUUID(), instrument: 'piano', pitch: note.pitch, velocity: note.velocity, startTick: Math.round(note.tick), durationTicks: Math.max(1, Math.round(endTick - note.tick)) }))
      held.current.clear(); record.current = null
      takeOriginal.current = finishStudioOriginal(active.original, inputClockNow())
      const captured = take.current.length > 0 || takeOriginal.current.events.length > 0
      setHasTake(captured)
      setMessage(captured ? 'Recording stopped. Keep recording preserves the original key/controller events beside an editable note copy. Timing has not been snapped.' : 'No notes recorded. You can try again or place notes on screen.')
    }
    audio.stop(); audio.setMix(current.current.mix); inputPitch.current.clear(); screenHeld.current.clear(); sustain.current = false; sustained.current.clear()
    setActiveNotes([]); setPlaying(false); setRecording(false); setCounting(0)
  }
  const edit = (value: CreationProject) => {
    if (switching.current || setupActive.current || !ready || value.id !== current.current.id) return false
    const next = { ...clone(value), revision: current.current.revision + 1 }
    if (!validateProject(next)) { setMessage('That change would put notes outside the song or use an unsupported value. Your existing music is unchanged.'); audio.setMix(current.current.mix); return false }
    if (!preservesOriginalIdeas(current.current, next)) { setMessage('Captured originals cannot be rewritten. Copy a keyboard idea into the studio to edit its notes instead.'); return false }
    const arrangementChanged = JSON.stringify([next.notes, next.bpm, next.bars]) !== JSON.stringify([current.current.notes, current.current.bpm, current.current.bars])
    const musical = arrangementChanged || JSON.stringify(next.mix) !== JSON.stringify(current.current.mix)
    if (arrangementChanged && !audio.updateSong(next)) {
      stop()
      if (playing) setMessage('Playback stopped because the tempo/song length changed or an original was replaying. Press Play to hear the updated song.')
    }
    const ideaMetadataChanged = JSON.stringify(next.ideas.map(idea => [idea.id, idea.name, idea.attachedTick])) !== JSON.stringify(current.current.ideas.map(idea => [idea.id, idea.name, idea.attachedTick]))
    if (musical || ideaMetadataChanged) { undo.current.push(clone(current.current)); redo.current = []; setHistoryAvailable({ undo: true, redo: false }) }
    if (JSON.stringify(next.mix) !== JSON.stringify(current.current.mix)) observe('mix-changed')
    else if (JSON.stringify(next.notes.filter(note => note.instrument !== 'piano')) !== JSON.stringify(current.current.notes.filter(note => note.instrument !== 'piano'))) observe('drum-hit-changed')
    else if (JSON.stringify(next.notes) !== JSON.stringify(current.current.notes)) observe('note-changed')
    install(next); write(clone(next))
    return true
  }
  const duplicate = () => {
    try {
      const targetBar = current.current.bars
      if (edit(duplicateBarToEnd(current.current, selectedBar))) {
        observe('bar-duplicated'); setSelectedBar(targetBar)
        setMessage('Copied this bar to the end. Change the copy freely; the original stays the same.')
      }
    } catch (error) { setMessage(failure(error)) }
  }
  const repeatNext = () => {
    try {
      const targetBar = selectedBar + 1
      if (edit(repeatBarNext(current.current, selectedBar))) {
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
      await audio.noteOn('sound-check', 60, 90)
      setAudioLabel(audio.label); observe('sound-tested')
      window.setTimeout(() => audio.noteOff('sound-check'), 350)
      setMessage('Test note requested. Can you hear it? If not, check Piano Mute, volume and your output device.')
    } catch (error) { setMessage(failure(error)) }
  }
  const release = (key: string, force = false) => {
    if (sustain.current && !force) { sustained.current.add(key); return }
    sustained.current.delete(key)
    audio.noteOff(key)
    const active = record.current, note = held.current.get(key)
    if (active && note) {
      const end = active.startTick + Math.max(0, audio.time - active.start) * active.bpm * 480 / 60
      take.current.push({ id: crypto.randomUUID(), instrument: 'piano', pitch: note.pitch, velocity: note.velocity, startTick: Math.round(note.tick), durationTicks: Math.max(1, Math.round(end - note.tick)) })
      held.current.delete(key)
    }
    inputPitch.current.delete(key); setActiveNotes([...inputPitch.current.values()])
  }
  const press = (key: string, pitch: number, velocity = 90) => {
    if (switching.current || setupActive.current) return
    release(key, true)
    inputPitch.current.set(key, pitch); setActiveNotes([...inputPitch.current.values()])
    observe('note-played')
    void audio.noteOn(key, pitch, velocity).then(() => setAudioLabel(audio.label)).catch(error => setMessage(failure(error)))
    const active = record.current
    if (active && audio.time >= active.start) held.current.set(key, { pitch, velocity, tick: active.startTick + (audio.time - active.start) * active.bpm * 480 / 60 })
  }
  const captureInput = (event: StudioRawInput, atMs: number) => {
    if (switching.current || setupActive.current) return
    ideaPad.current?.pushMidi(event, atMs)
    const active = record.current
    if (active && appendStudioOriginal(active.original, event, atMs) === 'limit') {
      stop(); setMessage('Studio capture stopped at its 60-second / 10,000-event limit. Keep this original, then record another take.')
    }
  }
  const midi = useMidi({
    onNoteOn: (pitch, _velocity, metadata) => { captureInput({ type: 'note-on', pitch, velocity: metadata.rawVelocity, channel: metadata.channel, source: 'midi' }, metadata.atMs); press(`midi:${metadata.inputId}:${metadata.channel}:${pitch}`, pitch, metadata.rawVelocity) },
    onNoteOff: (pitch, metadata) => { captureInput({ type: 'note-off', pitch, velocity: metadata.releaseVelocity, channel: metadata.channel, source: 'midi' }, metadata.atMs); release(`midi:${metadata.inputId}:${metadata.channel}:${pitch}`) },
    onControlChange: (controller, value, metadata) => { if (switching.current || setupActive.current) return; captureInput({ type: 'controller', controller, value, channel: metadata.channel, source: 'midi' }, metadata.atMs); if (controller !== 64) return; sustain.current = value >= 64; if (!sustain.current) [...sustained.current].forEach(key => release(key, true)) },
    onPitchBend: (value, metadata) => captureInput({ type: 'pitch-bend', value, channel: metadata.channel, source: 'midi' }, metadata.atMs),
    onAllNotesOff: () => { [...inputPitch.current.keys()].forEach(key => release(key, true)); audio.silenceKeys(); sustain.current = false; sustained.current.clear() },
  })

  useEffect(() => {
    let active = true
    void store.load().then(value => {
      if (!active) return
      if (value) { current.current = value; setProject(value); audio.setMix(value.mix); expected.current.set(value.id, value.revision); setSaved('Saved') }
      setReady(true)
    }).catch(error => { if (active) { saveFault.current = true; setSaved('Not saved'); setMessage(`${failure(error)} You can still create and download a .nadi copy.`); setReady(true) } })
    return () => { active = false }
  }, [store, audio])
  useEffect(() => {
    const timer = window.setInterval(() => setAudioLabel(audio.label), 1000)
    const warn = (event: BeforeUnloadEvent) => { if (pendingSaves.current || saveFault.current || record.current || take.current.length || takeOriginal.current?.events.length || ideaPad.current?.isDirty()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => { window.clearInterval(timer); window.removeEventListener('beforeunload', warn); audio.dispose() }
  }, [audio])
  useEffect(() => {
    audio.setInterruptionHandler(() => { stop(); setMessage('Sound was paused by the browser. Your project is safe. Press Play to resume.') })
    return () => { audio.setInterruptionHandler(undefined) }
  })

  const play = async () => {
    if (switching.current) return
    stop(); const token = run.current
    const snapshot = clone(current.current)
    if (!snapshot.notes.length) { setMessage('Your song is empty. Click the piano grid to place notes, or press Record and play after the count-in. Captured originals remain in the Idea Pad.'); return }
    setPlaying(true)
    setMessage(loopBar ? `Looping bars ${startBar + 1}–${startBar + shownBars}. Your edits are heard on the next unqueued beat; sustained notes keep ringing.` : 'Playing your song. Your edits are heard on the next unqueued beat. Tempo or song-length changes stop playback.')
    try { await audio.play(snapshot, tick => { if (token === run.current) setPlayhead(tick) }, () => { if (token === run.current) { audio.setMix(current.current.mix); setPlaying(false); setPlayhead(0) } }, { live: true, loopRange: loopBar ? { startTick: startBar * 1920, endTick: (startBar + shownBars) * 1920 } : undefined, failed: error => { if (token === run.current) setMessage(failure(error)) } }) }
    catch (error) { if (token === run.current) { stop(); setMessage(failure(error)) } }
  }
  const replayMidi = async (idea: Idea, loop: boolean) => {
    if (switching.current) return
    if (idea.original.kind !== 'midi') return
    stop(); const token = run.current
    try {
      const snapshot = createProject()
      snapshot.bpm = 120
      snapshot.notes = ideaToNotes(idea.original, snapshot.bpm)
      if (!snapshot.notes.length) { setMessage('This original contains controller events but no playable notes. Download original events to inspect them.'); return }
      const end = snapshot.notes.reduce((last, note) => Math.max(last, note.startTick + note.durationTicks), Math.ceil(idea.original.durationMs * snapshot.bpm * 480 / 60000))
      snapshot.bars = Math.max(1, Math.ceil(end / 1920))
      if (!validateProject(snapshot)) throw new Error('This original exceeds the temporary replay limits. Download its original events instead.')
      setMessage(`Replaying your captured keyboard timing through the piano. Sustain is supported; other controllers and pitch bend remain saved but are not rendered.${loop ? ' Loop restarts at the rounded bar boundary plus a half-second release tail; it is not seamless.' : ''}`)
      setPlaying(true)
      const restart = async () => {
        if (token !== run.current) return
        await audio.play(snapshot, () => {}, () => {
          if (token !== run.current) return
          if (loop) void restart().catch(error => { if (token === run.current) { setPlaying(false); setMessage(failure(error)); audio.setMix(current.current.mix) } })
          else { audio.setMix(current.current.mix); setPlaying(false); setPlayhead(0) }
        })
      }
      await restart()
    } catch (error) { if (token === run.current) { setPlaying(false); audio.setMix(current.current.mix); setMessage(failure(error)) } }
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
    try { if (edit(copyMidiIdea(current.current, id, selectedBar * 1920))) setMessage('Copied your captured notes into this bar at the current tempo, preserving their elapsed timing. Edit or Undo the copy freely; its original remains in the Idea Pad.') }
    catch (error) { setMessage(failure(error)) }
  }
  const startRecord = async () => {
    if (switching.current) return
    if (record.current) { stop(); return }
    if ((take.current.length || takeOriginal.current?.events.length) && !window.confirm('Discard the unkept recording and try again?')) return
    stop(); take.current = []; takeOriginal.current = null; setHasTake(false)
    const token = run.current
    try {
      await audio.unlock(); if (switching.current || token !== run.current) return
      const beat = 60 / current.current.bpm, start = audio.time + .15
      const deadline = start + beat * 4
      record.current = { start: deadline, startTick: selectedBar * 1920, bpm: current.current.bpm, original: { startedAtMs: inputClockNow() + (deadline - audio.time) * 1000, events: [] } }
      setRecording(true); setCounting(4); setMessage(`Count in, then play. Recording starts at bar ${selectedBar + 1}. Press Stop when finished.`)
      observe('record-started')
      for (let i = 0; i < 4; i++) audio.click(start + i * beat)
      const timer = window.setInterval(() => {
        if (token !== run.current || !record.current) { window.clearInterval(timer); return }
        const remaining = record.current.start - audio.time
        setCounting(remaining > 0 ? Math.ceil(remaining / beat) : 0)
        if (remaining <= 0) setPlayhead(record.current.startTick - remaining * current.current.bpm * 480 / 60)
        if (-remaining >= 60) { window.clearInterval(timer); stop(); setMessage('60-second studio capture stopped. Keep this original and its editable notes, then record another take to continue.') }
      }, 50)
    } catch (error) { setMessage(failure(error)) }
  }
  const keep = () => {
    if (switching.current) return
    const original = takeOriginal.current
    if (!take.current.length && !original?.events.length) return
    const notes = [...current.current.notes, ...clone(take.current)]
    const bars = Math.max(current.current.bars, Math.ceil(Math.max(...notes.map(n => n.startTick + n.durationTicks)) / 1920))
    try {
      const idea = original?.events.length ? createMidiIdea(original.events, original.durationMs, 'Original studio performance') : null
      const next = { ...current.current, notes, bars, ideas: idea ? [...current.current.ideas, idea] : current.current.ideas }
      if (!validateProject(next)) { setMessage('This recording exceeds this browser project’s note/capture limits. Use Download unkept original (.json) to preserve its exact events before closing or discarding. Your unkept original and notes remain here.'); return }
      if (!edit(next)) return
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
    const source = direction === 'undo' ? undo.current : redo.current, target = direction === 'undo' ? redo.current : undo.current
    const snapshot = source.at(-1); if (!snapshot) return
    try {
      const next = restoreStudioHistory(snapshot, current.current)
      const changedArrangement = JSON.stringify([next.notes, next.bpm, next.bars]) !== JSON.stringify([current.current.notes, current.current.bpm, current.current.bars])
      if (changedArrangement && !audio.updateSong(next)) stop()
      source.pop(); target.push(clone(current.current))
      install(next); write(clone(next)); setHistoryAvailable({ undo: undo.current.length > 0, redo: redo.current.length > 0 })
      setMessage(`${direction === 'undo' ? 'Undid' : 'Redid'} music/metadata edits. Captured originals remain in the Idea Pad.`)
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
    saveFault.current = false; undo.current = []; redo.current = []; setHistoryAvailable({ undo: false, redo: false })
    if (persisted) expected.current.set(next.id, next.revision)
    take.current = []; takeOriginal.current = null; setHasTake(false)
    install(next); setSelectedBar(0); setPlayhead(0); setSaved(persisted ? 'Saved' : 'Not saved yet'); setProjects(null)
    setObservedAction(null)
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
  const openProject = (next: CreationProject) => withSwitchLock(async () => { if (await safeSwitch()) await switchTo(next, true) })
  const importProject = async (file: File) => {
    await withSwitchLock(async () => {
      try {
      if (file.size > 16 * 1024 * 1024) throw new Error('This .nadi file is too large for this prototype (16 MB maximum).')
      const parsed = unpackProject(new Uint8Array(await file.arrayBuffer()))
      if (!await safeSwitch()) return
      // Open as a new local copy: imported IDs cannot overwrite an existing project.
      const next = { ...parsed, id: createProject().id, revision: 0 }
      if (await switchTo(next, false)) setMessage('Opened an editable copy of your .nadi project. The original local project was not overwritten.')
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
      const result = await audio.wav(snapshot); download(result.bytes, `${stem}.wav`, 'audio/wav')
      if (current.current.id === snapshot.id) observe('project-exported')
      setMessage(`WAV downloaded from revision ${snapshot.revision}: studio instrument notes only; Idea Pad microphone originals are not included. Master sample peak: ${result.peak.toFixed(3)}${result.peak > 1 ? ' — clipping detected; reduce overlapping notes before exporting again.' : '.'}`)
    } catch (error) { setMessage(failure(error)) } finally { setExporting(false) }
  }
  const blockSwitchInteraction = (event: SyntheticEvent) => {
    if (switching.current) { event.preventDefault(); event.stopPropagation() }
  }
  const customizeWorkspace = () => {
    if (record.current || ideaPad.current?.isCapturing()) { setMessage('Stop and keep your active recording before customizing the workspace. Your recording is still running.'); return }
    setupOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stop(); setupActive.current = true; setSetupOpen(true)
  }
  const previewNote = (note: Note) => {
    if (!previewEnabled || switching.current || setupActive.current) return
    void audio.previewNote(note).then(() => setAudioLabel(audio.label)).catch(error => setMessage(failure(error)))
  }
  const applyWorkspace = (next: WorkspacePreferences) => {
    changeWorkspace(next); setWorkspaceConfigured(true); setupActive.current = false; setSetupOpen(false)
    requestAnimationFrame(() => setupOpener.current?.focus())
  }
  const cancelWorkspace = () => {
    if (!workspaceConfigured) { applyWorkspace(initialWorkspace.preferences); return }
    setupActive.current = false; setSetupOpen(false)
    requestAnimationFrame(() => setupOpener.current?.focus())
  }
  if (!ready) return <main className="storage-loading">Opening your studio without changing earlier lesson saves…</main>
  return <><div inert={switchPending || setupOpen || undefined} aria-busy={switchPending} onClickCapture={blockSwitchInteraction} onPointerDownCapture={blockSwitchInteraction} onKeyDownCapture={blockSwitchInteraction} onInputCapture={blockSwitchInteraction} onChangeCapture={blockSwitchInteraction}><CreationView project={project} saved={saved} message={message}
    workspace={workspace} onWorkspaceChange={changeWorkspace} onCustomizeWorkspace={customizeWorkspace} workspaceSetupOpen={setupOpen}
    startBar={startBar} visibleBars={shownBars} zoomBars={visibleBars} onZoomBars={value => { if (loopBar && playing) stop(); setVisibleBars(value) }}
    previewEnabled={previewEnabled} onPreviewNote={previewNote} onTogglePreview={() => { audio.stopPreview(); setPreviewEnabled(value => !value) }}
    playing={playing} playhead={playhead} activeNotes={activeNotes} recording={recording} counting={counting}
    loopBar={loopBar} onToggleLoopBar={() => { stop(); setLoopBar(value => !value); setMessage('Loop mode changed. Press Play song to hear the shown bars repeatedly or the full song. Looping does not change saved music or exports.') }}
    midiLabel={midi.state.deviceName ? `MIDI: ${midi.state.deviceName}` : midi.state.message.replace(/Rescan|rescan/g, 'Connect MIDI')} audioLabel={audioLabel}
    canUndo={historyAvailable.undo} canRedo={historyAvailable.redo} onEdit={edit}
    onPlay={() => void play()} onStop={stop} onUndo={() => history('undo')} onRedo={() => history('redo')}
    onNoteOn={pitch => { if (switching.current || setupActive.current || screenHeld.current.has(pitch)) return; captureInput({ type: 'note-on', pitch, velocity: 90, channel: 0, source: 'screen' }, inputClockNow()); screenHeld.current.add(pitch); press(`screen:${pitch}`, pitch) }} onNoteOff={pitch => { if (!screenHeld.current.delete(pitch)) return; captureInput({ type: 'note-off', pitch, velocity: 0, channel: 0, source: 'screen' }, inputClockNow()); release(`screen:${pitch}`) }}
    onRecord={() => void startRecord()} onKeep={keep}
    onDiscard={() => { if (switching.current) return; stop(); take.current = []; takeOriginal.current = null; setHasTake(false); setMessage('Unkept take discarded. Your saved song and kept original captures are unchanged.') }}
    onDownloadUnkeptOriginal={downloadUnkeptOriginal}
    hasTake={hasTake} onDownload={() => void exportFile('nadi')}
    ideaPadOpen={ideaPadOpen} onToggleIdeaPad={() => setIdeaPadOpen(open => !open)} revealIdeaPadToken={revealIdeaPadToken} onMessage={setMessage}
    ideaPad={<IdeaPad key={project.id} ref={ideaPad} project={project} selectedTick={selectedBar * 1920} onCapture={captureIdea} onChangeIdea={changeIdea} onCopyMidi={copyIdea} onReplayMidi={(idea, loop) => void replayMidi(idea, loop)} onStopReplay={stop} />}
    onImport={file => void importProject(file)} onWav={() => void exportFile('wav')} onMidi={() => void exportFile('midi')}
    onNew={() => void newProject()} onOpen={() => { void store.list().then(setProjects).catch(error => setMessage(failure(error))) }}
    onConnect={midi.rescan} selectedBar={selectedBar} onSelectBar={bar => { if (loopBar && playing && Math.floor(bar / visibleBars) !== Math.floor(selectedBar / visibleBars)) { stop(); setMessage('Shown bars changed. Press Play to loop this range.'); } setSelectedBar(bar) }}
    onDuplicateBar={duplicate} onRepeatNextBar={repeatNext} onMixPreview={mix => { if (!switching.current) audio.setMix(mix) }} observedAction={observedAction} onSave={() => void saveNow()} onTestSound={() => void testSound()} />
  {projects !== null && <div className="creation-project-overlay"><section role="dialog" aria-modal="true" aria-label="Open a saved project" className="creation-project-dialog"><h2>Your projects</h2><p>Each project stays separate. You can also open a downloaded .nadi file.</p>{projects.length ? projects.map(item => <button key={item.id} disabled={switchPending} onClick={() => { void openProject(item) }}>{item.name} · {item.bars} bars</button>) : <p>No projects saved on this browser yet.</p>}<button autoFocus disabled={switchPending} onClick={() => setProjects(null)}>Close</button></section></div>}</div>{setupOpen && <WorkspaceSetup initial={workspace} firstRun={!workspaceConfigured} onApply={applyWorkspace} onCancel={cancelWorkspace} />}{switchPending && <div role="status" className="creation-message" style={{ position: 'fixed', top: 70, left: 20, right: 20, zIndex: 100 }}>Opening project… Recording, capture and editing are paused until this finishes.</div>}</>
}
