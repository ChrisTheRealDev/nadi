import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useModalFocus } from '../creation/useModalFocus'
import { compileArrangement, SOUND_LABELS, TICKS_PER_BAR, type StudioProject } from '../creation/v4/model'
import { noteName } from '../creation/model'
import './compositionViewer.css'

/** A saved-revision viewer. It never opens or writes the learner's editable store. */
export function CompositionPreview({ project, onPartScore, onAnnotate }: { project: StudioProject; onPartScore: (trackId: string) => void; onAnnotate?: (trackId: string, bar: number) => void }) {
  const [trackId, setTrackId] = useState(project.tracks[0]?.id ?? '')
  const [selectedNote, setSelectedNote] = useState('')
  const [fullScreen, setFullScreen] = useState(false)
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null)
  const [barWidth, setBarWidth] = useState(160)
  const [fitMode, setFitMode] = useState<'notes' | 'song' | null>(null)
  const [theme, setTheme] = useState('eclipse')
  const panel = useRef<HTMLElement>(null), scroller = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null)
  const portalHost = useRef<HTMLDivElement | null>(null), nativeEntered = useRef(false), scrollTarget = useRef<number | null>(null)
  const closeViewer = async () => {
    if (document.fullscreenElement === portalHost.current && document.exitFullscreen) await document.exitFullscreen().catch(() => {})
    flushSync(() => setFullScreen(false))
    opener.current?.focus({ preventScroll: true })
  }
  useModalFocus(fullScreen, panel, () => { void closeViewer() }, opener)
  useEffect(() => {
    if (!fullScreen) return
    const root = document.getElementById('root'), wasInert = root?.inert, overflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    const change = () => {
      if (document.fullscreenElement === portalHost.current) nativeEntered.current = true
      else if (nativeEntered.current) { flushSync(() => setFullScreen(false)); opener.current?.focus({ preventScroll: true }) }
    }
    document.addEventListener('fullscreenchange', change)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      if (root) root.inert = wasInert ?? false
      document.body.style.overflow = overflow
      portalHost.current?.remove(); portalHost.current = null; nativeEntered.current = false
    }
  }, [fullScreen])
  useLayoutEffect(() => { if (scrollTarget.current !== null && scroller.current) { scroller.current.scrollLeft = scrollTarget.current; scrollTarget.current = null } }, [barWidth, fullScreen])
  const expand = () => {
    const appearance = panel.current?.closest('[data-theme]')?.getAttribute('data-theme') ?? 'eclipse'
    setTheme(appearance)
    const host = document.createElement('div'); host.className = 'nadi-composition-viewer-host'; document.body.appendChild(host); portalHost.current = host
    flushSync(() => { setPortalElement(host); setFullScreen(true) })
    // Called within the button gesture. Unsupported/denied native fullscreen
    // keeps the same portaled, full-viewport reading surface available.
    if (host.requestFullscreen) void host.requestFullscreen().then(() => { nativeEntered.current = true }).catch(() => {})
  }
  const track = project.tracks.find(t => t.id === trackId) ?? project.tracks[0]
  const notes = useMemo(() => compileArrangement(project), [project])
  const partNotes = useMemo(() => notes.filter(n => n.trackId === track?.id), [notes, track?.id])
  const selected = partNotes.find(n => n.id === selectedNote)
  const high = Math.min(127, partNotes.reduce((pitch, n) => Math.max(pitch, n.pitch), partNotes.length ? 0 : 72) + 2)
  const low = Math.max(0, partNotes.reduce((pitch, n) => Math.min(pitch, n.pitch), partNotes.length ? 127 : 60) - 2)
  const labelWidth = 64, rowHeight = 26
  const width = project.bars * barWidth, height = (high - low + 1) * rowHeight
  const fit = useCallback((onlyNotes: boolean) => {
    const start = onlyNotes && partNotes.length ? Math.min(...partNotes.map(n => n.startTick)) : 0
    const end = onlyNotes && partNotes.length ? Math.max(...partNotes.map(n => n.startTick + n.durationTicks)) : project.bars * TICKS_PER_BAR
    const next = Math.max(2, Math.min(1200, ((scroller.current?.clientWidth ?? 900) - labelWidth - 24) / Math.max(1, (end - start) / TICKS_PER_BAR)))
    scrollTarget.current = Math.max(0, start / TICKS_PER_BAR * next - 12)
    if (next === barWidth && scroller.current) { scroller.current.scrollLeft = scrollTarget.current; scrollTarget.current = null }
    setBarWidth(next)
  }, [partNotes, project.bars, barWidth])
  useEffect(() => {
    if (!fitMode || !scroller.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => fit(fitMode === 'notes'))
    observer.observe(scroller.current)
    return () => observer.disconnect()
  }, [fitMode, fit, fullScreen])
  const content = <section ref={panel} tabIndex={-1} className={`tp-composition-preview nadi-composition-viewer${fullScreen ? ' is-expanded' : ''}`} data-theme={fullScreen ? theme : undefined} role={fullScreen ? 'dialog' : undefined} aria-modal={fullScreen || undefined} aria-label="Saved composition view">
    <div className="tp-preview-heading"><div><h3>Composition view</h3><p>{project.name} · {project.bars} bars · {project.bpm} BPM · read only</p></div><button ref={fullScreen ? undefined : opener} type="button" onClick={() => { if (fullScreen) void closeViewer(); else expand() }}>{fullScreen ? 'Exit full screen' : 'Full screen'}</button></div>
    {!fullScreen && <p className="tp-subtle">Choose an instrument to inspect its notes. This is the selected saved revision, including muted parts.</p>}
    {!fullScreen && <div className="tp-arrangement-preview" role="group" aria-label="Arrangement by instrument">
      {project.tracks.map(t => <div className="tp-preview-track" key={t.id}><button aria-pressed={track?.id === t.id} onClick={() => { setTrackId(t.id); setSelectedNote('') }}><strong>{t.name}</strong><small>{SOUND_LABELS[t.soundId]}{t.muted ? ' · muted' : ''}</small></button><div className="tp-preview-clips" style={{ backgroundSize: `${100 / project.bars}% 100%` }}>{project.clips.filter(c => c.trackId === t.id).map(c => { const p = project.patterns.find(p => p.id === c.patternId); if (!p) return null; return <button key={c.id} onClick={() => { setTrackId(t.id); setSelectedNote('') }} title={`${p.name} · starts at bar ${c.startTick / TICKS_PER_BAR + 1}`} style={{ left: `${c.startTick / (project.bars * TICKS_PER_BAR) * 100}%`, width: `${Math.min(p.lengthTicks, project.bars * TICKS_PER_BAR - c.startTick) / (project.bars * TICKS_PER_BAR) * 100}%`, borderColor: t.color }}><span>{p.name}</span></button> })}</div></div>)}
    </div>}
    {track && <><div className="nadi-viewer-toolbar">
      <label>Instrument<select value={track.id} onChange={e => { setTrackId(e.target.value); setSelectedNote('') }}>{project.tracks.map(t => <option key={t.id} value={t.id}>{t.name}{t.muted ? ' · muted' : ''}</option>)}</select></label>
      <div className="nadi-viewer-zoom" role="group" aria-label="Timeline zoom"><button type="button" aria-label="Zoom timeline out" disabled={barWidth <= 2} onClick={() => { setFitMode(null); setBarWidth(value => Math.max(2, value / 1.5)) }}>−</button><output aria-label="Timeline zoom level">{Math.round(barWidth / 160 * 100)}%</output><button type="button" aria-label="Zoom timeline in" disabled={barWidth >= 1200} onClick={() => { setFitMode(null); setBarWidth(value => Math.min(1200, value * 1.5)) }}>+</button><button type="button" onClick={() => { setFitMode('notes'); fit(true) }}>Fit notes</button><button type="button" onClick={() => { setFitMode('song'); fit(false) }}>Fit song</button></div>
      <button type="button" onClick={async () => { if (fullScreen) await closeViewer(); onPartScore(track.id) }}>Sheet music</button>
      <span className="nadi-viewer-note-count">{partNotes.length} notes · read only</span>
    </div>
      <div ref={scroller} className="tp-notes-preview nadi-viewer-scroll" tabIndex={0} aria-label={`${track.name} piano roll. Scroll sideways for later bars and vertically for pitches.`}>
        <div className="nadi-viewer-grid" style={{ width: width + labelWidth }}>
          <div className="nadi-viewer-ruler"><span className="nadi-viewer-corner" style={{ width: labelWidth }}>Pitch</span><svg width={width} height={32} style={{ width, height:32 }} aria-hidden="true">{Array.from({ length: project.bars }, (_, i) => i % Math.max(1, Math.ceil(42 / barWidth)) === 0 && <text key={i} x={i * barWidth + 5} y={21}>B{i + 1}</text>)}</svg></div>
          <div className="nadi-viewer-grid-body"><div className="nadi-viewer-pitches" style={{ width: labelWidth }} aria-hidden="true">{Array.from({ length: high - low + 1 }, (_, i) => <div key={i} className={[1,3,6,8,10].includes((high - i) % 12) ? 'black' : ''} style={{ height: rowHeight }}>{noteName(high - i)}</div>)}</div>
          <svg width={width} height={height} style={{ width, height }} role="group" aria-label={`${partNotes.length} arranged notes for ${track.name}`}>
            {Array.from({ length: high - low + 1 }, (_, i) => <rect key={i} x={0} y={i * rowHeight} width={width} height={rowHeight} className={[1,3,6,8,10].includes((high - i) % 12) ? 'tp-preview-black' : 'tp-preview-white'} />)}
            {Array.from({ length: project.bars * (barWidth >= 120 ? 4 : 1) }, (_, i) => { const x = i * barWidth / (barWidth >= 120 ? 4 : 1); return <line key={i} className={barWidth >= 120 && i % 4 ? 'nadi-viewer-beat' : ''} x1={x} x2={x} y1={0} y2={height} /> })}
            {partNotes.map(n => <rect key={n.id} role="button" tabIndex={0} aria-label={`${noteName(n.pitch)}, bar ${Math.floor(n.startTick / TICKS_PER_BAR) + 1}`} aria-pressed={selectedNote === n.id} className={`tp-preview-note${selectedNote === n.id ? ' selected' : ''}`} x={n.startTick / TICKS_PER_BAR * barWidth} y={(high - n.pitch) * rowHeight + 3} width={Math.max(5, n.durationTicks / TICKS_PER_BAR * barWidth)} height={rowHeight - 6} rx={4} onClick={() => setSelectedNote(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedNote(n.id) } }}><title>{noteName(n.pitch)} · bar {Math.floor(n.startTick / TICKS_PER_BAR) + 1} · {n.durationTicks / 480} beats</title></rect>)}
          </svg></div>
        </div>
      </div>
      {!partNotes.length && <p>No arranged notes for this instrument in this revision.</p>}
      <div className="tp-note-inspection nadi-viewer-inspection" role="status">{selected ? <><span>{noteName(selected.pitch)} · bar {Math.floor(selected.startTick / TICKS_PER_BAR) + 1} · beat {selected.startTick % TICKS_PER_BAR / 480 + 1} · length {selected.durationTicks / 480} beats</span>{onAnnotate && <button type="button" onClick={async () => { if (fullScreen) await closeViewer(); onAnnotate(track.id, Math.floor(selected.startTick / TICKS_PER_BAR) + 1) }}>Comment on this bar</button>}</> : <span>Select a note to inspect it{onAnnotate ? ' or anchor a comment' : ''}.{fullScreen ? ' Escape exits full screen.' : ''}</span>}</div>
    </>}
  </section>
  return fullScreen && portalElement ? createPortal(content, portalElement) : content
}
