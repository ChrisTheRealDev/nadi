import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { CreationProject } from './model'
import { createAudioIdea, createMidiIdea, createTextIdea, type Idea, type RawIdeaEvent } from './ideas'
import { base64ToBytes, createBrowserRecorder, type IdeaRecorder, type RawAudioRecovery, type RecorderState } from './ideaRecorder'
import { appendStudioOriginal, finishStudioOriginal, type StudioOriginalBuffer } from './studioFoundation'
import { acceptsIdeaCaptureInput } from './ideaCaptureSource'
import './ideaPad.css'

// Distribute Omit over the message union so pitch/controller/value remain typed.
export type IdeaMidiInput = RawIdeaEvent extends infer Event ? Event extends RawIdeaEvent ? Omit<Event, 'atMs' | 'order'> : never : never
export interface IdeaPadHandle {
  pushMidi(event: IdeaMidiInput, atMs: number, deviceId?: string): void
  stopCapture(): void
  stopCaptureForDisconnectedDevice(deviceId: string): void
  pinnedCaptureDeviceId(): string | null
  pauseReference(): void
  stopReference(): void
  isCapturing(): boolean
  isDirty(): boolean
}
export interface IdeaPadProps {
  project: CreationProject
  selectedTick: number
  onCapture: (idea: Idea) => boolean
  onChangeIdea: (id: string, patch: { name?: string; attachedTick?: number | null }) => void
  onCopyMidi: (id: string) => void
  onReplayMidi: (idea: Idea, loop: boolean) => void
  onStopReplay: () => void
  /** Audio reference play should stop MIDI reference playback, not an active capture. */
  onAudioReferenceStart?: () => void
  captureDeviceId?: string | null
  /** Disable starting a second performance capture during a studio take. */
  captureDisabled?: boolean
  onMidiCaptureChange?: (capturing: boolean, pinnedDeviceId: string | null) => void
  onCaptureActiveChange?: (capturing: boolean) => void
}

function downloadRawRecovery(recovery: RawAudioRecovery) {
  const url = URL.createObjectURL(recovery.blob)
  const link = document.createElement('a')
  link.href = url
  const extension = recovery.blob.type.includes('webm') ? 'webm' : recovery.blob.type.includes('ogg') ? 'ogg' : recovery.blob.type.includes('mp4') ? 'm4a' : 'bin'
  link.download = `microphone-recovery-partial.${extension}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadOriginal(idea: Idea) {
  const original = idea.original
  const extension = original.kind === 'text' ? 'txt' : original.kind === 'midi' ? 'midi-capture.json' : original.mimeType.includes('webm') ? 'webm' : original.mimeType.includes('ogg') ? 'ogg' : original.mimeType.includes('mp4') ? 'm4a' : 'audio'
  const data = original.kind === 'audio' ? new Blob([base64ToBytes(original.base64)], { type: original.mimeType }) : new Blob([original.kind === 'text' ? original.text : JSON.stringify(original, null, 2)], { type: original.kind === 'text' ? 'text/plain;charset=utf-8' : 'application/json' })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = `${idea.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'idea'}.${extension}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function OriginalAudio({ idea, onPlay }: { idea: Idea; onPlay: (element: HTMLAudioElement) => void }) {
  const original = idea.original
  const base64 = original.kind === 'audio' ? original.base64 : ''
  const mimeType = original.kind === 'audio' ? original.mimeType : ''
  const element = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([base64ToBytes(base64)], { type: mimeType }))
    const audio = element.current
    if (audio) audio.src = url
    return () => { audio?.pause(); URL.revokeObjectURL(url) }
  }, [base64, mimeType])
  const [loop, setLoop] = useState(false)
  return <div><audio ref={element} controls loop={loop} preload="metadata" aria-label={`Replay ${idea.name}`} onPlay={event => onPlay(event.currentTarget)} /><label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop original audio</label></div>
}

function IdeaCard({ idea, props, onAudioPlay, draft = false }: { idea: Idea; props: IdeaPadProps; onAudioPlay: (element: HTMLAudioElement) => void; draft?: boolean }) {
  const [loop, setLoop] = useState(false)
  return <article className="idea-card">
    {draft ? <strong>{idea.name} · not saved</strong> : <label>Name<input key={idea.name} defaultValue={idea.name} maxLength={120} onBlur={event => { if (event.target.value.trim()) props.onChangeIdea(idea.id, { name: event.target.value }) }} /></label>}
    <span className="idea-kind">Original {idea.original.kind === 'midi' ? 'keyboard performance' : idea.original.kind === 'text' ? 'written note' : 'microphone recording'}</span>
    {idea.original.kind === 'text' && <pre className="idea-text">{idea.original.text}</pre>}
    {idea.original.kind === 'audio' && <><OriginalAudio idea={idea} onPlay={onAudioPlay} /><small>{Math.ceil(idea.original.durationMs / 1000)} seconds · {(idea.original.byteLength / 1024).toFixed(1)} KiB · {idea.original.mimeType}. Reference volume is separate from the studio mixer; only one reference plays at a time.</small></>}
    {idea.original.kind === 'midi' && <><small>{Math.ceil(idea.original.durationMs / 1000)} seconds · {idea.original.events.length} original events</small><label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop keyboard replay</label><div className="idea-actions"><button type="button" onClick={() => props.onReplayMidi(idea, loop)}>Replay keyboard</button><button type="button" onClick={props.onStopReplay}>Stop replay</button>{!draft && <button type="button" onClick={() => props.onCopyMidi(idea.id)}>Copy notes into studio</button>}</div></>}
    <div className="idea-actions"><button type="button" onClick={() => downloadOriginal(idea)}>Download original{idea.original.kind === 'midi' ? ' events (.json)' : ''}</button>{!draft && <><button type="button" onClick={() => props.onChangeIdea(idea.id, { attachedTick: props.selectedTick })}>Attach at selected timeline position</button>{idea.attachedTick !== null && <button type="button" onClick={() => props.onChangeIdea(idea.id, { attachedTick: null })}>Detach reminder</button>}</>}</div>
    {!draft && idea.attachedTick !== null && <small>Reminder attached at tick {idea.attachedTick}. Original is unchanged.</small>}
  </article>
}

export const IdeaPad = forwardRef<IdeaPadHandle, IdeaPadProps>(function IdeaPad(props, ref) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<Idea | null>(null)
  const [rawRecovery, setRawRecovery] = useState<RawAudioRecovery | null>(null)
  const [state, setState] = useState<RecorderState>('idle')
  const [message, setMessage] = useState('Capture first: no key, tempo, library or song structure choices required.')
  const [midiCapturing, setMidiCapturing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [eventCount, setEventCount] = useState(0)
  const propsRef = useRef(props)
  const nameRef = useRef(name)
  const dirtyRef = useRef(false)
  const mounted = useRef(true)
  const midi = useRef<StudioOriginalBuffer | null>(null)
  const startedAt = useRef(0)
  const recorder = useRef<IdeaRecorder | null>(null)
  const captureDevice = useRef<string | null>(null)
  const playingReference = useRef<HTMLAudioElement | null>(null)
  const pauseReference = useCallback(() => { playingReference.current?.pause() }, [])
  const stopReference = useCallback(() => { const element = playingReference.current; if (element) { element.pause(); element.currentTime = 0 }; playingReference.current = null }, [])
  const onAudioPlay = useCallback((element: HTMLAudioElement) => { propsRef.current.onAudioReferenceStart?.(); if (playingReference.current && playingReference.current !== element) playingReference.current.pause(); playingReference.current = element }, [])
  useLayoutEffect(() => {
    propsRef.current = props
    nameRef.current = name
    dirtyRef.current = Boolean(text || draft || rawRecovery)
  }, [props, name, text, draft, rawRecovery])

  const capture = useCallback((idea: Idea) => {
    if (!mounted.current) return
    try {
      if (propsRef.current.onCapture(idea)) { setDraft(null); setMessage('Original captured in this project. Check the studio save indicator; download a project backup for safekeeping.'); return }
      setDraft(idea)
      setMessage('This original could not be added/saved. It remains here for download or retry; do not close this page before backing it up.')
    } catch (error) { setDraft(idea); setMessage(error instanceof Error ? `${error.message} Original remains available below for download.` : 'Save failed. Download the retained original below.') }
  }, [])

  const stopMidi = useCallback(() => {
    const current = midi.current
    if (!current) return
    if (!current.events.length) { midi.current = null; captureDevice.current = null; propsRef.current.onMidiCaptureChange?.(false, null); setMidiCapturing(false); setMessage('No keyboard events were captured. Play screen keys or a connected keyboard after pressing Capture keyboard.'); return }
    try {
      const original = finishStudioOriginal(current, performance.now())
      const idea = createMidiIdea(original.events, original.durationMs, nameRef.current || 'Keyboard idea')
      midi.current = null; captureDevice.current = null; propsRef.current.onMidiCaptureChange?.(false, null); setMidiCapturing(false)
      capture(idea)
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Keyboard capture could not be accepted.'} Capture is retained; change its name if needed and retry Stop.`) }
  }, [capture])

  useImperativeHandle(ref, () => ({
    pushMidi(event, atMs, deviceId) {
      const current = midi.current
      if (!current) return
      if (!acceptsIdeaCaptureInput(captureDevice.current, event.source, deviceId)) return
      if (appendStudioOriginal(current, event, atMs) === 'limit') { stopMidi(); return }
      setEventCount(current.events.length)
    },
    stopCapture() { stopMidi(); recorder.current?.stop() },
    stopCaptureForDisconnectedDevice(deviceId) { if (midi.current && captureDevice.current === deviceId) { stopMidi(); setMessage('Keyboard capture stopped because its pinned MIDI device disconnected. Keep or download the captured original.') } },
    pinnedCaptureDeviceId() { return midi.current ? captureDevice.current : null },
    pauseReference,
    stopReference,
    isCapturing() { return midi.current !== null || Boolean(recorder.current?.active) },
    isDirty() { return dirtyRef.current || midi.current !== null || Boolean(recorder.current?.active) },
  }), [stopMidi, pauseReference, stopReference])

  useEffect(() => {
    mounted.current = true
    recorder.current = createBrowserRecorder((next, detail) => {
      if (!mounted.current) return
      setState(next)
      // The capture callback owns final save success/failure messaging.
      if (next !== 'idle' || !detail.startsWith('Original microphone')) setMessage(detail)
      if (next === 'recording') { startedAt.current = performance.now(); setSeconds(0) }
    }, original => {
      try { capture(createAudioIdea(original.base64, original.mimeType, original.byteLength, original.durationMs, nameRef.current || 'Audio idea')) }
      catch (error) {
        setRawRecovery({ blob: new Blob([base64ToBytes(original.base64)], { type: original.mimeType }), reason: 'unsupported-original', incomplete: false })
        setMessage(`${error instanceof Error ? error.message : 'Audio capture could not be accepted.'} Recorder bytes remain available for raw download; they were not added to this project.`)
      }
    }, recovery => { if (mounted.current) setRawRecovery(recovery) })
    return () => { mounted.current = false; midi.current = null; recorder.current?.cancel(); stopReference() }
  }, [capture, stopReference])
  useEffect(() => {
    if (!midiCapturing && state !== 'recording') return
    const timer = setInterval(() => {
      const elapsed = Math.min(60, Math.floor((performance.now() - (midi.current?.startedAtMs ?? startedAt.current)) / 1000))
      setSeconds(elapsed)
      if (midi.current && elapsed >= 60) stopMidi()
    }, 250)
    return () => clearInterval(timer)
  }, [midiCapturing, state, stopMidi])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (text || draft || rawRecovery || midi.current || recorder.current?.active) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [text, draft, rawRecovery])

  const active = midiCapturing || state === 'requesting' || state === 'recording' || state === 'stopping'
  useEffect(() => { propsRef.current.onCaptureActiveChange?.(active); return () => propsRef.current.onCaptureActiveChange?.(false) }, [active])
  const totalAudio = props.project.ideas.reduce((total, idea) => total + (idea.original.kind === 'audio' ? idea.original.byteLength : 0), 0)
  return <aside className="idea-pad" aria-label="Idea Pad" data-help-target="idea-pad">
    <header><div><h2>Idea Pad</h2><p>Keep the spark. Shape the music yourself.</p></div><span>{props.project.ideas.length} project captures</span></header>
    <div className="idea-pad-body"><div className="idea-capture-controls">
    <label className="idea-name-label">Capture name (optional)<input value={name} maxLength={120} placeholder="A melody, a sound, an intention…" onChange={event => setName(event.target.value)} /></label>
    <label>Written idea<textarea value={text} maxLength={12_000} placeholder="Words remain your notes — they never generate music." onChange={event => setText(event.target.value)} /></label>
    <div className="idea-actions idea-capture-actions">
    <button type="button" disabled={active || !text || Boolean(draft)} onClick={() => { try { const idea = createTextIdea(text, name || 'Written idea'); capture(idea); setText('') } catch (error) { setMessage(error instanceof Error ? error.message : 'Written capture could not be accepted.') } }}>Keep exact text</button>
    <div className="idea-actions"><button type="button" disabled={active || Boolean(draft) || props.captureDisabled} onClick={() => { if (propsRef.current.captureDisabled) return; props.onStopReplay(); const now = performance.now(); midi.current = { startedAtMs: now, events: [] }; captureDevice.current = props.captureDeviceId ?? null; props.onMidiCaptureChange?.(true, captureDevice.current); setMidiCapturing(true); setSeconds(0); setEventCount(0); setMessage(captureDevice.current ? 'Keyboard recording from the selected MIDI device only. Other devices and screen keys are excluded; timing is independent of project tempo.' : 'Keyboard recording from screen keys only. Connect and select a MIDI device before a new capture to record it; timing is independent of project tempo.') }}>Capture keyboard</button><button type="button" disabled={active || Boolean(draft) || Boolean(rawRecovery) || props.captureDisabled} onClick={() => { if (propsRef.current.captureDisabled) return; if (totalAudio >= 2 * 1024 * 1024) { setMessage('This project has reached its 2 MiB microphone-original limit. Download a project backup and start another project for more captures.'); return } props.onStopReplay(); void recorder.current?.start() }}>Record microphone</button></div>
    </div>
    {active && <div className="idea-recording"><strong>{midiCapturing ? 'Keyboard recording' : state === 'requesting' ? 'Requesting permission' : state === 'stopping' ? 'Finalizing recording' : 'Microphone recording'} · {seconds}s / 60s</strong>{midiCapturing && <span>{eventCount} original events</span>}<button type="button" disabled={state === 'stopping'} onClick={() => { stopMidi(); recorder.current?.stop() }}>{state === 'requesting' ? 'Cancel microphone request' : 'Stop and keep original'}</button></div>}
    <p className="idea-message" role="status">{message}</p>
    {rawRecovery && <div className="idea-draft"><strong>Raw microphone recovery — not a saved idea</strong><p>{rawRecovery.incomplete ? 'Only bounded partial bytes were retained.' : rawRecovery.reason === 'unsupported-original' ? 'The browser returned bytes in a format this project cannot safely store.' : 'Recorder bytes were retained, but the file may be incomplete or unplayable.'} Download them before leaving, or discard them. They cannot be inserted into this project as a valid original.</p><button type="button" onClick={() => downloadRawRecovery(rawRecovery)}>Download raw recovery</button><button type="button" onClick={() => setRawRecovery(null)}>Discard raw recovery</button></div>}
    </div><div className="idea-originals"><div className="idea-list">
    {draft && <div className="idea-draft"><p>Unsaved original — back it up before leaving.</p><IdeaCard idea={draft} props={props} onAudioPlay={onAudioPlay} draft /><button type="button" onClick={() => capture(draft)}>Retry keeping original</button></div>}
    {props.project.ideas.length === 0 && !draft && <div className="idea-empty"><strong>Room for the music in your head.</strong><p>No setup needed. Write something, capture your playing, or record a hum.</p><small>Your exact originals stay here for replay while you compose. Copy keyboard notes into the studio only when you choose.</small></div>}{props.project.ideas.map(idea => <IdeaCard key={idea.id} idea={idea} props={props} onAudioPlay={onAudioPlay} />)}</div></div></div>
    <small className="idea-limits">Microphone originals: 1 MiB each / 2 MiB per project, up to 60 seconds. No live monitoring. Browser storage can be cleared; download project backups.</small>
  </aside>
})
