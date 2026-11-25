/* eslint-disable react-refresh/only-export-components -- pure drum operations live beside the component so the editor contract has one source of truth. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { TICKS_PER_BAR, type Instrument, type Note } from './model'
import { normalizeEditResult, type EditResult } from './v4/editResult'

export const DRUM_STEP_TICKS = 120
export const DRUM_INSTRUMENTS = ['kick', 'snare', 'hat'] as const
export type DrumInstrument = typeof DRUM_INSTRUMENTS[number]

const DRUM_PITCH: Record<DrumInstrument, number> = { kick: 36, snare: 38, hat: 42 }
const DRUM_NAME: Record<DrumInstrument, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hi-hat' }

export interface DrumEditorProps {
  controlledTool?: 'draw' | 'erase'
  hideToolbar?: boolean
  compact?: boolean
  instruments?: readonly DrumInstrument[]
  notes: Note[]
  bars: number
  startBar: number
  visibleBars: number
  playhead: number
  playing: boolean
  previewEnabled: boolean
  disabled?: boolean
  editableStartTick?: number
  editableEndTick?: number
  showRuler?: boolean
  onChange: (notes: Note[], bars: number) => EditResult | boolean | void
  onPreview: (note: Note) => void
  onMessage: (message: string) => void
  onUndo: () => void
  onSelectBar?: (bar: number) => void
}

export interface DrumHitChange {
  notes: Note[]
  bars: number
  note: Note
}

export function addDrumHit(notes: Note[], bars: number, instrument: DrumInstrument, startTick: number, id: string): DrumHitChange {
  if (!Number.isSafeInteger(startTick) || startTick < 0) throw new RangeError('Drum hit tick must be a non-negative integer.')
  const note: Note = { id, instrument, pitch: DRUM_PITCH[instrument], startTick, durationTicks: 60, velocity: 90 }
  return { notes: [...notes, note], bars: Math.max(bars, Math.ceil((startTick + note.durationTicks) / TICKS_PER_BAR)), note }
}

export function removeDrumHit(notes: Note[], id: string): Note[] {
  return notes.filter(note => note.id !== id)
}

export function eraseDrumHits(notes: Note[], ids: ReadonlySet<string>): Note[] {
  return ids.size === 0 ? notes : notes.filter(note => !ids.has(note.id))
}

export function visibleDrumHits(notes: Note[], startBar: number, visibleBars: number): Note[] {
  const startTick = startBar * TICKS_PER_BAR
  const endTick = (startBar + visibleBars) * TICKS_PER_BAR
  return notes.filter(note => isDrum(note.instrument) && note.startTick >= startTick && note.startTick < endTick)
}

interface EraseGesture {
  pointerId: number
  notes: Note[]
  bars: number
  signature: string
  ids: Set<string>
}

export function DrumEditor({ notes, bars, startBar, visibleBars, playhead, playing, previewEnabled, disabled = false, editableStartTick = 0, editableEndTick = Number.POSITIVE_INFINITY, showRuler = false, onChange, onPreview, onMessage, onUndo, onSelectBar, instruments = DRUM_INSTRUMENTS, controlledTool, hideToolbar = false, compact = false }: DrumEditorProps) {
  const [localTool, setTool] = useState<'draw' | 'erase'>('draw')
  const tool = controlledTool ?? localTool
  const [erasedIds, setErasedIds] = useState<ReadonlySet<string>>(() => new Set())
  const editor = useRef<HTMLDivElement>(null)
  const gesture = useRef<EraseGesture | null>(null)
  const suppressClick = useRef(false)
  const viewStartTick = Math.max(0, startBar) * TICKS_PER_BAR
  const safeVisibleBars = Math.max(1, visibleBars)
  const viewTicks = safeVisibleBars * TICKS_PER_BAR
  const viewEndTick = viewStartTick + viewTicks
  const projectSignature = drumEditorStateSignature(notes, bars, startBar, safeVisibleBars)
  const hits = useMemo(() => visibleDrumHits(notes, Math.max(0, startBar), safeVisibleBars), [notes, startBar, safeVisibleBars])
  const shownHits = erasedIds.size ? hits.filter(note => !erasedIds.has(note.id)) : hits

  useEffect(() => {
    const active = gesture.current
    if (active && active.signature !== projectSignature) {
      gesture.current = null
      setErasedIds(new Set())
      onMessage('Erase cancelled because the project changed.')
    }
  }, [projectSignature, onMessage])

  useEffect(() => {
    if (!disabled || !gesture.current) return
    gesture.current = null
    setErasedIds(new Set())
  }, [disabled])

  const selectBarAtTick = (tick: number) => onSelectBar?.(Math.floor(tick / TICKS_PER_BAR))
  const submit = (nextNotes: Note[], nextBars: number, success: string, preview?: Note) => {
    let result: EditResult
    try { result = normalizeEditResult(onChange(nextNotes, nextBars)) }
    catch (error) { result = { status: 'rejected', message: error instanceof Error ? error.message : 'That drum edit could not be applied.' } }
    if (result.status !== 'accepted') { if (result.message) onMessage(result.message); return false }
    if (preview && previewEnabled) onPreview(preview)
    onMessage(success)
    return true
  }
  const add = (instrument: DrumInstrument, startTick: number) => {
    if (disabled || tool !== 'draw' || startTick < editableStartTick || startTick >= editableEndTick) return
    const change = addDrumHit(notes, bars, instrument, startTick, makeId())
    if (submit(change.notes, change.bars, `${DRUM_NAME[instrument]} hit added at ${tickDescription(startTick)}.`, change.note)) selectBarAtTick(startTick)
  }
  const remove = (note: Note) => {
    if (disabled) return
    if (submit(removeDrumHit(notes, note.id), bars, `${DRUM_NAME[note.instrument as DrumInstrument]} hit removed from ${tickDescription(note.startTick)}.`)) selectBarAtTick(note.startTick)
  }
  const markForErase = (id: string) => {
    const active = gesture.current
    if (!active || active.ids.has(id)) return
    active.ids.add(id)
    setErasedIds(new Set(active.ids))
  }
  const beginErase = (event: PointerEvent<HTMLButtonElement>, note: Note) => {
    if (disabled || tool !== 'erase' || event.button !== 0) return
    event.preventDefault()
    suppressClick.current = true
    gesture.current = { pointerId: event.pointerId, notes, bars, signature: projectSignature, ids: new Set([note.id]) }
    setErasedIds(new Set([note.id]))
    editor.current?.setPointerCapture(event.pointerId)
    selectBarAtTick(note.startTick)
  }
  const sweepErase = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drum-note-id]')
    if (target?.dataset.drumNoteId) markForErase(target.dataset.drumNoteId)
  }
  const finishErase = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    if (disabled || active.signature !== projectSignature) {
      cancelErase(false)
      onMessage('Erase cancelled because the project or shown bars changed.')
      return
    }
    gesture.current = null
    setErasedIds(new Set())
    if (editor.current?.hasPointerCapture(event.pointerId)) editor.current.releasePointerCapture(event.pointerId)
    if (!active.ids.size) return
    submit(eraseDrumHits(active.notes, active.ids), active.bars, `${active.ids.size} drum ${active.ids.size === 1 ? 'hit' : 'hits'} erased. Undo is available.`)
  }
  const cancelErase = (message = true) => {
    const active = gesture.current
    if (!active) return false
    gesture.current = null
    setErasedIds(new Set())
    if (editor.current?.hasPointerCapture(active.pointerId)) editor.current.releasePointerCapture(active.pointerId)
    if (message) onMessage('Erase cancelled; no hits were changed.')
    return true
  }
  useEffect(() => {
    const cancelFromWindow = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current || !cancelErase()) return
      event.preventDefault()
      event.stopPropagation()
    }
    // Pointer erasing deliberately prevents the browser's focus change. Listen
    // at the window boundary so Escape still rolls back when focus began on a
    // toolbar or another panel outside this editor.
    window.addEventListener('keydown', cancelFromWindow, true)
    return () => window.removeEventListener('keydown', cancelFromWindow, true)
  })
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !cancelErase()) return
    event.preventDefault()
    event.stopPropagation()
  }
  const chooseTool = (next: 'draw' | 'erase') => {
    cancelErase(false)
    setTool(next)
    onMessage(next === 'draw' ? 'Draw tool selected.' : 'Erase tool selected. Drag across individual hits to erase them together.')
  }

  const steps = safeVisibleBars * 16
  const stackIndex = new Map<string, { index: number; count: number }>()
  for (const instrument of instruments) {
    const groups = new Map<number, Note[]>()
    for (const note of shownHits) if (note.instrument === instrument) groups.set(note.startTick, [...(groups.get(note.startTick) ?? []), note])
    for (const group of groups.values()) group.forEach((note, index) => stackIndex.set(note.id, { index, count: group.length }))
  }

  return <div
    ref={editor}
    className={`drum-editor drum-editor--timeline tool-${tool}${compact ? ' drum-editor--compact' : ''}`}
    data-help-target="drums"
    onKeyDown={keyDown}
    onPointerMove={sweepErase}
    onPointerUp={finishErase}
    onPointerCancel={() => cancelErase()}
    onLostPointerCapture={() => cancelErase(false)}
  >
    {!hideToolbar && <div className="drum-toolbar" data-help-target="drum-tools" aria-label="Drum editing tools">
      <strong>Drum grid</strong>
      <button type="button" aria-pressed={tool === 'draw'} disabled={disabled} onClick={() => chooseTool('draw')}>Draw</button>
      <button type="button" aria-pressed={tool === 'erase'} disabled={disabled} onClick={() => chooseTool('erase')}>Erase</button>
      <button type="button" disabled={disabled} onClick={onUndo}>Undo</button>
      <span className="drum-microhint">Draw: click a ¼-beat step to add; click a hit to remove. Erase: drag across hits. Recorded timing stays exact.</span>
    </div>}
    <div className="drum-scroll" data-help-target="drum-timeline" aria-label={`Drum timeline, bars ${startBar + 1} to ${startBar + safeVisibleBars}. Scroll horizontally when needed.`}>
      <div className="drum-surface" style={{ '--visible-bars': safeVisibleBars, '--steps': steps, '--surface-min-width': `${Math.max(720, safeVisibleBars * 360)}px`, '--bar-width': `${100 / safeVisibleBars}%`, '--beat-width': `${100 / (safeVisibleBars * 4)}%`, '--step-width': `${100 / steps}%` } as CSSProperties}>
        {(!compact || showRuler) && <div className="step-numbers drum-time-ruler" aria-hidden="true">
          <span className="drum-row-label">Time</span>
          <div className="drum-ruler-bars">
            {Array.from({ length: safeVisibleBars }, (_, barOffset) => <div className="drum-ruler-bar" key={barOffset}>
              <em>Bar {startBar + barOffset + 1}</em>
              {[1, 2, 3, 4].map(beat => <b key={beat}>Beat {beat}</b>)}
            </div>)}
          </div>
        </div>}
        {instruments.map(instrument => {
          const rowHits = shownHits.filter(note => note.instrument === instrument)
          const maxStack = Math.max(1, ...rowHits.map(note => stackIndex.get(note.id)?.count ?? 1))
          return <div className="drum-row" key={instrument} style={{ '--row-height': `${Math.max(46, maxStack * 18 + 10)}px` } as CSSProperties}>
            <strong className="drum-row-label">{DRUM_NAME[instrument]}</strong>
            <div className="drum-lane">
              {Array.from({ length: steps }, (_, step) => {
                const startTick = viewStartTick + step * DRUM_STEP_TICKS
                const matching = rowHits.filter(note => note.startTick === startTick)
                const bar = Math.floor(startTick / TICKS_PER_BAR)
                const stepInBar = Math.floor((startTick % TICKS_PER_BAR) / DRUM_STEP_TICKS)
                const label = stepLabel(instrument, bar, stepInBar)
                const outsidePart = startTick < editableStartTick || startTick >= editableEndTick
                return <button
                  type="button"
                  className={`drum-step${outsidePart ? ' drum-step--outside-part' : ''}`}
                  key={step}
                  style={{ left: `${step / steps * 100}%`, width: `${100 / steps}%` }}
                  aria-label={`${label}${outsidePart ? '; outside this part, create or select a part covering this bar' : ''}`}
                  title={outsidePart ? 'Outside this part. Select or create a part covering this song position.' : undefined}
                  aria-hidden={matching.length ? true : undefined}
                  tabIndex={matching.length ? -1 : 0}
                  disabled={disabled || outsidePart || matching.length > 0}
                  onClick={() => add(instrument, startTick)}
                />
              })}
              {rowHits.map(note => {
                const position = (note.startTick - viewStartTick) / viewTicks
                const onGrid = note.startTick % DRUM_STEP_TICKS === 0
                const stack = stackIndex.get(note.id) ?? { index: 0, count: 1 }
                const bar = Math.floor(note.startTick / TICKS_PER_BAR)
                const stepInBar = Math.floor((note.startTick % TICKS_PER_BAR) / DRUM_STEP_TICKS)
                const label = onGrid && stack.index === 0
                  ? stepLabel(instrument, bar, stepInBar)
                  : `${DRUM_NAME[instrument]}${stack.count > 1 ? ` overlapping hit ${stack.index + 1}` : ' off-grid hit'} at ${tickDescription(note.startTick)}, velocity ${note.velocity}`
                return <button
                  type="button"
                  key={note.id}
                  data-drum-note-id={note.id}
                  className={`drum-hit ${onGrid ? 'drum-hit--on-grid' : 'drum-hit--off-grid'}`}
                  style={{ left: `${position * 100}%`, top: `${5 + stack.index * 18}px`, ...(onGrid ? { width: `${100 / steps}%` } : {}) }}
                  aria-label={label}
                  disabled={disabled}
                  onPointerDown={event => beginErase(event, note)}
                  onPointerEnter={() => markForErase(note.id)}
                  onClick={event => {
                    if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return }
                    if (tool === 'erase') {
                      if (submit(removeDrumHit(notes, note.id), bars, `${DRUM_NAME[instrument]} hit erased. Undo is available.`)) selectBarAtTick(note.startTick)
                    } else remove(note)
                  }}
                />
              })}
            </div>
          </div>
        })}
        {playing && playhead >= viewStartTick && playhead < viewEndTick && <span className="drum-playhead" aria-hidden="true" style={{ left: `calc(var(--drum-label-width) + (100% - var(--drum-label-width)) * ${(playhead - viewStartTick) / viewTicks})` }} />}
      </div>
    </div>
  </div>
}

function isDrum(instrument: Instrument): instrument is DrumInstrument {
  return instrument !== 'piano'
}

function stepLabel(instrument: DrumInstrument, bar: number, stepInBar: number): string {
  return bar === 0 ? `${DRUM_NAME[instrument]} step ${stepInBar + 1}` : `${DRUM_NAME[instrument]} bar ${bar + 1} step ${stepInBar + 1}`
}

function tickDescription(tick: number): string {
  const bar = Math.floor(tick / TICKS_PER_BAR)
  const tickInBar = tick % TICKS_PER_BAR
  const beat = Math.floor(tickInBar / 480) + 1
  const tickInBeat = tickInBar % 480
  return `bar ${bar + 1}, beat ${beat}${tickInBeat ? ` + ${tickInBeat} ticks` : ''}`
}

export function drumEditorStateSignature(notes: Note[], bars: number, startBar: number, visibleBars: number): string {
  return `${bars}:${startBar}:${visibleBars}|${notes.map(note => `${note.id}:${note.instrument}:${note.pitch}:${note.startTick}:${note.durationTicks}:${note.velocity}`).join('|')}`
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `drum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
