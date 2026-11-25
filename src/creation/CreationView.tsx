import { NadiBrand } from '../components/NadiBrand'
import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { TICKS_PER_BAR, noteName, type CreationMix, type CreationProject, type Instrument, type Note } from './model'
import { PianoRoll } from './PianoRoll'
import type { PianoSelection } from './pianoRollSelection'
import { DrumEditor } from './DrumEditor'
import { NumericDraft } from './NumericDraft'
import { CreationMira } from './mira/CreationMira'
import type { WorkspacePreferences } from './workspacePreferences'
import './creation.css'
import './drumEditor.css'
import './workspacePanels.css'
import './workspaceLayout.css'

export interface CreationViewProps {
  studioControls?: ReactNode
  onPause?: () => void
  transportTick?: number
  recordingStatus?: string
  trackControls?: ReactNode
  arrangementContent?: ReactNode
  mixerContent?: ReactNode
  soundBrowserContent?: ReactNode
  editorContext?: ReactNode
  editorContent?: ReactNode
  barActionsContent?: ReactNode
  customMira?: ReactNode
  controlledEditor?: 'piano' | 'drums'
  onEditorChange?: (mode: 'piano' | 'drums') => void
  startBar?: number
  visibleBars?: number
  zoomBars?: 1 | 2 | 4
  onZoomBars?: (bars: 1 | 2 | 4) => void
  previewEnabled?: boolean
  onPreviewNote?: (note: Note) => void
  onTogglePreview?: () => void
  workspace?: WorkspacePreferences
  onWorkspaceChange?: (patch: Partial<WorkspacePreferences>) => void
  onCustomizeWorkspace?: () => void
  workspaceSetupOpen?: boolean
  project: CreationProject
  saved: string
  message: string
  playing: boolean
  playhead: number
  activeNotes: number[]
  recording: boolean
  counting: number
  midiLabel: string
  audioLabel: string
  canUndo: boolean
  canRedo: boolean
  selectedBar: number
  onSelectBar: (bar: number) => void
  onEdit: (next: CreationProject) => void
  onPlay: () => void
  onStop: () => void
  onUndo: () => void
  onRedo: () => void
  onNoteOn: (pitch: number) => void
  onNoteOff: (pitch: number) => void
  onRecord: () => void
  onKeep: () => void
  onDiscard: () => void
  onDownloadUnkeptOriginal?: () => void
  hasTake: boolean
  ideaPad?: ReactNode
  ideaPadOpen?: boolean
  onToggleIdeaPad?: () => void
  onDownload: () => void
  onSave?: () => void
  onImport: (file: File) => void
  onWav: () => void
  onMidi: () => void
  onNew: () => void
  onOpen: () => void
  onConnect: () => void
  onTestSound?: () => void
  onDuplicateBar?: () => void
  onRepeatNextBar?: () => void
  onMessage?: (message: string) => void
  revealIdeaPadToken?: number
  loopBar?: boolean
  onToggleLoopBar?: () => void
  onMixPreview?: (mix: CreationMix) => void
  observedAction?: { sequence: number; type: 'sound-tested' | 'note-played' | 'record-started' | 'note-changed' | 'drum-hit-changed' | 'bar-duplicated' | 'mix-changed' | 'project-saved' | 'project-exported' } | null
}

const instruments: Instrument[] = ['piano', 'kick', 'snare', 'hat']
const instrumentName: Record<Instrument, string> = { piano: 'Piano', kick: 'Kick', snare: 'Snare', hat: 'Hi-hat' }
const keyboardMap: Record<string, number> = { a: 57, s: 60, d: 64 }

function StudioIcon({ name }: { name: 'play' | 'stop' | 'undo' | 'redo' | 'save' | 'export' | 'folder' | 'ideas' | 'mira' | 'arrange' | 'piano' | 'drums' | 'mixer' }) {
  const paths = {
    play: <path d="m6 4 9 6-9 6Z" fill="currentColor" stroke="none" />,
    stop: <rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none" />,
    undo: <><path d="M7 5 3 9l4 4M3 9h8a5 5 0 0 1 5 5v2" /></>,
    redo: <><path d="m13 5 4 4-4 4M17 9H9a5 5 0 0 0-5 5v2" /></>,
    save: <><path d="M4 3h10l3 3v11H3V3Z" /><path d="M6 3v5h8V3M6 17v-6h8v6" /></>,
    export: <><path d="M10 13V3m-4 4 4-4 4 4M4 11v6h12v-6" /></>,
    folder: <path d="M3 5h5l2 2h7v10H3Z" />,
    ideas: <><path d="M6 13c0-2-2-3-2-6a6 6 0 0 1 12 0c0 3-2 4-2 6M7 14h6M8 17h4" /></>,
    mira: <><path d="M3 4h14v10H8l-4 3v-3H3Z" /><path d="M6 8h8M6 11h5" /></>,
    arrange: <><path d="M3 4h14M3 10h14M3 16h14" /><path d="M5 2v4m7 2v4m-5 2v4" /></>,
    piano: <><rect x="3" y="3" width="14" height="14" rx="1" /><path d="M7.7 10v7m4.6-7v7M7 3v7m6-7v7" /></>,
    drums: <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></>,
    mixer: <><path d="M5 3v14M10 3v14M15 3v14" /><path d="M3 7h4m1 6h4m1-8h4" strokeWidth="3" /></>,
  }
  return <svg className="studio-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function CreationView(props: CreationViewProps) {
  const startBar = props.startBar ?? props.selectedBar
  const visibleBars = props.visibleBars ?? 1
  const [editorState, setEditorState] = useState<{ projectId: string; mode: 'piano' | 'drums' }>({ projectId: props.project.id, mode: 'piano' })
  const editor = props.controlledEditor ?? props.workspace?.editor ?? (editorState.projectId === props.project.id ? editorState.mode : 'piano')
  const setEditor = (mode: 'piano' | 'drums') => { releaseComputerKeys(); if (props.onEditorChange) props.onEditorChange(mode); else if (props.onWorkspaceChange) props.onWorkspaceChange({ editor: mode }); else setEditorState({ projectId: props.project.id, mode }) }
  const miraVisible = props.workspace?.mira ?? props.project.guidance.open
  const playlistVisible = props.workspace?.playlist ?? true
  const mixerVisible = props.workspace?.mixer ?? true
  const keyboardVisible = props.workspace?.keyboard ?? true
  const browserVisible = Boolean(props.ideaPad && props.ideaPadOpen !== false)
  const [browserState, setBrowserState] = useState<{ tab: 'sounds' | 'ideas'; revealToken: number }>({ tab: 'ideas', revealToken: props.revealIdeaPadToken ?? 0 })
  const revealToken = props.revealIdeaPadToken ?? 0
  const browserTab = browserState.revealToken === revealToken ? browserState.tab : 'ideas'
  const setBrowserTab = (tab: 'sounds' | 'ideas') => setBrowserState({ tab, revealToken })
  const browser = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (revealToken > 0) {
      const draft = browser.current?.querySelector<HTMLElement>('#browser-panel-ideas textarea') ?? browser.current?.querySelector<HTMLElement>('#browser-panel-ideas input, #browser-panel-ideas [tabindex="0"], #browser-panel-ideas button')
      draft?.focus()
    }
  }, [revealToken, props.ideaPadOpen])
  const [mixerProject, setMixerProject] = useState<string | null>(null)
  const mixerOpen = mixerProject === props.project.id
  const playlist = useRef<HTMLElement>(null)
  const mixerTrigger = useRef<HTMLButtonElement>(null)
  const closeMixer = () => { setMixerProject(null); mixerTrigger.current?.focus() }
  const toggleMixer = () => {
    if (props.mixerContent !== undefined && props.onWorkspaceChange) props.onWorkspaceChange({ mixer: !mixerVisible })
    else setMixerProject(mixerOpen ? null : props.project.id)
  }
  const showPlaylist = () => { props.onWorkspaceChange?.({ playlist: true }); requestAnimationFrame(() => { playlist.current?.focus({ preventScroll: true }); playlist.current?.scrollIntoView({ block: 'nearest' }) }) }
  // Track visibility is presentation only. Existing parts are always discoverable
  // on reopen and showing an empty instrument never changes the project.
  const [addedTracks, setAddedTracks] = useState<{ projectId: string; instruments: Instrument[] }>({ projectId: props.project.id, instruments: [] })
  const occupiedInstruments = new Set(props.project.notes.map(note => note.instrument))
  const visibleInstruments = instruments.filter(instrument => instrument === 'piano' || editor === 'drums' || occupiedInstruments.has(instrument) || (addedTracks.projectId === props.project.id && addedTracks.instruments.includes(instrument)))
  const visibleDrums = visibleInstruments.filter((instrument): instrument is 'kick' | 'snare' | 'hat' => instrument !== 'piano')
  const revealInstruments = (next: Instrument[]) => setAddedTracks(current => ({ projectId: props.project.id, instruments: [...new Set([...(current.projectId === props.project.id ? current.instruments : []), ...next])] }))
  const showDrumEditor = () => { releaseComputerKeys(); revealInstruments(['kick', 'snare', 'hat']); setEditor('drums'); setSelectedNoteId(null) }
  const [selection, setSelection] = useState<PianoSelection | null>(null)
  const selectedNoteId = editor === 'piano' && selection?.projectId === props.project.id && props.project.notes.some(note => note.id === selection.noteId && note.instrument === 'piano' && note.startTick < (startBar + visibleBars) * TICKS_PER_BAR && note.startTick + note.durationTicks > startBar * TICKS_PER_BAR) ? selection.noteId : null
  const setSelectedNoteId = (noteId: string | null) => setSelection(noteId ? { projectId: props.project.id, noteId } : null)
  const selectedNote = selectedNoteId !== null
  const heldComputerKeys = useRef(new Set<string>())
  const latestNoteOff = useRef(props.onNoteOff)
  useLayoutEffect(() => { latestNoteOff.current = props.onNoteOff })
  useLayoutEffect(() => {
    if (!keyboardVisible || props.workspaceSetupOpen) { heldComputerKeys.current.forEach(key => latestNoteOff.current(keyboardMap[key])); heldComputerKeys.current.clear() }
  }, [keyboardVisible, props.workspaceSetupOpen])
  useLayoutEffect(() => {
    const held = heldComputerKeys.current
    const release = () => { held.forEach(key => latestNoteOff.current(keyboardMap[key])); held.clear() }
    window.addEventListener('blur', release)
    return () => { window.removeEventListener('blur', release); release() }
  }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const laneNotes = useMemo(() => {
    const indexed: Record<Instrument, Note[][]> = { piano: [], kick: [], snare: [], hat: [] }
    for (const note of props.project.notes) {
      const first = Math.floor(note.startTick / TICKS_PER_BAR), last = Math.ceil((note.startTick + note.durationTicks) / TICKS_PER_BAR)
      for (let bar = first; bar < last; bar++) {
        const bucket = indexed[note.instrument][bar] ?? (indexed[note.instrument][bar] = [])
        // Arrangement is an overview; cap preview density without touching musical data.
        if (bucket.length < 128) bucket.push(note)
      }
    }
    return indexed
  }, [props.project.notes])
  const barStart = props.selectedBar * TICKS_PER_BAR
  const notesInBar = props.project.notes.filter(note => note.startTick >= barStart && note.startTick < barStart + TICKS_PER_BAR)
  const editProject = (patch: Partial<CreationProject>) => props.onEdit({ ...props.project, ...patch })
  const editNotes = (notes: Note[], bars = props.project.bars) => editProject({ notes, bars })
  const setGuideOpen = (open: boolean) => { if (props.onWorkspaceChange) props.onWorkspaceChange({ mira: open }); else editProject({ guidance: { ...props.project.guidance, open } }) }
  const repeatBar = () => {
    if (!notesInBar.length) { props.onMessage?.('This bar has no new notes to duplicate.'); return }
    if (props.onDuplicateBar) { props.onDuplicateBar(); return }
    const nextStart = props.project.bars * TICKS_PER_BAR
    const copies = notesInBar.map(note => ({ ...note, id: crypto.randomUUID(), startTick: nextStart + note.startTick - barStart }))
    const bars = Math.max(props.project.bars + 1, ...copies.map(note => Math.ceil((note.startTick + note.durationTicks) / TICKS_PER_BAR)))
    if (bars > 256) return
    editNotes([...props.project.notes, ...copies], bars); props.onSelectBar(props.project.bars)
  }
  const clearBar = () => {
    const targets = notesInBar.filter(note => editor === 'piano' ? note.instrument === 'piano' : note.instrument !== 'piano')
    if (!targets.length || !window.confirm(`Clear ${targets.length} ${editor === 'piano' ? 'piano notes' : 'drum hits'} starting in bar ${props.selectedBar + 1}? Notes starting earlier and other instruments are kept. You can undo this.`)) return
    const ids = new Set(targets.map(note => note.id))
    editNotes(props.project.notes.filter(note => !ids.has(note.id))); setSelectedNoteId(null)
    props.onMessage?.(`Cleared ${targets.length} ${editor === 'piano' ? 'piano notes' : 'drum hits'} from bar ${props.selectedBar + 1}. Use Undo to restore them.`)
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (props.workspaceSetupOpen) return
    const typing = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'))
    if (!typing && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation()
      if (event.key.toLowerCase() === 'y' || event.shiftKey) props.onRedo(); else props.onUndo()
      return
    }
    if (event.key === 'Escape') {
      const menus = event.currentTarget.querySelectorAll<HTMLDetailsElement>('details[open]')
      if (menus.length) {
        event.preventDefault(); event.stopPropagation()
        const focused = event.target instanceof Element ? event.target.closest('details[open]') : null
        menus.forEach(menu => { menu.open = false })
        ;(focused ?? menus[menus.length - 1]).querySelector<HTMLElement>('summary')?.focus()
        return
      }
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || event.ctrlKey || event.metaKey || event.altKey) return
    if (!event.repeat && !event.shiftKey && ['F5', 'F6', 'F7', 'F9'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'F5') showPlaylist()
      else if (event.key === 'F6') showDrumEditor()
      else if (event.key === 'F7') { releaseComputerKeys(); setEditor('piano') }
      else toggleMixer()
      if (event.key === 'F6' || event.key === 'F7') {
        const studio = event.currentTarget
        window.requestAnimationFrame(() => studio.querySelector<HTMLButtonElement>('.editor-tabs [aria-selected="true"]')?.focus())
      }
      return
    }
    const key = event.key.toLowerCase(), pitch = keyboardMap[key]
    if (pitch === undefined || heldComputerKeys.current.has(key) || !keyboardVisible) return
    event.preventDefault(); heldComputerKeys.current.add(key); props.onNoteOn(pitch)
  }
  const keyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase()
    if (!heldComputerKeys.current.has(key)) return
    heldComputerKeys.current.delete(key); props.onNoteOff(keyboardMap[key])
  }
  const releaseComputerKeys = () => { heldComputerKeys.current.forEach(key => latestNoteOff.current(keyboardMap[key])); heldComputerKeys.current.clear() }
  const tabKeyDown = (event: KeyboardEvent<HTMLDivElement>, current: number, select: (index: number) => void) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ? 1 - current : null
    if (next === null) return
    event.preventDefault(); event.stopPropagation(); select(next)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  const importProject = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) props.onImport(file); event.target.value = '' }
  const displayTick = props.transportTick ?? (props.playing || props.recording ? props.playhead : props.selectedBar * TICKS_PER_BAR)
  const position = `${String(Math.floor(displayTick / TICKS_PER_BAR) + 1).padStart(3, '0')} : ${Math.floor(displayTick % TICKS_PER_BAR / 480) + 1} : ${String(Math.floor(displayTick % 480)).padStart(3, '0')}`
  const bottomPlaylist = props.workspace?.playlistPosition === 'bottom'
  const sections = ['status', ...(!bottomPlaylist && playlistVisible ? ['arrangement'] : []), 'editor', ...(mixerVisible ? ['mixer'] : []), ...(bottomPlaylist && playlistVisible ? ['arrangement'] : [])]
  const rowSize: Record<string, string> = { status: 'auto', arrangement: 'minmax(150px,26%)', editor: 'minmax(310px,1fr)', mixer: '44px' }
  const browserRight = props.workspace?.browserSide === 'right'
  const layoutStyle = {
    '--workspace-areas': sections.map(section => `"${browserVisible ? browserRight ? `${section} ideas` : `ideas ${section}` : section}"`).join(' '),
    '--workspace-rows': sections.map(section => rowSize[section]).join(' '),
    '--workspace-columns': browserVisible ? browserRight ? 'minmax(0,1fr) 264px' : '264px minmax(0,1fr)' : 'minmax(0,1fr)',
    '--workspace-mobile-areas': ['status', ...(browserVisible ? ['ideas'] : []), ...sections.filter(section => section !== 'status')].map(section => `"${section}"`).join(' '),
    '--workspace-mobile-rows': ['auto', ...(browserVisible ? ['430px'] : []), ...sections.filter(section => section !== 'status').map(section => section === 'editor' ? '490px' : section === 'arrangement' ? '220px' : '54px')].join(' '),
  } as React.CSSProperties
  return <div className={`creation-shell ${miraVisible ? '' : 'creation-shell--free'}`} data-mira-side={props.workspace?.miraSide ?? 'right'} onKeyDown={keyDown} onKeyUp={keyUp} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) releaseComputerKeys() }}>
    <a className="skip-link" href="#creation-workspace">Skip to workspace</a>
    <header className="creation-header">
      <a className="creation-brand" href="#create" aria-label="NADI studio"><NadiBrand compact /></a>
      <label className="project-name"><span className="sr-only">Project name</span><input maxLength={120} value={props.project.name} onChange={event => editProject({ name: event.target.value })} /></label>
      <span className="project-kind">LOCAL PROJECT</span>
      <div className="project-actions">
      {props.onCustomizeWorkspace && <button type="button" className="save-button customize-workspace" onClick={() => { setMixerProject(null); props.onCustomizeWorkspace?.() }}>Customize workspace</button>}
      <details className="file-menu"><summary><StudioIcon name="folder" />Project</summary><div><button type="button" onClick={props.onNew}>New empty project</button><button type="button" data-help-target="open-projects" onClick={props.onOpen}>Open saved project</button><button type="button" onClick={() => fileInput.current?.click()}>Open .nadi file</button></div></details>
      <button type="button" className="save-button" data-help-target="save" onClick={props.onSave ?? props.onDownload}><StudioIcon name="save" />Save</button>
      <details className="export-menu"><summary data-help-target="export"><StudioIcon name="export" />Export</summary><div><button type="button" onClick={props.onDownload}>Download .nadi</button><button type="button" onClick={props.onWav}>Export WAV</button><button type="button" onClick={props.onMidi}>Export MIDI</button><p>MIDI transfers notes, not NADI sounds or mixer settings.</p></div></details>
      </div>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".nadi,.json" onChange={importProject} />
    </header>
    <div className="studio-toolbar">
      <nav className="transport" aria-label="Transport">
        <button type="button" className="transport__play" onClick={props.onPlay} aria-label="Play song" title="Play song" aria-pressed={props.playing}><StudioIcon name="play" /></button>
        {props.onPause && <button type="button" onClick={props.onPause} disabled={!props.playing || props.recording}>Pause</button>}
        <button type="button" onClick={props.onStop} aria-label="Stop" title="Stop"><StudioIcon name="stop" /></button>
        {props.onToggleLoopBar && <button type="button" onClick={props.onToggleLoopBar} aria-pressed={props.loopBar ?? false} data-help-target="loop-range" title="Repeat the shown bars while you edit; existing note tails keep ringing.">Loop shown bars</button>}
        <button type="button" data-help-target="record" className={props.recording ? 'is-recording' : ''} onClick={props.onRecord} aria-pressed={props.recording}><span className="record-dot" />Record</button>
        <label className="tempo-control"><span>Tempo</span><NumericDraft label="Tempo" min={30} max={300} integer value={props.project.bpm} disabled={props.recording || props.hasTake} onCommit={bpm => editProject({ bpm })} /><small>BPM</small></label>
        <output className="transport-position" aria-label="Play position" aria-live="off"><span>{position}</span><small>BAR · BEAT · TICK</small></output>
        <span className="toolbar-divider" />
        <button type="button" data-help-target="undo" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo" title="Undo"><StudioIcon name="undo" /></button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo" title="Redo"><StudioIcon name="redo" /></button>
      </nav>
      <div className="workspace-switches">
      <div className="window-switches" role="toolbar" aria-label="Studio windows">
      <button type="button" onClick={showPlaylist} title="Playlist — arrange your music (F5)"><StudioIcon name="arrange" />Playlist</button>
      <button type="button" onClick={showDrumEditor} aria-pressed={editor === 'drums'} title="Channel rack — drum steps (F6)"><StudioIcon name="drums" />Channel rack</button>
      <button type="button" onClick={() => setEditor('piano')} aria-pressed={editor === 'piano'} title="Piano roll — edit notes (F7)"><StudioIcon name="piano" />Piano roll</button>
      <button type="button" ref={mixerTrigger} onClick={toggleMixer} aria-expanded={props.mixerContent !== undefined ? mixerVisible : mixerOpen} aria-controls="studio-mixer" title="Mixer — volume and mute (F9)"><StudioIcon name="mixer" />Mixer</button>
      </div>
      {props.onToggleIdeaPad && <button type="button" className="idea-pad-toggle" onClick={props.onToggleIdeaPad} aria-expanded={props.ideaPadOpen !== false} aria-controls="studio-idea-pad"><StudioIcon name="folder" />Browser</button>}
      {!miraVisible && <button type="button" className="guide-reopen" onClick={() => setGuideOpen(true)}><StudioIcon name="mira" />Ask Mira</button>}
      </div>
      {props.studioControls}
    </div>
    <main className={`creation-workspace workspace-arranged ${browserVisible ? 'creation-workspace--ideas' : ''}`} style={layoutStyle} id="creation-workspace" tabIndex={-1}>
      <div className="status-stack">{props.message && <div className="creation-message" role="status">{props.message}</div>}{(props.counting > 0 || props.recording) && <div className="record-banner" role="status">{props.recordingStatus ?? (props.counting > 0 ? `Starting in ${props.counting}` : 'Recording your playing…')}</div>}</div>
      {props.ideaPad && <section ref={browser} id="studio-idea-pad" className="studio-idea-pad panel" aria-label="Idea Pad" hidden={props.ideaPadOpen === false}>
        <div className="browser-tabs" role="tablist" aria-label="Browser" onKeyDown={event => tabKeyDown(event, browserTab === 'sounds' ? 0 : 1, index => setBrowserTab(index === 0 ? 'sounds' : 'ideas'))}><button id="browser-tab-sounds" aria-controls="browser-panel-sounds" tabIndex={browserTab === 'sounds' ? 0 : -1} type="button" role="tab" aria-selected={browserTab === 'sounds'} onClick={() => setBrowserTab('sounds')}><StudioIcon name="folder" />Sounds</button><button id="browser-tab-ideas" aria-controls="browser-panel-ideas" tabIndex={browserTab === 'ideas' ? 0 : -1} type="button" role="tab" aria-selected={browserTab === 'ideas'} onClick={() => setBrowserTab('ideas')}><StudioIcon name="ideas" />Idea Pad</button></div>
        <div id="browser-panel-ideas" className="browser-content" role="tabpanel" aria-labelledby="browser-tab-ideas" hidden={browserTab !== 'ideas'}>{props.ideaPad}</div>
        <div id="browser-panel-sounds" className="browser-content sound-browser" role="tabpanel" aria-labelledby="browser-tab-sounds" hidden={browserTab !== 'sounds'}>
          {props.soundBrowserContent ?? <><h2>Sounds</h2><p>Choose a sound to open its editor. You make the notes.</p>
          <h3>Instruments</h3><button type="button" className="sound-choice instrument--piano" aria-label="Select Piano" onClick={() => { releaseComputerKeys(); setEditor('piano'); setSelectedNoteId(null) }}><StudioIcon name="piano" /><span>Piano<small>Keys · Piano roll</small></span><span aria-hidden="true">↗</span></button>
          <h3>Drums</h3>{(['kick', 'snare', 'hat'] as const).map(instrument => <button type="button" key={instrument} className={`sound-choice instrument--${instrument}`} aria-label={`Select ${instrumentName[instrument]}`} onClick={() => { releaseComputerKeys(); revealInstruments([instrument]); setEditor('drums'); setSelectedNoteId(null) }}><StudioIcon name="drums" /><span>{instrumentName[instrument]}<small>Percussion · Channel rack</small></span><span aria-hidden="true">↗</span></button>)}
          <small className="sound-browser-note">Four built-in sounds. Sample imports and additional instruments are not available yet.</small></>}
        </div>
      </section>}
      <section className="arrangement panel" ref={playlist} hidden={!playlistVisible} tabIndex={-1} aria-labelledby="arrangement-title">
        {props.arrangementContent ?? <>
        <div className="panel-heading"><StudioIcon name="arrange" /><h1 id="arrangement-title">Playlist</h1><span className="track-count">{visibleInstruments.length} {visibleInstruments.length === 1 ? 'track' : 'tracks'} · Arrangement</span><details className="add-instrument-menu"><summary>+ Add instrument</summary><div><p>Current sound engine: piano and three drum sounds.</p>{(['kick', 'snare', 'hat'] as const).map(instrument => <button type="button" key={instrument} disabled={visibleInstruments.includes(instrument)} onClick={() => { releaseComputerKeys(); revealInstruments([instrument]); setEditor('drums'); setSelectedNoteId(null) }}>{instrumentName[instrument]}{visibleInstruments.includes(instrument) ? ' · visible' : ''}</button>)}</div></details><label>Bars <input aria-label="Bars" type="number" min="1" max="256" value={props.project.bars} onChange={event => {
          const bars = Number(event.target.value)
          if (!Number.isSafeInteger(bars) || bars < 1 || bars > 256) { props.onMessage?.('Choose a song length from 1 to 256 bars.'); return }
          const lastNoteBar = Math.max(1, ...props.project.notes.map(note => Math.ceil((note.startTick + note.durationTicks) / TICKS_PER_BAR)))
          if (lastNoteBar > bars) { props.onMessage?.(`Notes reach bar ${lastNoteBar}. Move or remove those notes before shortening the song to ${bars} ${bars === 1 ? 'bar' : 'bars'}.`); return }
          editProject({ bars }); if (props.selectedBar >= bars) props.onSelectBar(bars - 1)
        }} /></label></div>
        <div className="arrangement-scroll"><div className="arrangement-grid" style={{ '--bars': props.project.bars, '--tracks': visibleInstruments.length } as React.CSSProperties}>
          <span className="lane-label lane-label--ruler">INSTRUMENT</span>{Array.from({ length: props.project.bars }, (_, bar) => <button type="button" key={`bar-${bar}`} className={`bar-number ${bar === props.selectedBar ? 'is-selected' : ''}`} onClick={() => { props.onSelectBar(bar); setSelectedNoteId(null) }} aria-pressed={bar === props.selectedBar}><span>Bar {bar + 1}</span></button>)}
          {visibleInstruments.map(instrument => <Lane key={instrument} instrument={instrument} bars={props.project.bars} notesByBar={laneNotes[instrument]} selectedBar={props.selectedBar} onSelect={bar => { props.onSelectBar(bar); setEditor(instrument === 'piano' ? 'piano' : 'drums'); setSelectedNoteId(null) }} />)}
          {props.playing && <div className="arrangement-playhead" aria-hidden="true" style={{ left: `calc(128px + (100% - 128px) * ${Math.min(1, props.playhead / (props.project.bars * TICKS_PER_BAR))})` }} />}
        </div></div>
        </>}
      </section>
      <section className="editor panel">
        {props.trackControls}
        {props.editorContext}
        <div className="editor-tabs" role="tablist" aria-label="Editor" onKeyDown={event => tabKeyDown(event, editor === 'piano' ? 0 : 1, index => index === 0 ? setEditor('piano') : showDrumEditor())}><button id="editor-tab-piano" aria-controls="editor-panel" tabIndex={editor === 'piano' ? 0 : -1} type="button" role="tab" data-help-target="editor-piano" aria-selected={editor === 'piano'} onClick={() => setEditor('piano')}><StudioIcon name="piano" />Piano roll</button><button id="editor-tab-drums" aria-controls="editor-panel" tabIndex={editor === 'drums' ? 0 : -1} type="button" role="tab" data-help-target="editor-drums" aria-selected={editor === 'drums'} onClick={showDrumEditor}><StudioIcon name="drums" />Channel rack</button><span>Bar {props.selectedBar + 1} <i /> 4/4 grid</span>{!playlistVisible && <label className="compact-bar-choice">Go to bar<select aria-label="Edit bar" value={props.selectedBar} onChange={event => { props.onSelectBar(Number(event.target.value)); setSelectedNoteId(null) }}>{Array.from({ length: props.project.bars }, (_, bar) => <option key={bar} value={bar}>{bar + 1}</option>)}</select></label>}</div>
        <div className="compose-navigation" aria-label="Composition view">
          <div className="compose-zoom"><span>Show</span>{([1, 2, 4] as const).map(value => <button key={value} type="button" aria-pressed={(props.zoomBars ?? 1) === value} onClick={() => props.onZoomBars?.(value)}>{value} {value === 1 ? 'bar' : 'bars'}</button>)}</div>
          <button type="button" aria-label="Previous bars" disabled={startBar === 0} onClick={() => props.onSelectBar(Math.max(0, startBar - (props.zoomBars ?? 1)))}>←</button><strong className={props.loopBar ? 'compose-loop-range' : ''}>Bars {startBar + 1}–{startBar + visibleBars}{props.loopBar ? ' · looping' : ''}</strong><button type="button" aria-label="Next bars" disabled={startBar + visibleBars >= props.project.bars} onClick={() => props.onSelectBar(startBar + visibleBars)}>→</button>
          <button type="button" disabled={props.project.bars >= 256} onClick={() => { editProject({ bars: props.project.bars + 1 }); props.onSelectBar(props.project.bars) }}>+ Add bar</button>
          <label className="compose-preview" data-help-target="preview-notes"><input type="checkbox" checked={props.previewEnabled ?? true} onChange={props.onTogglePreview} />Preview notes</label>
        </div>
        {props.editorContent ?? (editor === 'piano' ? <div id="editor-panel" className="piano-editor" role="tabpanel" aria-labelledby="editor-tab-piano"><PianoRoll key={props.project.id} notes={props.project.notes} bars={props.project.bars} selectedBar={props.selectedBar} startBar={startBar} visibleBars={visibleBars} selectedId={selectedNoteId} onChange={editNotes} onSelection={setSelectedNoteId} onSelectBar={props.onSelectBar} playhead={props.playhead} playing={props.playing} previewEnabled={props.previewEnabled ?? true} onPreview={props.onPreviewNote} onMessage={props.onMessage} onUndo={props.onUndo} disabled={props.workspaceSetupOpen} /></div> : <div id="editor-panel" className="drum-tab-panel" role="tabpanel" aria-labelledby="editor-tab-drums"><DrumEditor key={props.project.id} notes={props.project.notes} bars={props.project.bars} startBar={startBar} visibleBars={visibleBars} playhead={props.playhead} playing={props.playing} previewEnabled={props.previewEnabled ?? true} onChange={editNotes} onPreview={props.onPreviewNote ?? (() => {})} onMessage={props.onMessage ?? (() => {})} onUndo={props.onUndo} onSelectBar={props.onSelectBar} disabled={props.workspaceSetupOpen} /></div>)}
        {keyboardVisible && !props.workspaceSetupOpen && <PianoKeys key={`${props.project.id}:${editor}`} activeNotes={props.activeNotes} onNoteOn={props.onNoteOn} onNoteOff={props.onNoteOff} />}
        {props.barActionsContent ?? <div className="bar-actions">{props.onRepeatNextBar && <><span className="repeat-destination">Bar {props.selectedBar + 1} → next destination: bar {props.selectedBar + 2}</span><button type="button" data-help-target="repeat-next-bar" onClick={props.onRepeatNextBar} disabled={!notesInBar.length || props.selectedBar >= 255}>Repeat in next bar</button></>}<button type="button" data-help-target="duplicate-bar" onClick={repeatBar} disabled={!notesInBar.length || props.project.bars >= 256}>Duplicate bar to end</button><button type="button" className="danger-quiet" onClick={clearBar} disabled={!notesInBar.some(note => editor === 'piano' ? note.instrument === 'piano' : note.instrument !== 'piano')}>Clear {editor === 'piano' ? 'piano notes' : 'drums'} in this bar</button></div>}
      </section>
      {props.mixerContent !== undefined ? (mixerVisible || mixerOpen ? props.mixerContent : null) : <Mixer key={props.project.id} project={props.project} instruments={visibleInstruments} onEdit={props.onEdit} onPreview={props.onMixPreview} expanded={mixerOpen} onClose={closeMixer} hidden={!mixerVisible && !mixerOpen} />}
    </main>
    {props.customMira !== undefined ? props.customMira : <CreationMira onRevealTarget={target => { if (props.workspaceSetupOpen) return; if (target === 'piano-keys' && !keyboardVisible) props.onWorkspaceChange?.({ keyboard: true }); if (target.startsWith('mixer-') && !mixerVisible) props.onWorkspaceChange?.({ mixer: true }); }} open={miraVisible && !props.workspaceSetupOpen} workspace={{ projectId: props.project.id, revision: props.project.revision, editor, selectedBar: props.selectedBar, hasPianoNotes: props.project.notes.some(note => note.instrument === 'piano'), hasDrumHits: props.project.notes.some(note => note.instrument !== 'piano'), selectedNote, visibleDrumRows: editor === 'drums' ? visibleDrums : [], mutedInstruments: instruments.filter(instrument => props.project.mix[instrument].muted), saved: props.saved === 'Saved' }} observedAction={props.observedAction ?? null} onClose={() => setGuideOpen(false)} />}
    {props.hasTake && <div className="take-bar" role="region" aria-label="Recorded take"><span>Your recording is ready</span><button type="button" onClick={props.onKeep}>Keep recording</button>{props.onDownloadUnkeptOriginal && <button type="button" onClick={props.onDownloadUnkeptOriginal}>Download unkept original (.json)</button>}<button type="button" onClick={props.onDiscard}>Discard recording</button></div>}
    <footer className="creation-footer"><button type="button" onClick={props.onConnect}>Connect MIDI</button><span>{props.midiLabel}</span><button type="button" data-help-target="sound-status" onClick={props.onTestSound ?? (() => { props.onNoteOn(60); window.setTimeout(() => props.onNoteOff(60), 350) })}>Test sound</button><span>{props.audioLabel}</span><span className="save-state" role="status">{props.saved}</span><span className="footer-note">Your music, your decisions · Mira advises only</span></footer>
  </div>
}

function Lane({ instrument, bars, notesByBar, selectedBar, onSelect }: { instrument: Instrument; bars: number; notesByBar: Note[][]; selectedBar: number; onSelect: (bar: number) => void }) {
  return <><strong className={`lane-label instrument--${instrument}`}><span className="track-dot" /><span>{instrumentName[instrument]}<small>{instrument === 'piano' ? 'Keys' : 'Percussion'}</small></span></strong>{Array.from({ length: bars }, (_, bar) => <button type="button" key={bar} className={`lane-cell instrument--${instrument} ${selectedBar === bar ? 'is-selected' : ''}`} aria-label={`${instrumentName[instrument]}, bar ${bar + 1}`} onClick={() => onSelect(bar)}>{(notesByBar[bar] ?? []).length > 0 && <span className="lane-clip" aria-hidden="true"><span>{instrumentName[instrument]}</span></span>}{(notesByBar[bar] ?? []).map(note => { const start = Math.max(0, note.startTick - bar * TICKS_PER_BAR), end = Math.min(TICKS_PER_BAR, note.startTick + note.durationTicks - bar * TICKS_PER_BAR); return <i key={note.id} className={`mini-note mini-note--${instrument}`} style={{ left: `${start / TICKS_PER_BAR * 100}%`, width: `${(end - start) / TICKS_PER_BAR * 100}%`, top: instrument === 'piano' ? `${35 + (127 - note.pitch) / 127 * 40}%` : '62%' }} /> })}</button>)}</>
}

export function PianoKeys({ activeNotes, onNoteOn, onNoteOff }: Pick<CreationViewProps, 'activeNotes' | 'onNoteOn' | 'onNoteOff'>) {
  const held = useRef(new Map<string, number>())
  const latestOff = useRef(onNoteOff)
  useLayoutEffect(() => { latestOff.current = onNoteOff })
  const press = (source: string, pitch: number) => {
    if (held.current.has(source)) return
    const alreadyPlaying = [...held.current.values()].includes(pitch)
    held.current.set(source, pitch)
    if (!alreadyPlaying) onNoteOn(pitch)
  }
  const release = (source: string) => {
    const pitch = held.current.get(source)
    if (pitch === undefined) return
    held.current.delete(source)
    if (![...held.current.values()].includes(pitch)) latestOff.current(pitch)
  }
  const releasePitch = (pitch: number) => { [...held.current.entries()].forEach(([source, heldPitch]) => { if (heldPitch === pitch) release(source) }) }
  useLayoutEffect(() => {
    const sources = held.current
    const releaseAll = () => { const pitches = new Set(sources.values()); sources.clear(); pitches.forEach(pitch => latestOff.current(pitch)) }
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const pitches = new Set<number>()
      for (const [source, pitch] of sources) if (source.endsWith(`:${event.key}`)) { sources.delete(source); pitches.add(pitch) }
      pitches.forEach(pitch => { if (![...sources.values()].includes(pitch)) latestOff.current(pitch) })
    }
    window.addEventListener('blur', releaseAll)
    window.addEventListener('keyup', keyUp)
    return () => { window.removeEventListener('blur', releaseAll); window.removeEventListener('keyup', keyUp); releaseAll() }
  }, [])
  const whites = Array.from({ length: 25 }, (_, index) => 48 + index).filter(pitch => ![1, 3, 6, 8, 10].includes(pitch % 12))
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, pitch: number) => { event.currentTarget.setPointerCapture(event.pointerId); press(`pointer:${event.pointerId}`, pitch) }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => { release(`pointer:${event.pointerId}`); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }
  return <div className="live-piano"><span>Play keys · <kbd>A</kbd> A3 <kbd>S</kbd> C4 <kbd>D</kbd> E4 · Record after count-in</span><div className="piano-keys" data-help-target="piano-keys" aria-label="Piano keys">{Array.from({ length: 25 }, (_, index) => 48 + index).map(pitch => { const white = whites.includes(pitch); return <button type="button" key={pitch} className={`piano-key piano-key--${white ? 'white' : 'black'} ${activeNotes.includes(pitch) ? 'is-active' : ''}`} style={{ '--key': whites.indexOf(pitch), '--after': whites.filter(item => item < pitch).length } as React.CSSProperties} onPointerDown={event => pointerDown(event, pitch)} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={event => release(`pointer:${event.pointerId}`)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) press(`key:${pitch}:${event.key}`, pitch) } }} onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); release(`key:${pitch}:${event.key}`) } }} onBlur={() => releasePitch(pitch)} aria-label={`Play ${noteName(pitch)}`}>{white && <span>{noteName(pitch)}</span>}</button> })}</div></div>
}

function Mixer({ project, instruments, onEdit, onPreview, expanded, onClose, hidden }: { project: CreationProject; instruments: Instrument[]; onEdit: (project: CreationProject) => void; onPreview?: (mix: CreationMix) => void; expanded: boolean; onClose: () => void; hidden?: boolean }) {
  const panel = useRef<HTMLElement>(null)
  useLayoutEffect(() => { if (expanded) panel.current?.focus({ preventScroll: true }) }, [expanded])
  const [draft, setDraft] = useState<{ instrument: Instrument; level: number } | null>(null)
  const gesture = useRef<{ instrument: Instrument; level: number } | null>(null)
  const previewLevel = (instrument: Instrument, level: number) => { gesture.current = { instrument, level }; setDraft({ instrument, level }); onPreview?.({ ...project.mix, [instrument]: { ...project.mix[instrument], level } }) }
  const commit = () => { const changed = gesture.current; gesture.current = null; setDraft(null); if (!changed) return; if (changed.level !== project.mix[changed.instrument].level) onEdit({ ...project, mix: { ...project.mix, [changed.instrument]: { ...project.mix[changed.instrument], level: changed.level } } }); else onPreview?.(project.mix) }
  const cancel = () => { gesture.current = null; setDraft(null); onPreview?.(project.mix) }
  return <section hidden={hidden} id="studio-mixer" ref={panel} tabIndex={expanded ? -1 : undefined} className={`compact-mixer ${expanded ? 'compact-mixer--expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? false : undefined} aria-label={expanded ? 'Mixer' : 'Track sounds and volume'} onKeyDown={event => { if (expanded && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); onClose() } }} style={{ '--tracks': instruments.length } as React.CSSProperties}>{expanded && <header className="mixer-window-heading"><StudioIcon name="mixer" /><h2>Mixer</h2><span>Instrument levels</span><button type="button" onClick={() => { cancel(); onClose() }}>Close mixer</button></header>}{instruments.map(instrument => <div className={`mixer-strip instrument--${instrument}`} key={instrument} data-help-target={`mixer-${instrument}`}><strong><span className="track-dot" />{instrumentName[instrument]}</strong><label><span className="sr-only">{instrumentName[instrument]} volume</span><output>{draft?.instrument === instrument ? draft.level : project.mix[instrument].level}%</output><input aria-label={`${instrumentName[instrument]} volume`} type="range" min="0" max="100" step="1" value={draft?.instrument === instrument ? draft.level : project.mix[instrument].level} onChange={event => previewLevel(instrument, Number(event.target.value))} onPointerUp={commit} onPointerCancel={cancel} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit() }} onBlur={commit} /></label><button type="button" aria-label={`Mute ${instrumentName[instrument]}`} aria-pressed={project.mix[instrument].muted} onClick={() => { cancel(); onEdit({ ...project, mix: { ...project.mix, [instrument]: { ...project.mix[instrument], muted: !project.mix[instrument].muted } } }) }}>Mute</button></div>)}<span className="track-capabilities" title="Pan, effects and expression are planned; volume and mute work now.">{expanded ? 'Volume and mute affect playback and WAV. Effects, pan and audio routing are not available yet.' : 'Volume & mute'}</span></section>
}
