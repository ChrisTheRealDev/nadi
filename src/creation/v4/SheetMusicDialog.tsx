import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalFocus } from '../useModalFocus'
import { createSheetMusic, scoreSourceLookup, type ScoreOptions, type ScoreResult } from './sheetMusic'
import type { StudioProject } from './model'
import { ScoreEditor, type ScoreEditorProps } from './ScoreEditor'
import type { ScoreSelection } from './notationCommands'
import { importMusicXml, type MusicXmlImport } from './musicXmlImport'
import { PlayabilityPanel } from './playabilityPanel'
import { defaultNotation, DEFAULT_TRACK } from './notationModel'
import './sheetMusic.css'
import { bindScoreDrag } from './scoreDrag'
import { clearScoreViews, createScoreViewCache, detachView, disposeView, type EngravedView, type ScoreViewCache } from './scoreViewCache'

const MAX_CACHED_NOTE_MARKS = 4096
const MAX_CACHED_XML_LENGTH = 1_048_576

interface ScoreRequest { project: StudioProject; options: ScoreOptions; key: string }
interface ScorePreview {
  request: ScoreRequest
  phase: 'working' | 'waiting' | 'ready' | 'error'
  status: string
  score?: ScoreResult
  start?: () => void
}

function afterScorePaint(signal: AbortSignal) {
  return new Promise<void>(resolve => {
    let frame: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    if (signal.aborted) { done(); return }
    signal.addEventListener('abort', done, { once: true })
    // Background tabs and non-browser tests may not deliver an animation frame.
    if (typeof requestAnimationFrame === 'function' && !document.hidden) {
      frame = requestAnimationFrame(() => { timer = setTimeout(done, 0) })
    } else timer = setTimeout(done, 0)
  })
}

export function SheetMusic({ project, onClose, onChange, onUndo, onRedo, canUndo, canRedo, onPlay, onStop, playing, viewCache, initialTrackId = '' }: { initialTrackId?: string; project: StudioProject; onClose: () => void; onPlay?: () => void; onStop?: () => void; playing?: boolean; viewCache?: ScoreViewCache } & Partial<Omit<ScoreEditorProps, 'project' | 'selection' | 'onSelection'>>) {
  const editable = !!onChange
  const editCallback = useRef(onChange)
  useEffect(() => { editCallback.current = onChange }, [onChange])
  const [fullScreen, setFullScreen] = useState(false)
  const [pageZoom, setPageZoom] = useState(100)
  const [zoomMode, setZoomMode] = useState('page')
  const [showSettings, setShowSettings] = useState(false)
  const scoreScroll = useRef<HTMLDivElement>(null)
  const nativeFullscreen = useRef(false)
  const lastFullscreenExit = useRef(0)
  const mounted = useRef(true)
  const [selection, setSelection] = useState<ScoreSelection[]>([])
  const [storedImportPreview, setImportPreview] = useState<MusicXmlImport | null>(null)
  // A preview contains a snapshot of the source. Never offer it after another edit.
  const importPreview = storedImportPreview?.project.id === project.id && storedImportPreview.project.revision === project.revision ? storedImportPreview : null
  const [importError, setImportError] = useState('')
  const importRequest = useRef(0)
  useEffect(() => () => { importRequest.current++ }, [project.id, project.revision])
  const readImport = async (file: File) => {
    const request = ++importRequest.current
    setImportPreview(null); setImportError('')
    try {
      if (file.size > 10_000_000) throw new Error('MusicXML exceeds the 10 MB import limit.')
      const xml = await file.text()
      if (request !== importRequest.current) return
      setImportPreview(importMusicXml(xml, project))
    } catch (error) {
      if (request === importRequest.current) setImportError(error instanceof Error ? error.message : 'Import failed.')
    }
  }
  const [staffSize, setStaffSize] = useState(7)
  const [pitchMode, setPitchMode] = useState<'concert'|'written'>(initialTrackId ? 'written' : 'concert')
  const [trackId, setTrackId] = useState(initialTrackId)
  const [grid, setGrid] = useState<ScoreOptions['grid']>(project.notation ? 1 : 120)
  const [spelling, setSpelling] = useState<ScoreOptions['spelling']>('sharps')
  const [preview, setPreview] = useState<ScorePreview>()
  const dialog = useRef<HTMLElement>(null), canvas = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const approvedView = useRef<{ projectId: string; key: string } | null>(null)
  const localCache = useRef<ScoreViewCache | null>(null)
  const sharedCache = viewCache?.project === project && viewCache.editable === editable ? viewCache : undefined
  const request = useMemo<ScoreRequest>(() => ({
    project,
    options: { trackId: trackId || undefined, grid, spelling, pitchMode, staffSize },
    key: JSON.stringify([trackId, grid, spelling, pitchMode, staffSize]),
  }), [project, trackId, grid, spelling, pitchMode, staffSize])
  const current = preview?.request === request ? preview : undefined
  const score = current?.score
  const ready = current?.phase === 'ready'
  const working = !current || current.phase === 'working'
  const setStatus = useCallback((status: string) => {
    setPreview(previous => previous?.request === request ? { ...previous, status } : previous)
  }, [request])

  useEffect(() => {
    const root = document.getElementById('root')
    const previous = root?.inert
    if (root) root.inert = true
    return () => { if (root) root.inert = previous ?? false }
  }, [])
  const exitReader = () => {
    setFullScreen(false)
    if (nativeFullscreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
  }
  const toggleFullScreen = async () => {
    if (fullScreen) { exitReader(); return }
    setShowSettings(false); setZoomMode('page'); setFullScreen(true)
    const element = document.documentElement
    if (document.fullscreenElement === element) return
    nativeFullscreen.current = true
    try {
      await element.requestFullscreen?.()
      if (!mounted.current && document.fullscreenElement === element) await document.exitFullscreen()
    } catch { nativeFullscreen.current = false /* Embedded browsers retain the viewport reader. */ }
  }
  useEffect(() => {
    mounted.current = true
    const element = document.documentElement
    const changed = () => {
      if (document.fullscreenElement !== element && nativeFullscreen.current) {
        nativeFullscreen.current = false; lastFullscreenExit.current = Date.now(); setFullScreen(false)
      }
    }
    document.addEventListener?.('fullscreenchange', changed)
    return () => {
      mounted.current = false
      document.removeEventListener?.('fullscreenchange', changed)
      if (nativeFullscreen.current && document.fullscreenElement === element) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  useModalFocus(true, dialog, () => {
    if (canvas.current?.querySelector('.is-dragging')) return
    if (Date.now() - lastFullscreenExit.current < 200) return
    if (fullScreen) exitReader(); else onClose()
  })
  useEffect(() => {
    const scroll = scoreScroll.current
    if (!scroll || zoomMode === 'custom') return
    if (typeof ResizeObserver === 'undefined' || typeof getComputedStyle === 'undefined') return
    const fit = () => {
      const style = getComputedStyle(scroll)
      const width = scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = scroll.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const scale = zoomMode === 'width' ? width / 794 : Math.min(width / 794, height / (794 * 297 / 210))
      if (scale > 0) setPageZoom(Math.max(10, Math.min(300, Math.floor(scale * 100))))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(scroll); fit()
    return () => observer.disconnect()
  }, [zoomMode, fullScreen, showSettings, ready])
  useEffect(() => () => {
    if (localCache.current) clearScoreViews(localCache.current)
  }, [])
  useEffect(() => {
    if (!sharedCache && (localCache.current?.project !== project || localCache.current?.editable !== editable)) {
      if (localCache.current) clearScoreViews(localCache.current)
      localCache.current = createScoreViewCache(project, editable)
    }
    const cache = sharedCache ?? localCache.current!
    const target = canvas.current!
    const handlers: NonNullable<EngravedView['handlers']> = {
      select: (source, extend) => setSelection(previous => {
        const next = { clipId: source.clipId, noteId: source.noteId }
        const matches = (item: ScoreSelection) => item.clipId === next.clipId && item.noteId === next.noteId
        if (!extend) return [next]
        return previous.some(matches) ? previous.filter(item => !matches(item)) : [...previous, next]
      }),
      commit: (next, label) => editCallback.current?.(next, label) ?? false,
      report: setStatus,
    }
    const viewKey = request.key
    const cachedView = cache.views.get(viewKey)
    if (cachedView) {
      cache.views.delete(viewKey); cache.views.set(viewKey, cachedView)
      cachedView.handlers = handlers
      target.replaceChildren(cachedView.host)
      setPreview({ request, score: cachedView.score, phase: 'ready', status: cachedView.status })
      return () => detachView(cachedView)
    }

    const controller = new AbortController()
    const { signal } = controller
    let pendingView: EngravedView | undefined
    let retained = false
    target.replaceChildren()
    async function render() {
      let score: ScoreResult | undefined
      try {
        await afterScorePaint(signal)
        if (signal.aborted) return
        score = createSheetMusic(request.project, request.options)
        const large = Math.max(score.noteCount, score.mapping.length) > MAX_CACHED_NOTE_MARKS || score.xml.length > MAX_CACHED_XML_LENGTH
        if (large && (approvedView.current?.projectId !== project.id || approvedView.current.key !== viewKey)) {
          await new Promise<void>(resolve => {
            const start = () => {
              signal.removeEventListener('abort', start)
              resolve()
            }
            signal.addEventListener('abort', start, { once: true })
            setPreview({ request, score, phase: 'waiting', status: 'This is a large score. Render it now, or choose an instrument part.', start })
          })
          if (signal.aborted) return
          approvedView.current = { projectId: project.id, key: viewKey }
        }
        setPreview({ request, score, phase: 'working', status: 'Preparing sheet music…' })
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
        await afterScorePaint(signal)
        if (signal.aborted) return

        const host = document.createElement('div')
        host.inert = true
        target.appendChild(host)
        const view: EngravedView = { host, score, status: '', drags: [], handlers }
        pendingView = view
        const display = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', pageFormat: 'A4_P', drawTitle: true, drawComposer: true, autoBeam: true })
        view.clearDisplay = () => display.clear()
        display.Zoom = 0.85
        await display.load(score.xml)
        if (signal.aborted) return
        setStatus('Engraving your sheet music…')
        if (large) await afterScorePaint(signal)
        if (signal.aborted) return
        // OSMD renders paginated A4 synchronously. Its incremental API supports
        // endless or horizontal previews, which would change layout and print.
        display.render()
        if (large) {
          setStatus('Pages rendered. Preparing note controls…')
          await afterScorePaint(signal)
        }
        if (signal.aborted) return
        const sources = scoreSourceLookup(score.mapping)
        let nextPaint = performance.now() + 12
        for (const measure of display.GraphicSheet.MeasureList) {
          if (large && performance.now() >= nextPaint) {
            await afterScorePaint(signal)
            if (signal.aborted) return
            nextPaint = performance.now() + 12
          }
          for (const [staffIndex, staff] of measure.entries()) {
            // OSMD's per-measure staff array can be sparse (e.g. a staff not shown in this
            // part/pitch-mode combination); a hole here must not abort the whole render.
            if (!staff) continue
            for (const entry of staff.staffEntries) for (const voice of entry.graphicalVoiceEntries) for (const note of voice.notes) {
              if (!note.sourceNote.Pitch) continue
              const tick = Math.round(note.sourceNote.getAbsoluteTimestamp().RealValue * 1920), pitch = note.sourceNote.Pitch.getHalfTone() + 12
              const source = sources.get(`${staffIndex}:${note.sourceNote.ParentVoiceEntry.ParentVoice.VoiceId}:${tick}:${pitch}`)
              if (!source) continue
              const g = note as typeof note & { getSVGGElement?: () => SVGGElement; getNoteheadSVGs?: () => HTMLElement[]; vfnoteIndex?: number }
              const target = g.getNoteheadSVGs?.()[g.vfnoteIndex ?? 0] ?? g.getSVGGElement?.()
              if (!target) continue
              target.classList.add('nadi-score-note'); target.setAttribute('tabindex','0'); target.setAttribute('role','button')
              target.setAttribute('aria-label', `${editable ? 'Select' : 'Inspect'} pitch ${source.pitch}, beat ${source.tick / 480 + 1}`)
              target.dataset.clipId = source.clipId; target.dataset.noteId = source.noteId
              if (editable) {
                const vf = staff as typeof staff & { getVFStave?: () => { getSpacingBetweenLines: () => number } }
                const scale = () => { const matrix = (target as unknown as SVGGraphicsElement).getScreenCTM?.(); return matrix ? Math.hypot(matrix.a, matrix.b) : .85 }
                view.drags.push(bindScoreDrag(target, { source, project, flats: spelling === 'flats', commit: (next, label) => view.handlers?.commit(next, label) ?? false, status: text => view.handlers?.report(text),
                  staffStep: () => (vf.getVFStave?.().getSpacingBetweenLines() ?? 10) * scale() / 2,
                  pixelsPerBeat: () => staff.PositionAndShape.Size.width * 10 * scale() / Math.max(1, staff.parentSourceMeasure.Duration.RealValue * 4),
                }))
              }
              const choose = (extend: boolean) => view.handlers?.select(source, extend)
              target.addEventListener('click', e => { e.stopPropagation(); choose((e as MouseEvent).shiftKey) })
              target.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); choose((e as KeyboardEvent).shiftKey) } })
            }
          }
        }
        const ambiguous = [...sources.values()].some(source => source === null)
        view.status = `${score.partCount} ${score.partCount === 1 ? 'part' : 'parts'} · ${score.bars} bars · ${score.noteCount} notes${ambiguous && editable ? ' · Overlapping unison notes: use Detailed notation controls → Accessible note selection to edit these safely.' : ''}`
        // Keep two recent views, with a size limit that also covers rest-heavy XML.
        if (!large) {
          if (cache.views.size >= 2) {
            const oldest = cache.views.entries().next().value
            if (oldest) { disposeView(oldest[1]); cache.views.delete(oldest[0]) }
          }
          cache.views.set(viewKey, view)
          retained = true
        }
        host.inert = false
        setPreview({ request, score, phase: 'ready', status: view.status })
      } catch (error) {
        if (signal.aborted) return
        if (pendingView) { disposeView(pendingView); pendingView = undefined }
        const message = error instanceof Error ? error.message : 'Could not convert this score.'
        setPreview({ request, score, phase: 'error', status: score ? `Preview could not render. You can still download MusicXML. ${message}` : message })
      }
    }
    void render()
    return () => {
      controller.abort()
      if (!pendingView) return
      if (retained) detachView(pendingView); else disposeView(pendingView)
    }
  }, [request, editable, project, spelling, sharedCache, setStatus])
  useEffect(() => { canvas.current?.querySelectorAll<HTMLElement>('.nadi-score-note').forEach(n => n.classList.toggle('selected', selection.some(s => s.clipId === n.dataset.clipId && s.noteId === n.dataset.noteId))) }, [selection, ready])
  const download = (extension: 'musicxml'|'xml') => {
    if (!score) return
    const url = URL.createObjectURL(new Blob([score.xml], { type: 'application/vnd.recordare.musicxml+xml' }))
    const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'NADI score'}.${extension}`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }
  const print = () => {
    const svgs = canvas.current?.querySelectorAll('svg')
    if (!ready || !svgs?.length) return
    const frame = document.createElement('iframe')
    frame.title = 'Print sheet music'; frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0'
    document.body.appendChild(frame)
    const doc = frame.contentDocument!
    doc.open(); doc.write('<!doctype html><html><head><title>Sheet music</title><style>@page{size:A4 portrait;margin:0}body{margin:0}section{width:210mm;height:297mm;break-after:page;overflow:hidden}section:last-child{break-after:auto}svg{width:210mm;height:297mm;display:block}</style></head><body></body></html>'); doc.close()
    doc.title = project.name
    for (const svg of svgs) { const page = doc.createElement('section'); page.appendChild(svg.cloneNode(true)); doc.body.appendChild(page) }
    const win = frame.contentWindow!
    win.addEventListener('afterprint', () => frame.remove(), { once: true })
    void doc.fonts.ready.then(() => { win.focus(); win.print() })
    setTimeout(() => frame.remove(), 300000)
  }
  return createPortal(<div className="nadi-score-overlay"><section className={`nadi-score-dialog${fullScreen ? ' nadi-score-dialog--fullscreen' : ''}${showSettings ? ' nadi-score-dialog--settings' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="score-title" tabIndex={-1}>
    <header className="nadi-score-header"><div><span className="nadi-score-eyebrow">NADI · FROM COMPOSITION TO PAGE</span><h2 id="score-title">Sheet music</h2><p>{project.name}</p></div><div className="nadi-score-window-actions"><button type="button" aria-pressed={fullScreen} onClick={() => void toggleFullScreen()}>{fullScreen ? 'Exit full screen' : 'Full screen'}</button><label>View<select aria-label="Sheet music zoom" value={zoomMode === 'custom' ? String(pageZoom) : zoomMode} onChange={e => { const value = e.target.value; if (value === 'page' || value === 'width') setZoomMode(value); else { setZoomMode('custom'); setPageZoom(Number(value)) } }}><option value="page">Fit page</option><option value="width">Fit width</option>{[25,50,75,100,125,150,200,300].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>{fullScreen && <><label>Part<select aria-label="Reader score part" value={trackId} onChange={e => { setTrackId(e.target.value); setPitchMode(e.target.value ? 'written' : 'concert') }}><option value="">Full score</option>{project.tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button type="button" aria-expanded={showSettings} aria-controls="score-settings" onClick={() => setShowSettings(value => !value)}>Settings</button></>}<button type="button" disabled={!ready} onClick={print}>Print / PDF</button><button type="button" ref={closeButton} onClick={onClose} aria-label="Close sheet music">Close</button></div></header>
    <div className="nadi-score-tools" id="score-settings"><label>Full score or instrument part<select aria-label="Score" value={trackId} onChange={e => { setTrackId(e.target.value); setPitchMode(e.target.value ? 'written' : 'concert') }}><option value="">Full score · all instruments</option>{project.tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Smallest note<select aria-label="Smallest note" value={grid} onChange={e => setGrid(Number(e.target.value) as ScoreOptions['grid'])}><option value={1}>Exact timing</option><option value={240}>Eighth note</option><option value={120}>Sixteenth note</option><option value={60}>Thirty-second note</option></select></label><label>Accidentals<select aria-label="Accidentals" value={spelling} onChange={e => setSpelling(e.target.value as ScoreOptions['spelling'])}><option value="sharps">Prefer sharps</option><option value="flats">Prefer flats</option></select></label><label>Pitch<select value={pitchMode} onChange={e => setPitchMode(e.target.value as typeof pitchMode)}><option value="concert">Concert pitch</option><option value="written">Written performer pitch</option></select></label><label>Staff size<select value={staffSize} onChange={e => setStaffSize(Number(e.target.value))}>{[6,7,8,9].map(v => <option key={v} value={v}>{v} mm</option>)}</select></label><div className="nadi-score-actions">{onPlay && <button onClick={playing ? onStop : onPlay}>{playing ? 'Stop playback' : 'Play composition'}</button>}<button type="button" disabled={!score} onClick={() => download('musicxml')}>Download MusicXML</button><button type="button" disabled={!score} onClick={() => download('xml')}>Download .xml</button><button className="nadi-score-primary" type="button" disabled={!ready} onClick={print}>Print / Save PDF</button></div></div>
    {onChange && <div className="nadi-score-direct-tools"><strong>Drag notes on the page</strong><span>Up / down: staff steps · Left / right: ¼-beat steps · Esc: cancel</span><button onClick={onUndo} disabled={!canUndo}>Undo</button><button onClick={onRedo} disabled={!canRedo}>Redo</button></div>}
    <div className={ready ? 'nadi-score-info' : 'nadi-score-info nadi-score-info--pending'}>
      <span role="status">{current?.status ?? 'Preparing score…'}</span>
      {current?.start && <button type="button" className="nadi-score-render" onClick={() => {
        closeButton.current?.focus()
        current.start?.()
      }}>Render sheet music</button>}
      <p>{pitchMode === 'written' ? 'Written performer pitch' : 'Concert pitch'} · All arranged parts, including muted tracks. {score?.roundedNotes ? `${score.roundedNotes} notes rounded for this preview/export only; your composition is unchanged.` : 'Exact composition timing.'} Instrument profiles determine clefs, staff allocation and transposition.</p>
      {score?.warnings.map(w => <p key={w}>{w}</p>)}
    </div>
    <div className="nadi-score-workarea">
    <div className="nadi-score-sidebar"><PlayabilityPanel project={project} readOnly={!onChange} performerModes={Object.fromEntries(Object.entries(project.notation?.tracks??{}).map(([id,track])=>[id,track.performerMode]))} onReveal={finding=>{const selected=finding.affected.filter(n=>n.clipId).map(n=>({clipId:n.clipId!,noteId:n.noteId}));if(!selected.length){setStatus('This warning concerns an unplaced part. Open that part in the studio to review its notes.');return}setTrackId(finding.trackId);setPitchMode('written');setSelection(selected)}} onPerformerModeChange={onChange ? (trackId,mode)=>{const next=structuredClone(project);next.version=6;next.notation??=defaultNotation();next.notation.tracks[trackId]={...DEFAULT_TRACK,...next.notation.tracks[trackId],performerMode:mode};onChange(next,'Changed performer assumption')} : undefined}/>{onChange && <><ScoreEditor project={project} onChange={onChange} selection={selection} onSelection={setSelection} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo}/><details className="nadi-score-import"><summary>Import MusicXML</summary><p>Preview supported content and warnings before replacing the score. Undo restores the previous composition.</p><input type="file" accept=".xml,.musicxml,application/xml" aria-label="Import MusicXML" onChange={e => { const file=e.target.files?.[0]; if(!file)return;void readImport(file);e.currentTarget.value='' }}/>{importError && <p role="alert">{importError}</p>}{importPreview && <div><p>{importPreview.partCount} parts · {importPreview.noteCount} notes</p>{importPreview.warnings.map(w=><p key={w}>{w}</p>)}<button onClick={()=>{if(onChange(importPreview.project,'Imported MusicXML score')){setImportPreview(null);setSelection([])}}}>Replace score with imported XML</button><button onClick={()=>{importRequest.current++;setImportPreview(null)}}>Cancel import</button></div>}</details></>}</div>
    <div className="nadi-score-scroll" ref={scoreScroll} aria-label="Score pages" aria-busy={working}><div className="nadi-score-pages" style={{ zoom: pageZoom / 100 }} ref={canvas} /></div></div>
  </section></div>, document.body)
}



