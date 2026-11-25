import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { ExpressionPoint, Track, TrackProduction } from './model'
import { NumericDraft } from '../NumericDraft'
import { expressionAt, expressionEntryPoint, putExpressionPoint } from './expressionEditing'

const BAR = 1920

/** One completed slider gesture is one command; Escape/hiding restores committed audio. */
function ProductionSlider({ label, value, active, disabled, onCommit, onPreview, min, max, step, format, target, trackId }: {
  label: string; value: number; active: boolean; disabled?: boolean; min: number; max: number; step: number
  onCommit: (value: number) => void; onPreview?: (value: number) => void; format: (value: number) => string; target: string; trackId: string
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const gesture = useRef<{ value: number; original: number } | null>(null)
  const latest = useRef({ value, onPreview, onCommit, active, disabled })
  useEffect(() => { latest.current = { value, onPreview, onCommit, active, disabled } })
  const cancel = () => { if (!gesture.current) return; gesture.current = null; setDraft(null); latest.current.onPreview?.(latest.current.value) }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel() } }
    const blur = () => cancel()
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); if (gesture.current) latest.current.onPreview?.(latest.current.value) }
  }, [])
  useEffect(() => {
    if (!active || disabled || gesture.current && gesture.current.original !== value) cancel()
  }, [active, disabled, value])
  const commit = () => {
    const pending = gesture.current
    if (!pending) return
    if (!active || disabled || pending.original !== value) { cancel(); return }
    gesture.current = null; setDraft(null)
    if (pending.value !== value) onCommit(pending.value)
  }
  return <label className="production-slider"><span>{label}</span><input data-help-target={target} data-help-track-id={trackId} aria-label={label} type="range" min={min} max={max} step={step} value={draft ?? value} disabled={disabled || !active} onChange={event => {
    if (!active || disabled) return
    const next = Number(event.target.value); gesture.current = { value: next, original: gesture.current?.original ?? value }; setDraft(next); onPreview?.(next)
  }} onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={commit} onKeyUp={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) commit() }} /><output>{format(draft ?? value)}</output></label>
}

export function ExpressionLane({ track, bars, active, disabled, onCommit }: { track: Track; bars: number; active: boolean; disabled?: boolean; onCommit: (points: ExpressionPoint[]) => void }) {
  const [bar, setBar] = useState(0), [draft, setDraft] = useState<ExpressionPoint[] | null>(null)
  const [entryBar, setEntryBar] = useState(1), [entryBeat, setEntryBeat] = useState(1), [strength, setStrength] = useState(100)
  const [error, setError] = useState('')
  const gesture = useRef<{ pointer: number; points: ExpressionPoint[]; signature: string } | null>(null)
  const start = Math.min(bar, Math.max(0, bars - 1)) * BAR, end = Math.min(bars * BAR, start + 4 * BAR)
  const signature = JSON.stringify([track.id, track.expression, bars]), points = draft ?? track.expression
  const cancel = () => { gesture.current = null; setDraft(null) }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel() } }
    const abandon = () => cancel()
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', abandon)
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', abandon) }
  }, [])
  useEffect(() => {
    if (!active || disabled || gesture.current && gesture.current.signature !== signature) cancel()
  }, [active, disabled, signature])
  const coordinate = (event: PointerEvent<SVGSVGElement>): ExpressionPoint => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { tick: Math.max(start, Math.min(end, Math.round((start + (event.clientX - rect.left) / rect.width * (end - start)) / 120) * 120)), value: Math.max(0, Math.min(1, Math.round((1 - (event.clientY - rect.top) / rect.height) * 100) / 100)) }
  }
  const place = (event: PointerEvent<SVGSVGElement>) => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    current.points = putExpressionPoint(current.points, coordinate(event)); setDraft(current.points)
  }
  const commit = (next: ExpressionPoint[]) => {
    if (!active || disabled) return
    if (next.length > 2048) { setError('Expression is limited to 2,048 points per track. Remove points before adding more.'); return }
    setError(''); if (JSON.stringify(next) !== JSON.stringify(track.expression)) onCommit(next)
  }
  const shown = [{ tick: start, value: expressionAt(points, start) }, ...points.filter(point => point.tick > start && point.tick < end), { tick: end, value: expressionAt(points, end) }]
  return <details className="expression-lane" onToggle={event => { if (!event.currentTarget.open) cancel() }}><summary data-help-target="track-expression" data-help-track-id={track.id}>Expression · swells &amp; fades</summary><p>Song bars {start / BAR + 1}–{Math.ceil(end / BAR)} · draw a gain curve. This does not change notes. Empty = 100%.</p>
    <div className="expression-navigation"><button type="button" disabled={!active || disabled || start === 0} onClick={() => { cancel(); setBar(Math.max(0, bar - 4)) }}>Previous 4 bars</button><button type="button" disabled={!active || disabled || end >= bars * BAR} onClick={() => { cancel(); setBar(bar + 4) }}>Next 4 bars</button><button type="button" disabled={!active || disabled || !track.expression.length} onClick={() => { cancel(); commit([]) }}>Reset expression</button></div>
    <svg viewBox="0 0 400 100" preserveAspectRatio="none" role="img" aria-label={`${track.name} expression, song bars ${start / BAR + 1} to ${Math.ceil(end / BAR)}`} className="expression-canvas" onPointerDown={event => {
      if (disabled || !active || event.button !== 0) return
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
      gesture.current = { pointer: event.pointerId, points: [...track.expression], signature }; place(event)
    }} onPointerMove={place} onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerUp={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      cancel(); if (active && !disabled && current.signature === signature) commit(current.points)
    }}>
      {[0,25,50,75,100].map(y => <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} className="expression-grid" />)}
      {[0,100,200,300,400].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" className="expression-grid" />)}
      <polyline fill="none" points={shown.map(point => `${(point.tick - start) / (end - start) * 400},${100 - point.value * 100}`).join(' ')} />
      {points.filter(point => point.tick >= start && point.tick <= end).map(point => <circle key={point.tick} cx={(point.tick - start) / (end - start) * 400} cy={100 - point.value * 100} r="2" />)}
    </svg>
    <div className="expression-values"><label>Song bar<NumericDraft label={`${track.name} expression bar`} value={entryBar} min={1} max={bars} integer disabled={disabled || !active} onCommit={setEntryBar} /></label><label>Beat<NumericDraft label={`${track.name} expression beat`} value={entryBeat} min={1} max={4.999} disabled={disabled || !active} onCommit={setEntryBeat} /></label><label>Gain %<NumericDraft label={`${track.name} expression gain`} value={strength} min={0} max={100} integer disabled={disabled || !active} onCommit={setStrength} /></label><button type="button" disabled={disabled || !active} onClick={() => { try { commit(putExpressionPoint(track.expression, expressionEntryPoint(entryBar, entryBeat, strength, bars))) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose a valid expression position.') } }}>Set point</button></div>
    <div className="expression-point-list" aria-label={`${track.name} expression points`}>{points.filter(point => point.tick >= start && point.tick <= end).map(point => <button type="button" disabled={disabled || !active} key={point.tick} onClick={() => commit(track.expression.filter(item => item.tick !== point.tick))} aria-label={`Remove expression point at tick ${point.tick}`}>Bar {Math.floor(point.tick / BAR) + 1}, beat {Number((point.tick % BAR / 480 + 1).toFixed(2))}: {Math.round(point.value * 100)}% ×</button>)}</div>
    {error && <p role="alert">{error}</p>}
  </details>
}

export function ProductionControls({ track, bars, active, disabled, onCommit, onPreview }: { track: Track; bars: number; active: boolean; disabled?: boolean; onCommit: (patch: Partial<TrackProduction>) => void; onPreview?: (patch: Partial<TrackProduction>) => void }) {
  const [expanded, setExpanded] = useState(false)
  const interactive = active && expanded
  return <details className="production-controls" data-help-track-id={track.id} onToggle={event => { if (event.target === event.currentTarget) setExpanded(event.currentTarget.open) }}><summary>Pan, Space &amp; Expression</summary><ProductionSlider label={`${track.name} Pan`} target="track-pan" trackId={track.id} min={-1} max={1} step={.01} value={track.pan} active={interactive} disabled={disabled} onCommit={pan => onCommit({ pan })} onPreview={pan => onPreview?.({ pan })} format={value => value === 0 ? 'Centre' : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'L' : 'R'}`} /><ProductionSlider label={`${track.name} Space`} target="track-space" trackId={track.id} min={0} max={1} step={.01} value={track.space} active={interactive} disabled={disabled} onCommit={space => onCommit({ space })} onPreview={space => onPreview?.({ space })} format={value => `${Math.round(value * 100)}%`} /><button type="button" aria-label={`Bypass Space for ${track.name}`} aria-pressed={track.spaceBypass} disabled={disabled || !interactive} onClick={() => { if (interactive && !disabled) onCommit({ spaceBypass: !track.spaceBypass }) }}>Bypass Space</button><ExpressionLane track={track} bars={bars} active={interactive} disabled={disabled} onCommit={expression => onCommit({ expression })} /></details>
}
