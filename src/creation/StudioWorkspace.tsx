import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { PianoKeys, type CreationViewProps } from './CreationView'
import { NavItem } from '../components/NavItem'
import { NadiBird } from '../components/NadiBrand'
import { NumericDraft } from './NumericDraft'
import { STUDIO_PANELS, clampWorkspaceSplit, loadWorkspaceV2, saveWorkspaceV2, workspaceReducer, type StudioPanelId } from './workspacePreferencesV2'
import { nextWorkspaceMenu, nextWorkspaceTab } from './workspaceKeyboard'
import { matchesHelpDestination, type HelpDestination } from './helpTarget'
import './studioWorkspace.css'

export interface StudioWorkspaceHandle {
  openPanel: (panel: StudioPanelId, alongside?: boolean) => void
  revealTarget: (target: string, options?: { panel?: StudioPanelId } & HelpDestination) => void
  openIdeas: () => void
  setMiraOpen: (open: boolean) => void
  resetLayout: () => void
}
export interface StudioWorkspaceProps extends CreationViewProps {
  metronomeEnabled?: boolean
  onToggleMetronome?: () => void
  metronomeControls?: ReactNode
  projectDetails?: ReactNode
  onSheetMusic?: () => void
  notesContent?: ReactNode
  drumsContent?: ReactNode
  undoLabel?: string
  redoLabel?: string
  historyContent?: ReactNode
  recoveryContent?: ReactNode
  feedbackContent?: ReactNode
  onPanelVisibilityChange?: (visible: StudioPanelId[]) => void
  onPanelActivate?: (panel: StudioPanelId) => void
  onActivateEditor?: (mode: 'piano' | 'drums') => void
  onMiraVisibilityChange?: (open: boolean) => void
  onNewSirensStudy?: () => void
  onDownloadSirensStudy?: () => void
}
const LABELS: Record<StudioPanelId, string> = { notes: 'Notes', arrangement: 'Arrangement', drums: 'Drums', mixer: 'Mixer', sounds: 'Sounds', keyboard: 'Keyboard', ideas: 'Idea Pad' }
const KEY_NOTES: Record<string, number> = { a:57,s:60,d:64 }
const isTyping = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))

export const StudioWorkspace = forwardRef<StudioWorkspaceHandle, StudioWorkspaceProps>(function StudioWorkspace(props, ref) {
  const [workspace, dispatch] = useReducer(workspaceReducer, props.workspace?.mira ?? false, legacy => loadWorkspaceV2(undefined, legacy))
  const [maximised, setMaximised] = useState<StudioPanelId | null>(null)
  const [fullScreen, setFullScreen] = useState(false)
  const fullScreenWanted = useRef(false)
  const ownsNativeFullScreen = useRef(false)
  const fullScreenRequest = useRef(0)
  const fullScreenReturn = useRef<HTMLElement | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const shell = useRef<HTMLDivElement>(null)
  const slots = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const held = useRef(new Set<string>())
  const dividerDrag = useRef<{pointer:number; original:number} | null>(null)
  const tabbed = workspace.slots.length === 2 && availableWidth > 0 && availableWidth < 848
  const visible = workspace.slots.filter(id => maximised ? id === maximised : !tabbed || id === workspace.active)
  const visibleKey = visible.join(',')
  const keyboardVisible = visible.includes('keyboard')
  const startBar = props.startBar ?? props.selectedBar
  const shownBars = props.visibleBars ?? 4
  const busy = props.recording || props.hasTake
  const exitFullScreen = () => {
    fullScreenWanted.current = false; fullScreenRequest.current++; setFullScreen(false); setMaximised(null)
    if (ownsNativeFullScreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
    ownsNativeFullScreen.current = false
    requestAnimationFrame(() => fullScreenReturn.current?.isConnected && fullScreenReturn.current.focus({ preventScroll: true }))
  }
  useEffect(() => {
    const changed = () => {
      if (ownsNativeFullScreen.current && !document.fullscreenElement) {
        ownsNativeFullScreen.current = false; fullScreenWanted.current = false
        setFullScreen(false); setMaximised(null)
        requestAnimationFrame(() => fullScreenReturn.current?.isConnected && fullScreenReturn.current.focus({ preventScroll: true }))
      }
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      fullScreenWanted.current = false
      document.removeEventListener('fullscreenchange', changed)
      if (ownsNativeFullScreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (!fullScreen) return
    const escape = (event: globalThis.KeyboardEvent) => {
      // Internal gesture cancellation dispatches Escape directly on window.
      // Dialogs and editors may consume their first Escape before exiting.
      if (event.key === 'Escape' && !event.defaultPrevented && event.target !== window && !(event.target instanceof Element && event.target.closest('[role="dialog"]'))) {
        fullScreenWanted.current = false; setFullScreen(false); setMaximised(null)
        if (ownsNativeFullScreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
        ownsNativeFullScreen.current = false
        requestAnimationFrame(() => fullScreenReturn.current?.isConnected && fullScreenReturn.current.focus({ preventScroll: true }))
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [fullScreen])
  const releaseComputerKeys = () => { held.current.forEach(key => latest.current.onNoteOff(KEY_NOTES[key])); held.current.clear() }
  useLayoutEffect(() => {
    const element = slots.current
    if (!element) return
    const resize = () => setAvailableWidth(element.clientWidth)
    resize(); const observer = new ResizeObserver(resize); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { saveWorkspaceV2(workspace) }, [workspace])
  useEffect(() => {
    if (!openMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(`[data-sw-menu="${openMenu}"]`)) setOpenMenu(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [openMenu])
  useEffect(() => { latest.current.onMiraVisibilityChange?.(workspace.mira) }, [workspace.mira])
  useLayoutEffect(() => { latest.current.onPanelVisibilityChange?.(visibleKey ? visibleKey.split(',') as StudioPanelId[] : []) }, [visibleKey])
  useLayoutEffect(() => {
    if (!keyboardVisible) { held.current.forEach(key => latest.current.onNoteOff(KEY_NOTES[key])); held.current.clear() }
  }, [keyboardVisible])
  useEffect(() => {
    const keys = held.current
    const release = () => { keys.forEach(key => latest.current.onNoteOff(KEY_NOTES[key])); keys.clear() }
    const keyup = (event: globalThis.KeyboardEvent) => { const key = event.key.toLowerCase(); if (keys.delete(key)) latest.current.onNoteOff(KEY_NOTES[key]) }
    window.addEventListener('blur',release); window.addEventListener('keyup',keyup)
    return () => { release(); window.removeEventListener('blur',release); window.removeEventListener('keyup',keyup) }
  }, [])
  const cancelGesture = () => {
    window.dispatchEvent(new globalThis.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    releaseComputerKeys()
  }
  const toggleFullScreen = (panel: StudioPanelId) => {
    cancelGesture(); setOpenMenu(null)
    if (fullScreenWanted.current) { exitFullScreen(); return }
    fullScreenReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    fullScreenWanted.current = true; setFullScreen(true); setMaximised(panel)
    const request = ++fullScreenRequest.current
    // Fullscreen the document, not this shell: existing body-portaled dialogs
    // must remain visible. CSS supplies a usable fallback if the API is denied.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      ownsNativeFullScreen.current = true
      try {
        void document.documentElement.requestFullscreen().then(() => {
          if (!fullScreenWanted.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
        }).catch(() => { if (request === fullScreenRequest.current) ownsNativeFullScreen.current = false })
      } catch { if (request === fullScreenRequest.current) ownsNativeFullScreen.current = false }
    }
  }
  const activate = (id: StudioPanelId) => {
    dispatch({type:'activate',panel:id})
    if (workspace.active !== id) {
      props.onPanelActivate?.(id)
      if (id === 'notes' || id === 'drums') props.onActivateEditor?.(id === 'notes' ? 'piano' : 'drums')
    }
  }
  const open = (id: StudioPanelId, alongside = false) => {
    cancelGesture(); setOpenMenu(null); setMaximised(null); dispatch({type:'open',panel:id,alongside})
    props.onPanelActivate?.(id)
    if (id === 'notes' || id === 'drums') props.onActivateEditor?.(id === 'notes' ? 'piano' : 'drums')
    requestAnimationFrame(() => shell.current?.querySelector<HTMLElement>(`[data-work-panel="${id}"]`)?.focus({preventScroll:true}))
  }
  const close = (id: StudioPanelId) => { cancelGesture(); setMaximised(null); dispatch({type:'close',panel:id}); requestAnimationFrame(() => shell.current?.querySelector<HTMLButtonElement>(`[data-panel-button="${id}"]`)?.focus()) }
  const setMira = (open: boolean) => dispatch({type:'mira',open})
  const revealTarget = (target: string, options?: { panel?: StudioPanelId } & HelpDestination) => {
    const map: Record<string,StudioPanelId> = {
      'pattern-playlist':'arrangement','duplicate-independent':'arrangement','repeat-linked':'arrangement','delete-clips':'arrangement','delete-clip':'arrangement',
      'track-mixer':'mixer','track-pan':'mixer','track-space':'mixer','track-expression':'mixer','piano-keys':'keyboard','instrument-picker':'sounds','editor-drums':'drums','drum-grid':'drums','editor-piano':'notes',
      'delete-notes':'notes','piano-roll':'notes','select-chord':'notes','note-body':'notes','note-resize':'notes','note-tools':'notes','preview-notes':'notes','duplicate-bar':'notes','repeat-next-bar':'notes',
      'drum-timeline':'drums','pattern-context':'notes','make-independent':'notes','track-controls':'sounds','track-settings':'sounds','track-sound':'sounds','delete-track':'sounds',
    }
    const panel = options?.panel ?? map[target]
    if (panel) open(panel)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // A collapsed section may deliberately disable its controls. Resolve the intended
      // destination first, reveal ancestors, then check readiness after their toggle render.
      const matches = Array.from(shell.current?.querySelectorAll<HTMLElement>('[data-help-target]') ?? []).filter(item => item.dataset.helpTarget === target && matchesHelpDestination(target, { trackId: item.dataset.helpTrackId ?? item.closest<HTMLElement>('[data-help-track-id]')?.dataset.helpTrackId, clipId: item.dataset.helpClipId }, options) && !item.closest('[hidden]'))
      const element = panel ? matches.find(item => item.closest(`[data-work-panel="${panel}"]`)) : matches[0]
      if (!element) return
      let ancestor: HTMLElement | null = element.parentElement
      while (ancestor && ancestor !== shell.current) { if (ancestor instanceof HTMLDetailsElement) { const menuId = ancestor.dataset.swMenu; if (menuId) setOpenMenu(menuId); else ancestor.open = true } ancestor = ancestor.parentElement }
      if (element instanceof HTMLDetailsElement) element.open = true
      const focus = (attempt = 0) => {
        if (!element.isConnected || element.closest('[hidden], [inert]')) return
        if (!element.getClientRects().length || element.matches(':disabled')) { if (attempt < 8) requestAnimationFrame(() => focus(attempt + 1)); return }
        element.focus({preventScroll:true}); element.scrollIntoView({block:'nearest',inline:'nearest'})
      }
      requestAnimationFrame(() => focus())
    }))
  }
  useImperativeHandle(ref, () => ({openPanel:open,revealTarget,openIdeas:()=>open('ideas'),setMiraOpen:setMira,resetLayout:()=>{cancelGesture();setMaximised(null);dispatch({type:'reset'})}}))
  const revealToken = useRef(props.revealIdeaPadToken)
  useEffect(() => { if (props.revealIdeaPadToken === revealToken.current) return; revealToken.current = props.revealIdeaPadToken; if (!props.revealIdeaPadToken) return; const frame=requestAnimationFrame(()=>{dispatch({type:'open',panel:'ideas'});setMaximised(null)}); return ()=>cancelAnimationFrame(frame) },[props.revealIdeaPadToken])
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTyping(event.target) && event.key !== 'Escape') return
    if ((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation(); if (event.shiftKey || event.key.toLowerCase() === 'y') props.onRedo(); else props.onUndo(); return
    }
    if (event.key === 'Escape') {
      if (dividerDrag.current) { dispatch({type:'split',split:dividerDrag.current.original}); dividerDrag.current = null }
      if (openMenu) {
        event.preventDefault(); event.stopPropagation()
        const trigger = shell.current?.querySelector<HTMLElement>(`[data-sw-menu="${openMenu}"] > summary`)
        setOpenMenu(null); requestAnimationFrame(() => trigger?.focus({preventScroll:true}))
        return
      }
      shell.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(element => { element.open = false })
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return
    const shortcut: Record<string,StudioPanelId> = { F5:'arrangement',F6:'drums',F7:'notes',F9:'mixer' }
    if (shortcut[event.key]) { event.preventDefault(); open(shortcut[event.key]); return }
    const key = event.key.toLowerCase()
    if (keyboardVisible && workspace.active === 'keyboard' && KEY_NOTES[key] !== undefined && !held.current.has(key)) { event.preventDefault(); held.current.add(key); props.onNoteOn(KEY_NOTES[key]) }
  }
  const panelContent: Record<StudioPanelId,ReactNode> = {
    notes:props.notesContent ?? props.editorContent,
    drums:props.drumsContent ?? (props.controlledEditor === 'drums' ? props.editorContent : <p>Choose a drum track to edit its hits.</p>),
    arrangement:props.arrangementContent,mixer:props.mixerContent,sounds:props.soundBrowserContent,
    keyboard:keyboardVisible ? <PianoKeys activeNotes={props.activeNotes} onNoteOn={props.onNoteOn} onNoteOff={props.onNoteOff} /> : null,
    ideas:props.ideaPad,
  }
  const closeMenu = () => setOpenMenu(null)
  const menuSummary = (id: string) => ({ onClick: (event: MouseEvent<HTMLElement>) => { event.preventDefault(); setOpenMenu(current => nextWorkspaceMenu(current, id)) } })
  const split = clampWorkspaceSplit(workspace.split,availableWidth)
  const saveLabel = props.saved === 'Saved' ? 'Autosaved' : props.saved
  return <div ref={shell} className={`creation-shell studio-workspace ${workspace.mira ? 'studio-workspace--mira' : ''} ${fullScreen ? 'studio-workspace--fullscreen' : ''}`} onKeyDown={keyDown}>
    <header className="sw-transport" aria-label="Transport">
      <a className="sw-brand" href="#create" aria-label="NADI studio"><NadiBird /></a>
      <button type="button" className="sw-play" aria-pressed={props.playing} data-help-target="play-song" aria-label={props.playing ? 'Pause' : 'Play song'} onClick={props.playing ? props.onPause ?? props.onStop : props.onPlay}>{props.playing ? 'Ⅱ Pause' : '▶ Play'}</button>
      <button type="button" onClick={props.onStop}>■ Stop</button>
      <button type="button" className={props.recording ? 'sw-record is-recording' : 'sw-record'} data-help-target="record" disabled={props.hasTake} onClick={props.recording ? props.onStop : props.onRecord}>● {props.recording ? props.counting ? `Count ${props.counting}` : 'Recording' : 'Record'}</button>
      <label className="sw-tempo">Tempo<NumericDraft label="Tempo" value={props.project.bpm} min={30} max={240} integer disabled={busy} onCommit={bpm => props.onEdit({...props.project,bpm})} /></label>
      {props.onToggleMetronome && <div className="sw-metronome-group"><button type="button" aria-label="Metronome" aria-pressed={props.metronomeEnabled ?? false} disabled={busy} onClick={props.onToggleMetronome}><NavItem name="metronome" label={props.metronomeEnabled ? 'Metronome on' : 'Metronome off'} /></button><details className="sw-menu sw-metronome-menu" data-sw-menu="metronome" open={openMenu==='metronome'}><summary {...menuSummary('metronome')} aria-label="Metronome settings">⌄</summary><div>{props.metronomeControls}<small>Follows the song tempo during Play and Record. Set a count-in before recording.</small></div></details></div>}
      <div className="sw-undo-group"><button type="button" data-help-target="undo" title={props.undoLabel ? `Undo ${props.undoLabel}` : 'Undo (Ctrl+Z)'} disabled={!props.canUndo || busy} onClick={props.onUndo}>↶ Undo</button><button type="button" title={props.redoLabel ? `Redo ${props.redoLabel}` : 'Redo (Ctrl+Shift+Z)'} disabled={!props.canRedo || busy} onClick={props.onRedo}>↷ Redo</button>
        <details className="sw-menu sw-history" data-sw-menu="history" open={openMenu==='history'}><summary {...menuSummary('history')} aria-label="Edit history" title="Edit history">⌄</summary><div>{props.historyContent ?? <><strong>Edit history</strong><p>{props.undoLabel ? `Undo: ${props.undoLabel}` : 'No earlier edits.'}</p>{props.redoLabel && <p>Redo: {props.redoLabel}</p>}</>}<small>Undo is session-only. Reopening or switching projects clears history.</small></div></details>
      </div>
      {props.projectDetails && <div className="sw-project-details">{props.projectDetails}</div>}
      <span className="sw-save-state" role="status" title={saveLabel}>{saveLabel}</span>
      <button type="button" data-help-target="save-project" onClick={props.onSave}><NavItem name="save" label="Save" /></button>
      <details className="sw-menu file-menu" data-sw-menu="project" open={openMenu==='project'}><summary {...menuSummary('project')}><NavItem name="project" label="Project" /></summary><div>
        <ProjectName key={props.project.id} name={props.project.name} disabled={busy} onCommit={name => props.onEdit({...props.project,name})} />
        <button type="button" disabled={busy} onClick={() => {closeMenu();props.onNew()}}>New project</button>
        {props.onNewSirensStudy && <button type="button" disabled={busy} onClick={() => {closeMenu();props.onNewSirensStudy?.()}}>New Sirens study</button>}
        {props.onDownloadSirensStudy && <button type="button" onClick={() => {closeMenu();props.onDownloadSirensStudy?.()}}>Download blank Sirens setup</button>}
        <button type="button" disabled={busy} data-help-target="open-projects" onClick={() => {closeMenu();shell.current?.querySelector<HTMLElement>('[data-sw-menu="project"] > summary')?.focus();props.onOpen()}}>Open saved project</button>
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Open .nadi / recovery JSON</button>
        <input ref={fileInput} hidden type="file" accept=".nadi,.json" onChange={event => { const file=event.target.files?.[0];event.target.value='';if(file)props.onImport(file) }} />
        {props.recoveryContent}
      </div></details>
      <details className="sw-menu export-menu" data-sw-menu="export" open={openMenu==='export'}><summary {...menuSummary('export')} data-help-target="export"><NavItem name="export" label="Export" /></summary><div>
        {props.onSheetMusic && <button type="button" disabled={props.recording} onClick={() => { closeMenu(); shell.current?.querySelector<HTMLElement>('[data-sw-menu="export"] > summary')?.focus(); props.onSheetMusic?.() }}>Sheet music / PDF</button>}
        <button type="button" onClick={props.onDownload}>NADI project (.nadi)</button><button type="button" onClick={props.onWav}>Audio (.wav)</button><button type="button" onClick={props.onMidi}>MIDI notes (.mid)</button>
        <small>MIDI transfers notes, not exact sounds, pan, Space or expression. WAV uses saved mixing, not temporary Solo.</small>
      </div></details>
    </header>
    <nav className="sw-selector" aria-label="Workspace panels">
      {STUDIO_PANELS.map(id=><button type="button" key={id} aria-label={LABELS[id]} data-panel-button={id} data-help-target={id==='notes'?'editor-piano':id==='drums'?'editor-drums':id==='sounds'?'instrument-picker':undefined} aria-controls={`work-panel-${id}`} aria-pressed={workspace.slots.includes(id)} onClick={()=>open(id)}><NavItem name={id === 'ideas' ? 'microphone' : id} label={id === 'ideas' ? 'Microphone & Idea Pad' : LABELS[id]} /></button>)}
      {props.onSheetMusic && <button type="button" disabled={props.recording} onClick={props.onSheetMusic}><NavItem name="score" label="Sheet music" /></button>}
      <details className="sw-menu sw-alongside" data-sw-menu="alongside" open={openMenu==='alongside'}><summary {...menuSummary('alongside')}><NavItem name="alongside" label="Open alongside" /></summary><div>{STUDIO_PANELS.map(id=><button key={id} type="button" onClick={()=>{closeMenu();open(id,true)}}>{LABELS[id]}{workspace.slots.includes(id)?' · open':''}</button>)}</div></details>
      <details className="sw-menu sw-more" data-sw-menu="more" open={openMenu==='more'}><summary {...menuSummary('more')}><NavItem name="more" label="More" /></summary><div><button type="button" onClick={()=>{closeMenu();open('ideas')}}>Idea Pad</button><button type="button" onClick={()=>{closeMenu();cancelGesture();setMaximised(null);dispatch({type:'reset'})}}>Reset layout</button><small>F5 Arrangement · F6 Drums · F7 Notes · F9 Mixer</small></div></details>
      <details className="sw-menu sw-settings" data-sw-menu="settings" open={openMenu==='settings'}><summary {...menuSummary('settings')}><NavItem name="settings" label="Settings" /></summary><div>{props.studioControls}<button type="button" onClick={props.onConnect}>Connect MIDI</button><small>{props.midiLabel}</small><button type="button" data-help-target="sound-status" onClick={props.onTestSound}>Test sound</button><small>{props.audioLabel}</small><label><input type="checkbox" checked={props.loopBar??false} onChange={props.onToggleLoopBar}/>Loop shown bars</label><label data-help-target="preview-notes"><input type="checkbox" checked={props.previewEnabled??true} onChange={props.onTogglePreview}/>Preview notes</label></div></details>
      <div className="sw-destination">{props.trackControls}</div>
      {fullScreen && <button type="button" className="sw-fullscreen-exit" onClick={exitFullScreen}>Exit full screen</button>}
      <button type="button" className="sw-mira-toggle" aria-label="Mira AI assistant" aria-pressed={workspace.mira} onClick={()=>setMira(!workspace.mira)}><span className="sw-mira-spark" aria-hidden="true">✦</span><span><strong>Mira</strong><small>AI assistant</small></span></button>
    </nav>
    <div className="sw-identity">{(props.recording||props.recordingStatus)&&<span role="status" className="sw-record-status">{props.recordingStatus??(props.counting?`Count-in: ${props.counting}`:'Recording…')}</span>}</div>
    <main className="sw-main">
      {tabbed && !maximised && <div className="sw-slot-tabs" role="tablist" aria-label="Open work panels">{workspace.slots.map(id=><button role="tab" type="button" key={id} id={`work-tab-${id}`} aria-controls={`work-panel-${id}`} aria-selected={workspace.active===id} tabIndex={workspace.active===id?0:-1} onClick={()=>{cancelGesture();activate(id)}} onKeyDown={event=>{const next=nextWorkspaceTab(workspace.slots,id,event.key);if(!next)return;event.preventDefault();event.stopPropagation();activate(next);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#work-tab-${next}`)?.focus()}}>{LABELS[id]}</button>)}</div>}
      <div ref={slots} className={`sw-slots ${visible.length===2?'sw-slots--split':''}`} style={{'--sw-split':`${Math.max(0,availableWidth-8)*split}px`} as CSSProperties}>
        {!workspace.slots.length&&<div className="sw-empty">Choose a panel above to get started.</div>}
        {STUDIO_PANELS.map(id=> {
          const shown=visible.includes(id),position=workspace.slots.indexOf(id)
          return <section key={id} id={`work-panel-${id}`} data-work-panel={id} className={`sw-panel sw-panel--${id} ${workspace.active===id?'sw-panel--active':''}`} style={{gridColumn:visible.length===2?position===0?'1':'3':undefined}} hidden={!shown} inert={!shown||undefined} role={tabbed&&!maximised&&position>=0?'tabpanel':undefined} aria-labelledby={tabbed&&!maximised&&position>=0?`work-tab-${id}`:undefined} tabIndex={-1} aria-label={tabbed&&!maximised&&position>=0?undefined:`${LABELS[id]} panel`} onPointerDownCapture={()=>activate(id)} onFocusCapture={()=>activate(id)}>
            <header className="sw-panel-heading"><h2>{LABELS[id]}</h2>{id==='notes'&&<span className="sw-range">Bars {startBar+1}–{startBar+shownBars}</span>}<button type="button" onClick={()=>{toggleFullScreen(id);activate(id)}} aria-pressed={fullScreen} aria-label={fullScreen ? 'Exit full screen' : `Full screen ${LABELS[id]}`}>{fullScreen?'Exit full screen':'Full screen'}</button><button type="button" aria-label={`Close ${LABELS[id]}`} onClick={()=>close(id)}>×</button></header>
            {id==='notes'&&props.notesContent===undefined&&<div className="sw-note-context">{props.editorContext}<div className="sw-note-view"><button type="button" aria-label="Previous bars" disabled={startBar===0} onClick={()=>props.onSelectBar(Math.max(0,startBar-(props.zoomBars??4)))}>←</button><label>Show<select aria-label="Visible bars" value={props.zoomBars??4} onChange={event=>props.onZoomBars?.(Number(event.target.value) as 1|2|4)}>{[1,2,4].map(n=><option key={n} value={n}>{n} {n===1?'bar':'bars'}</option>)}</select></label><button type="button" aria-label="Next bars" disabled={startBar+shownBars>=props.project.bars} onClick={()=>props.onSelectBar(startBar+shownBars)}>→</button><details className="sw-menu"><summary>Part actions</summary><div>{props.barActionsContent??<><button type="button" data-help-target="repeat-next-bar" onClick={props.onRepeatNextBar} disabled={busy||!props.onRepeatNextBar}>Repeat in next bar</button><button type="button" data-help-target="duplicate-bar" onClick={props.onDuplicateBar} disabled={busy||!props.onDuplicateBar}>Duplicate bar to end</button></>}</div></details></div></div>}
            <div className="sw-panel-content">{panelContent[id]}</div>
          </section>
        })}
        {visible.length===2&&<div className="sw-divider" role="separator" aria-label="Resize work panels" aria-orientation="vertical" aria-valuemin={Math.round(420/(availableWidth-8)*100)} aria-valuemax={Math.round((1-420/(availableWidth-8))*100)} aria-valuenow={Math.round(split*100)} tabIndex={0}
          onPointerDown={event=>{dividerDrag.current={pointer:event.pointerId,original:workspace.split};event.currentTarget.setPointerCapture(event.pointerId)}}
          onPointerMove={event=>{if(!dividerDrag.current)return;const rect=slots.current?.getBoundingClientRect();if(rect)dispatch({type:'split',split:clampWorkspaceSplit((event.clientX-rect.left)/(rect.width-8),rect.width)})}}
          onPointerUp={event=>{dividerDrag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}}
          onPointerCancel={()=>{if(dividerDrag.current)dispatch({type:'split',split:dividerDrag.current.original});dividerDrag.current=null}}
          onKeyDown={event=>{const delta=event.key==='ArrowLeft' ? -.05 : event.key==='ArrowRight' ? .05 : 0;if(delta){event.preventDefault();event.stopPropagation();dispatch({type:'split',split:clampWorkspaceSplit(split+delta,availableWidth)})}else if(event.key==='Home'||event.key==='End'){event.preventDefault();dispatch({type:'split',split:clampWorkspaceSplit(event.key==='Home'?0:1,availableWidth)})}}} />}
      </div>
    </main>
    <aside className="sw-mira" aria-label="Mira companion" hidden={!workspace.mira} inert={!workspace.mira||undefined}>{props.customMira}</aside>
    <footer className="sw-feedback" role="status"><span>{props.message}</span>{props.feedbackContent}</footer>
    {props.hasTake&&<div className="sw-take-scrim" aria-hidden="true" />}
    {props.hasTake&&<div className="sw-take" role="region" aria-label="Recorded take"><strong>Recording ready</strong><p>Your notes are held here and will not appear in the score until you choose.</p><div className="sw-take-actions"><button type="button" className="sw-take-keep" onClick={props.onKeep}>Keep recording</button><button type="button" className="sw-take-discard" onClick={props.onDiscard}>Discard recording</button>{props.onDownloadUnkeptOriginal&&<button type="button" onClick={props.onDownloadUnkeptOriginal}>Download original</button>}</div></div>}
  </div>
})

function ProjectName({name,disabled,onCommit}:{name:string;disabled:boolean;onCommit:(name:string)=>void}) {
  const [draft,setDraft]=useState<string|null>(null)
  const commit=()=>{if(draft===null)return;const value=draft.trim();if(value&&value!==name)onCommit(value);setDraft(null)}
  return <label>Project name<input aria-label="Project name" value={draft??name} maxLength={80} disabled={disabled} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur()}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(null)}}}/></label>
}
