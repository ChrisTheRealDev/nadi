import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { MAX_BARS, TICKS_PER_BAR, TICKS_PER_BEAT, noteName, type Note } from './model'
import { addPianoNote, deletePianoNotes, movePianoNotes, pastePianoNotes, patchPianoSelection, proposeNoteEdit, resizePianoNote, type PianoRollEditProposal, type PianoRollEditResult } from './pianoRollEdits'
import { NumericDraft } from './NumericDraft'
import { copiedNotes, copyNotes } from './noteClipboard'
import { chordNoteIds } from './pianoRollSelection'
import { pianoGuidanceEdit, type PianoGuidanceAction } from './pianoRollGuidance'
import { consumePianoRollRestore, initialPianoRollScrollTop, pianoRollPreferences, readPianoRollView, savePianoRollView, setPianoRollPreferences, type PianoRollCommand, type PianoRollTool } from './pianoRollViewState'
import { MIDI_PITCH_COUNT, PIANO_ROLL_ROW_HEIGHT, rowTop as defaultRowTop, snapDelta, snapTick, tickFromPointer, type PianoRollSnap } from './pianoRollMath'
import './composingEditor.css'

type Tool = PianoRollTool
export interface PianoRollUiState { tool: PianoRollTool; selectedCount: number; selectedIds?: string[] }
type Box = { left: number; top: number; width: number; height: number }
interface Geometry { tick: number; pitch: number; x: number; y: number }
interface GestureBase { pointerId: number; sourceNotes: Note[]; sourceBars: number; origin: Geometry; latest?: PianoRollEditProposal }
type Gesture =
  | (GestureBase & { kind: 'draw'; note: Note; dragged: boolean })
  | (GestureBase & { kind: 'move'; ids: Set<string>; noteId: string; dragged: boolean; previewPitch: number })
  | (GestureBase & { kind: 'resize'; noteId: string; dragged: boolean })
  | (GestureBase & { kind: 'erase'; ids: Set<string> })
  | (GestureBase & { kind: 'box'; initialIds: Set<string>; toggle: boolean })

export interface PianoRollProps {
  notes: Note[]; bars: number; selectedBar: number; selectedId: string | null
  onChange: (notes: Note[], bars: number, command?: PianoRollCommand) => boolean | void; onSelection: (id: string | null) => void
  startBar?: number; visibleBars?: number; playhead?: number; playing?: boolean
  previewEnabled?: boolean; onPreview?: (note: Note) => void; onMessage?: (text: string) => void
  onUiState?: (state: PianoRollUiState) => void; onRejected?: (message: string) => void
  onUndo?: () => void; onSelectBar?: (bar: number) => void; disabled?: boolean
  onCursorChange?: (tick: number) => void
  compact?: boolean; stateKey?: string; active?: boolean
  /** Keep the whole timeline scrollable, using visibleBars as the horizontal zoom. */
  scrollTimeline?: boolean
  restoreSelection?: { sequence: number; ids: string[] }
  helpDestination?: { trackId?: string; clipId?: string }
  onGuidanceAction?: (action: PianoGuidanceAction) => void
}

const LABEL_WIDTH = 52
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `piano-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const overlaps = (note: Note, start: number, end: number) => note.instrument === 'piano' && note.startTick < end && note.startTick + note.durationTicks > start
const isResult = (p: PianoRollEditProposal): p is PianoRollEditResult => !('error' in p)
const notesEqual = (a: Note[], b: Note[]) => a.length === b.length && a.every((n, i) => { const o = b[i]; return o === n || (o?.id === n.id && o.pitch === n.pitch && o.startTick === n.startTick && o.durationTicks === n.durationTicks && o.velocity === n.velocity && o.instrument === n.instrument) })

export function PianoRoll(props: PianoRollProps) {
  return <PianoRollEditor key={props.stateKey ?? 'legacy'} {...props} />
}

function PianoRollEditor(props: PianoRollProps) {
  const { notes, bars, selectedBar, selectedId, onChange, onSelection, previewEnabled = false, onPreview, onMessage, onSelectBar, disabled = false } = props
  const barsPerView = Math.max(1, Math.min(bars, Math.floor(props.visibleBars ?? 1)))
  const startBar = props.scrollTimeline ? 0 : props.startBar ?? selectedBar, visibleBars = props.scrollTimeline ? bars : barsPerView
  const windowStart = startBar * TICKS_PER_BAR, windowTicks = visibleBars * TICKS_PER_BAR, windowEnd = windowStart + windowTicks
  const viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null), gestureRef = useRef<Gesture | null>(null)
  const rulerViewport = useRef<HTMLDivElement>(null)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [rulerWidth, setRulerWidth] = useState(0)
  const panReportedBar = useRef<number | null>(null)
  const pixelsPerBar = Math.max(1, (timelineWidth - LABEL_WIDTH) / bars)
  useLayoutEffect(() => {
    const view = viewport.current
    if (!props.scrollTimeline || !view) return
    const resize = () => { setRulerWidth(view.clientWidth); setTimelineWidth(LABEL_WIDTH + Math.max(192, view.clientWidth - LABEL_WIDTH) * bars / barsPerView) }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(view)
    return () => observer.disconnect()
  }, [props.scrollTimeline, bars, barsPerView])
  useLayoutEffect(() => {
    if (!props.scrollTimeline || !timelineWidth || !viewport.current) return
    const target = props.startBar ?? selectedBar
    if (panReportedBar.current !== target) viewport.current.scrollLeft = target * pixelsPerBar
    if (rulerViewport.current) rulerViewport.current.scrollLeft = viewport.current.scrollLeft
  }, [props.scrollTimeline, props.startBar, selectedBar, timelineWidth, pixelsPerBar])
  useEffect(() => {
    const view = viewport.current, ruler = rulerViewport.current
    if (!props.scrollTimeline || !view) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      const delta = event.shiftKey ? event.deltaX || event.deltaY : event.deltaX
      if (!delta) return
      event.preventDefault()
      view.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.clientWidth : 1)
    }
    view.addEventListener('wheel', wheel, { passive: false })
    ruler?.addEventListener('wheel', wheel, { passive: false })
    return () => { view.removeEventListener('wheel', wheel); ruler?.removeEventListener('wheel', wheel) }
  }, [props.scrollTimeline])
  const pointerPosition = useRef<{ x: number; y: number; id: number } | null>(null)
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null)
  const pointerMoved = useRef(false), pagingEdge = useRef<{ direction: number; since: number } | null>(null)
  const compact = props.compact ?? false, active = props.active ?? true
  const [initialView] = useState(() => readPianoRollView(props.stateKey))
  const [tool, setToolValue] = useState<Tool>(() => props.stateKey ? pianoRollPreferences().tool : 'draw'), [snap, setSnapValue] = useState<PianoRollSnap>(() => props.stateKey ? pianoRollPreferences().snap : 120)
  const setTool = (value: Tool) => { setToolValue(value); if (props.stateKey) setPianoRollPreferences({ tool: value }) }
  const setSnap = (value: PianoRollSnap) => { setSnapValue(value); if (props.stateKey) setPianoRollPreferences({ snap: value }) }
  const [rowHeight, setRowHeight] = useState(initialView?.rowHeight ?? PIANO_ROLL_ROW_HEIGHT)
  const rowTop = (pitch: number) => (127 - pitch) * rowHeight
  const [cursor, setCursor] = useState(initialView?.cursor ?? { pitch: 60, tick: windowStart })
  const [selection, setSelection] = useState(() => ({ primary: selectedId ?? initialView?.primary ?? null, ids: new Set(selectedId && initialView && !initialView.selectedIds.includes(selectedId) ? [selectedId] : initialView?.selectedIds ?? (selectedId ? [selectedId] : [])) }))
  const lastExternalSelection = useRef(selectedId)
  if (lastExternalSelection.current !== selectedId) {
    lastExternalSelection.current = selectedId
    setSelection(current => ({ primary: selectedId, ids: selectedId && current.ids.has(selectedId) ? current.ids : new Set(selectedId ? [selectedId] : []) }))
  }
  const noteIdSet = new Set(notes.map(note => note.id))
  const selectedIds = new Set([...selection.ids].filter(id => noteIdSet.has(id))), cursorTick = Math.min(windowEnd - 1, Math.max(windowStart, cursor.tick))
  const uiStateCallback = useRef(props.onUiState)
  useEffect(() => { uiStateCallback.current = props.onUiState }, [props.onUiState])
  const selectedIdsKey = JSON.stringify([...selectedIds])
  useEffect(() => { if (active) { const ids: string[] = JSON.parse(selectedIdsKey); uiStateCallback.current?.({ tool, selectedCount: ids.length, selectedIds: ids }) } }, [active, tool, selectedIdsKey])
  const [draftNotes, setDraftNotes] = useState<Note[] | null>(null), [selectionBox, setSelectionBox] = useState<Box | null>(null)
  const [hintVisible, setHintVisibleValue] = useState(() => props.stateKey ? pianoRollPreferences().hintVisible : true), placementHelpId = useId()
  const setHintVisible = (value: boolean) => { setHintVisibleValue(value); if (props.stateKey) setPianoRollPreferences({ hintVisible: value }) }
  const visibleNotes = (draftNotes ?? notes).filter(note => overlaps(note, windowStart, windowEnd))
  const selected = notes.find(note => note.id === selection.primary && note.instrument === 'piano' && (compact || overlaps(note, windowStart, windowEnd)))

  const viewportInitialized = useRef(false)
  const viewSnapshot = useRef({ cursor, primary: selection.primary, selectedIds: [...selectedIds], rowHeight, scrollTop: initialView?.scrollTop ?? defaultRowTop(64), scrollLeft: initialView?.scrollLeft ?? 0 })
  viewSnapshot.current = { ...viewSnapshot.current, cursor, primary: selection.primary, selectedIds: [...selectedIds], rowHeight }
  useLayoutEffect(() => {
    const view = viewport.current
    if (!active || !view) return
    let applied = false
    const restore = () => {
      if (applied) return
      const top = initialPianoRollScrollTop(viewportInitialized.current ? viewSnapshot.current.scrollTop : initialView?.scrollTop, notes.filter(note => overlaps(note, windowStart, windowEnd)).map(note => note.pitch), viewSnapshot.current.rowHeight, view.clientHeight)
      if (top === undefined) return
      view.scrollTop = top; view.scrollLeft = viewSnapshot.current.scrollLeft
      viewSnapshot.current.scrollTop = view.scrollTop
      viewportInitialized.current = true; applied = true
    }
    restore()
    // Panels mount while hidden and can acquire layout after the active flag.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(restore)
    observer?.observe(view)
    return () => observer?.disconnect()
    // Only first visibility/reopening restores scrolling; edits and zoom must not recenter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialView])
  useEffect(() => () => {
    if (props.stateKey && viewportInitialized.current) savePianoRollView(props.stateKey, viewSnapshot.current)
    gestureRef.current = null; pointerPosition.current = null
  }, [props.stateKey])
  useEffect(() => {
    if (!props.restoreSelection || !consumePianoRollRestore(props.stateKey, props.restoreSelection.sequence)) return
    const ids = new Set(props.restoreSelection.ids.filter(id => notes.some(note => note.id === id)))
    choose(ids, ids.values().next().value ?? null)
    // An explicit history sequence is authoritative; ordinary rerenders must not collapse selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.restoreSelection?.sequence])

  function cancelGesture() { const g = gestureRef.current; gestureRef.current = null; pointerPosition.current = null; if (g?.kind === 'box') choose(g.initialIds, g.initialIds.values().next().value ?? null); if (g && surface.current?.hasPointerCapture?.(g.pointerId)) surface.current.releasePointerCapture(g.pointerId); setDraftNotes(null); setSelectionBox(null) }
  function commit(p: PianoRollEditProposal, source = notes, label?: string) {
    if (!active) return false
    if (!isResult(p)) { onMessage?.(p.error); props.onRejected?.(p.error); return false }; if (notesEqual(p.notes, source)) return false
    const before = new Map(source.map(note => [note.id, note])), after = new Map(p.notes.map(note => [note.id, note]))
    const affectedIds = [...new Set([...before.keys(), ...after.keys()])].filter(id => { const a = before.get(id), b = after.get(id); return !a || !b || !notesEqual([a], [b]) })
    const verb = p.notes.length > source.length ? 'Add' : p.notes.length < source.length ? 'Delete' : 'Edit'
    const accepted = onChange(p.notes, p.bars, { label: label ?? `${verb} ${affectedIds.length} ${affectedIds.length === 1 ? 'note' : 'notes'}`, affectedIds }) !== false
    const action = accepted ? pianoGuidanceEdit(source, p.notes) : null
    if (action) props.onGuidanceAction?.(action)
    return accepted
  }
  function choose(ids: Set<string>, primary: string | null) { const actualPrimary = primary && ids.has(primary) ? primary : ids.values().next().value ?? null; setSelection({ primary: actualPrimary, ids }); onSelection(actualPrimary) }
  function selectBarAt(tick: number) { if (tick >= windowStart && tick < windowEnd) onSelectBar?.(Math.floor(tick / TICKS_PER_BAR)) }
  function geometry(clientX: number, clientY: number): Geometry | null {
    if (!surface.current) return null
    const box = surface.current.getBoundingClientRect(), gridLeft = box.left + LABEL_WIDTH, gridWidth = Math.max(1, box.width - LABEL_WIDTH)
    return { tick: tickFromPointer(clientX, gridLeft, gridWidth, windowStart, windowTicks), pitch: Math.max(0, Math.min(127, 127 - Math.floor((clientY - box.top) / rowHeight))), x: Math.min(gridWidth, Math.max(0, clientX - gridLeft)), y: Math.min(box.height, Math.max(0, clientY - box.top)) }
  }
  function capture(e: ReactPointerEvent<HTMLElement>) { pointerPosition.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; pointerOrigin.current = { x: e.clientX, y: e.clientY }; pointerMoved.current = false; pagingEdge.current = null; try { surface.current?.setPointerCapture(e.pointerId) } catch { /* optional in tests */ } }
  function preview(note: Note) { if (previewEnabled) onPreview?.(note) }
  function revealPitch(pitch: number) {
    if (!viewport.current) return
    const top = rowTop(pitch), bottom = top + rowHeight
    if (top < viewport.current.scrollTop || bottom > viewport.current.scrollTop + viewport.current.clientHeight) viewport.current.scrollTop = Math.max(0, top - viewport.current.clientHeight / 2)
  }
  function notesAt(source: Note[], point: Geometry) { return source.filter(n => n.instrument === 'piano' && n.pitch === point.pitch && n.startTick <= point.tick && n.startTick + n.durationTicks > point.tick) }

  function beginGrid(e: ReactPointerEvent<HTMLButtonElement>, pitch: number) {
    if (disabled || !active || e.button !== 0) return
    const p = geometry(e.clientX, e.clientY); if (!p) return; p.pitch = pitch; e.preventDefault(); capture(e); selectBarAt(p.tick); setCursor({ pitch, tick: snapTick(p.tick, snap, 'floor') }); props.onCursorChange?.(snapTick(p.tick, snap, 'floor'))
    if (tool === 'draw') {
      const note: Note = { id: makeId(), instrument: 'piano', pitch, startTick: snapTick(p.tick, snap, 'floor'), durationTicks: TICKS_PER_BEAT, velocity: 90 }
      const latest = addPianoNote(notes, note, bars); gestureRef.current = { kind: 'draw', pointerId: e.pointerId, sourceNotes: notes, sourceBars: bars, origin: p, note, dragged: false, latest }
      if (isResult(latest)) setDraftNotes(latest.notes); preview(note)
    } else if (tool === 'erase') {
      const ids = new Set(notesAt(notes, p).map(n => n.id)), latest = deletePianoNotes(notes, ids, bars)
      gestureRef.current = { kind: 'erase', pointerId: e.pointerId, sourceNotes: notes, sourceBars: bars, origin: p, ids, latest }; setDraftNotes(latest.notes)
    } else {
      gestureRef.current = { kind: 'box', pointerId: e.pointerId, sourceNotes: notes, sourceBars: bars, origin: p, initialIds: new Set(selectedIds), toggle: e.shiftKey }
      setSelectionBox({ left: p.x, top: p.y, width: 0, height: 0 }); if (!e.shiftKey) choose(new Set(), null)
    }
  }

  function beginNote(e: ReactPointerEvent<HTMLButtonElement>, note: Note) {
    if (disabled || !active || e.button !== 0) return
    const p = geometry(e.clientX, e.clientY); if (!p) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true }); capture(e); selectBarAt(p.tick); preview(note)
    if (tool === 'erase') { const ids = new Set([note.id]), latest = deletePianoNotes(notes, ids, bars); gestureRef.current = { kind: 'erase', pointerId: e.pointerId, sourceNotes: notes, sourceBars: bars, origin: p, ids, latest }; setDraftNotes(latest.notes); return }
    if (e.shiftKey) { const next = new Set(selectedIds); if (next.has(note.id)) next.delete(note.id); else next.add(note.id); choose(next, next.has(note.id) ? note.id : selectedId); return }
    const ids = selectedIds.has(note.id) ? new Set(selectedIds) : new Set([note.id]); choose(ids, note.id)
    const resize = note.startTick + note.durationTicks <= windowEnd && (e.target as HTMLElement).closest('[data-resize-note]') !== null
    gestureRef.current = resize
      ? { kind: 'resize', pointerId: e.pointerId, sourceNotes: notes, sourceBars: bars, origin: p, noteId: note.id, dragged: false }
      : { kind: 'move', pointerId: e.pointerId, sourceNotes: notes, sourceBars: bars, origin: p, ids, noteId: note.id, dragged: false, previewPitch: note.pitch }
  }

  function updateGesture(e: ReactPointerEvent<HTMLElement>) {
    if (!gestureRef.current || gestureRef.current.pointerId !== e.pointerId) return
    const origin = pointerOrigin.current
    if (origin && Math.abs(e.clientX - origin.x) + Math.abs(e.clientY - origin.y) >= 3) pointerMoved.current = true
    e.preventDefault(); pointerPosition.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; advanceGesture(e.clientX, e.clientY, e.pointerId)
  }
  function advanceGesture(clientX: number, clientY: number, pointerId: number) {
    const g = gestureRef.current; if (!g || g.pointerId !== pointerId) return
    if ((g.kind === 'move' || g.kind === 'resize') && !pointerMoved.current) return
    if (viewport.current && pointerMoved.current) {
      const box = viewport.current.getBoundingClientRect()
      if (clientY < box.top + 28) viewport.current.scrollTop -= 16
      else if (clientY > box.bottom - 28) viewport.current.scrollTop += 16
    }
    const p = geometry(clientX, clientY); if (!p) return
    const distance = Math.abs(p.x - g.origin.x) + Math.abs(p.y - g.origin.y)
    if (g.kind === 'draw') {
      g.dragged ||= distance >= 3; let startTick = g.note.startTick, durationTicks = TICKS_PER_BEAT
      if (g.dragged) { const edge = snapTick(p.tick, snap), unit = snap ?? 1; startTick = Math.min(g.note.startTick, edge); durationTicks = Math.max(unit, Math.abs(edge - g.note.startTick)) }
      g.latest = addPianoNote(g.sourceNotes, { ...g.note, startTick, durationTicks }, g.sourceBars); if (isResult(g.latest)) setDraftNotes(g.latest.notes)
    } else if (g.kind === 'move') {
      g.dragged ||= distance >= 3
      g.latest = movePianoNotes(g.sourceNotes, g.ids, Math.round((g.origin.y - p.y) / rowHeight), snapDelta(p.tick - g.origin.tick, snap), g.sourceBars); if (isResult(g.latest)) { setDraftNotes(g.latest.notes); const moved = g.latest.notes.find(note => note.id === g.noteId); if (moved && moved.pitch !== g.previewPitch) { g.previewPitch = moved.pitch; preview(moved) } }
    } else if (g.kind === 'resize') {
      g.dragged ||= distance >= 3
      g.latest = resizePianoNote(g.sourceNotes, g.noteId, snapDelta(p.tick - g.origin.tick, snap), g.sourceBars); if (isResult(g.latest)) setDraftNotes(g.latest.notes)
    } else if (g.kind === 'erase') {
      for (const note of notesAt(g.sourceNotes, p)) g.ids.add(note.id); g.latest = deletePianoNotes(g.sourceNotes, g.ids, g.sourceBars); setDraftNotes(g.latest.notes)
    } else {
      const left = Math.min(g.origin.x, p.x), top = Math.min(g.origin.y, p.y), box = { left, top, width: Math.abs(p.x - g.origin.x), height: Math.abs(p.y - g.origin.y) }; setSelectionBox(box)
      const gridWidth = Math.max(1, (surface.current?.getBoundingClientRect().width ?? LABEL_WIDTH + 1) - LABEL_WIDTH), tickA = windowStart + left / gridWidth * windowTicks, tickB = windowStart + (left + box.width) / gridWidth * windowTicks
      const high = 127 - Math.floor(top / rowHeight), low = 127 - Math.floor((top + Math.max(1, box.height)) / rowHeight)
      const enclosed = new Set(notes.filter(n => overlaps(n, tickA, tickB) && n.pitch >= low && n.pitch <= high).map(n => n.id)), next = g.toggle ? new Set(g.initialIds) : new Set<string>()
      for (const id of enclosed) { if (g.toggle && next.has(id)) next.delete(id); else next.add(id) }; choose(next, next.values().next().value ?? null)
    }
  }

  function endGesture(e: ReactPointerEvent<HTMLElement>) {
    const g = gestureRef.current; if (!g || g.pointerId !== e.pointerId) return; updateGesture(e); gestureRef.current = null; pointerPosition.current = null; setDraftNotes(null); setSelectionBox(null)
    if (g.kind !== 'box' && g.latest) {
      const count = g.kind === 'move' || g.kind === 'erase' ? g.ids.size : 1
      const verb = g.kind === 'move' ? 'Move' : g.kind === 'resize' ? 'Resize' : g.kind === 'erase' ? 'Delete' : 'Draw'
      const changed = commit(g.latest, g.sourceNotes, `${verb} ${count} ${count === 1 ? 'note' : 'notes'}`)
      if (changed && g.kind === 'erase') { const left = new Set([...selectedIds].filter(id => !g.ids.has(id))); choose(left, left.has(selectedId ?? '') ? selectedId : null); deletedMessage(g.ids.size) }
      if (changed && g.kind === 'draw' && isResult(g.latest)) { choose(new Set([g.note.id]), g.note.id); const committed = g.latest.notes.find(note => note.id === g.note.id); if (committed) preview(committed) }
      if (changed && g.kind === 'move' && isResult(g.latest)) { const before = g.sourceNotes.find(note => note.id === g.noteId), committed = g.latest.notes.find(note => note.id === g.noteId); if (before && committed && before.pitch !== committed.pitch) preview(committed) }
    }
    try { surface.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  function deletedMessage(count: number) { onMessage?.(`Deleted ${count} ${count === 1 ? 'note' : 'notes'}. Undo is available.`) }
  function contextErase(e: MouseEvent<HTMLButtonElement>, note: Note) { e.preventDefault(); e.stopPropagation(); if (disabled) return; if (commit(deletePianoNotes(notes, new Set([note.id]), bars))) { const left = new Set([...selectedIds].filter(id => id !== note.id)); choose(left, left.has(selectedId ?? '') ? selectedId : null); deletedMessage(1) } }
  function placeKeyboard(pitch: number) { if (disabled || tool !== 'draw') return; const note: Note = { id: makeId(), instrument: 'piano', pitch, startTick: cursorTick, durationTicks: TICKS_PER_BEAT, velocity: 90 }; if (commit(addPianoNote(notes, note, bars))) { choose(new Set([note.id]), note.id); selectBarAt(note.startTick); preview(note) } }
  function placementKeyDown(e: KeyboardEvent<HTMLButtonElement>, pitch: number) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; const step = snap ?? 120; const next = { pitch, tick: cursorTick }
    if (e.key === 'ArrowUp') next.pitch = Math.min(127, pitch + 1); else if (e.key === 'ArrowDown') next.pitch = Math.max(0, pitch - 1); else if (e.key === 'ArrowLeft') next.tick = Math.max(windowStart, cursorTick - step); else if (e.key === 'ArrowRight') next.tick = Math.min(windowEnd - 1, cursorTick + step); else if (e.key === 'Home') next.tick = windowStart; else if (e.key === 'End') next.tick = Math.max(windowStart, windowEnd - step); else if (e.key === 'Enter' || e.key === ' ') return; else return
    e.preventDefault(); e.stopPropagation(); setCursor(next); props.onCursorChange?.(next.tick); if (next.pitch !== pitch) viewport.current?.querySelector<HTMLButtonElement>(`[data-placement-pitch="${next.pitch}"]`)?.focus()
  }
  function updateSelected(patch: Partial<Note>) { if (!selected || disabled || !active) return false; if (Object.entries(patch).every(([key, value]) => selected[key as keyof Note] === value)) return true; const p = proposeNoteEdit(selected, patch, bars); if (!p) { const message = `That edit would go outside the MIDI range or ${MAX_BARS}-bar project limit.`; onMessage?.(message); props.onRejected?.(message); return false }; if (!commit({ notes: notes.map(n => n.id === selected.id ? p.note : n), bars: p.bars }, notes, 'Edit individual note')) return false; if (patch.pitch !== undefined) revealPitch(p.note.pitch); return true }
  function copySelection() { const chosen = notes.filter(note => selectedIds.has(note.id)); if (!chosen.length) return; copyNotes(chosen); onMessage?.(`Copied ${chosen.length} notes. Choose a grid position, then Paste notes.`) }
  function pasteSelection(duplicate = false) {
    if (disabled) return
    const chosen = duplicate ? notes.filter(note => selectedIds.has(note.id)) : copiedNotes()
    const at = duplicate ? Math.max(...chosen.map(note => note.startTick + note.durationTicks)) : cursorTick
    const p = pastePianoNotes(notes, chosen, at, bars, makeId)
    if (commit(p, notes, `${duplicate ? 'Duplicate' : 'Paste'} ${chosen.length} notes`) && isResult(p)) { const ids = new Set(p.notes.slice(notes.length).map(note => note.id)); choose(ids, ids.values().next().value ?? null) }
  }
  function batchPatch(patch: Partial<Pick<Note, 'durationTicks' | 'velocity'>>) { if (disabled) return false; const p = patchPianoSelection(notes, selectedIds, patch, bars); if (!isResult(p)) { onMessage?.(p.error); props.onRejected?.(p.error); return false }; return notesEqual(p.notes, notes) || commit(p) }
  function shiftSelection(pitch: number, tick = 0) { const p = movePianoNotes(notes, selectedIds, pitch, tick, bars); if (commit(p, notes, `Move ${selectedIds.size} notes`) && isResult(p)) { const note = p.notes.find(n => selectedIds.has(n.id)); if (note) revealPitch(note.pitch); return true }; return isResult(p) }
  function octave(delta: number) { shiftSelection(delta) }
  function fitNotes() { const pitches = notes.filter(n => overlaps(n, windowStart, windowEnd)).map(n => n.pitch); if (!viewport.current || !pitches.length) return; const high = Math.max(...pitches), low = Math.min(...pitches), height = Math.min(PIANO_ROLL_ROW_HEIGHT, viewport.current.clientHeight / (high - low + 3)); setRowHeight(height); viewport.current.scrollTop = Math.max(0, (127 - high) * height - height) }
  function removeSelection() { if (disabled || !selectedIds.size) return; const count = selectedIds.size; if (commit(deletePianoNotes(notes, selectedIds, bars))) { choose(new Set(), null); deletedMessage(count) } }
  function selectChord() { if (disabled || !active) return; const ids = chordNoteIds(notes, selected?.id ?? null); if (!ids.size) return; choose(ids, selected?.id ?? null); setTool('select'); if (ids.size > 1) props.onGuidanceAction?.('chord-selected'); onMessage?.(`Selected ${ids.size} notes starting within ⅛ beat of this note. Their exact timing is unchanged; drag any selected note to move the group.`) }
  function selectAll() { if (disabled) return; const ids = new Set(notes.filter(note => note.instrument === 'piano').map(note => note.id)); choose(ids, selectedId); setTool('select'); onMessage?.(`Selected all ${ids.size} notes in this part, including notes outside the shown bars.`) }
  function editorKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && gestureRef.current) { e.preventDefault(); cancelGesture(); return }
    const target = e.target as HTMLElement; if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return
    if (disabled || !active) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); selectAll(); return }
    if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'd'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); if (e.key.toLowerCase() === 'c') copySelection(); else pasteSelection(e.key.toLowerCase() === 'd'); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedIds.size) { e.preventDefault(); removeSelection() }; return }; if (!selectedIds.size || e.ctrlKey || e.metaKey) return
    const step = e.shiftKey ? 120 : 1; let p: PianoRollEditProposal | null = null
    if (e.key === 'ArrowUp') p = movePianoNotes(notes, selectedIds, 1, 0, bars); else if (e.key === 'ArrowDown') p = movePianoNotes(notes, selectedIds, -1, 0, bars); else if (e.key === 'ArrowLeft') p = e.altKey && selectedId ? resizePianoNote(notes, selectedId, -step, bars) : movePianoNotes(notes, selectedIds, 0, -step, bars); else if (e.key === 'ArrowRight') p = e.altKey && selectedId ? resizePianoNote(notes, selectedId, step, bars) : movePianoNotes(notes, selectedIds, 0, step, bars)
    if (p) { e.preventDefault(); e.stopPropagation(); if (commit(p) && isResult(p) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { const primary = p.notes.find(note => note.id === selectedId) ?? p.notes.find(note => selectedIds.has(note.id)); if (primary) revealPitch(primary.pitch) } }
  }

  useEffect(() => { const g = gestureRef.current; if (g && (!notesEqual(g.sourceNotes, notes) || g.sourceBars !== bars || disabled || !active)) cancelGesture() })
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && gestureRef.current) { event.preventDefault(); event.stopPropagation(); cancelGesture() } }
    const blur = () => { if (gestureRef.current) cancelGesture() }
    window.addEventListener('keydown', cancel, true); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', cancel, true); window.removeEventListener('blur', blur) }
  })
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = pointerPosition.current, view = viewport.current
      if (!p || !view || !gestureRef.current) return
      const box = view.getBoundingClientRect()
      if (pointerMoved.current && (p.y < box.top + 28 || p.y > box.bottom - 28)) advanceGesture(p.x, p.y, p.id)
      const grid = surface.current?.getBoundingClientRect()
      const direction = grid && p.y >= box.top && p.y <= box.bottom ? p.x >= Math.min(grid.right, box.right) - 24 ? 1 : p.x <= Math.max(grid.left + LABEL_WIDTH, box.left + LABEL_WIDTH) + 24 ? -1 : 0 : 0
      if (props.scrollTimeline && direction && pointerMoved.current) {
        view.scrollLeft += direction * 16
        advanceGesture(p.x, p.y, p.id)
        return
      }
      if (!direction || !pointerMoved.current || gestureRef.current?.kind === 'box' || !onSelectBar) { pagingEdge.current = null; return }
      const time = performance.now(), edge = pagingEdge.current
      if (!edge || edge.direction !== direction) { pagingEdge.current = { direction, since: time }; return }
      if (time - edge.since < 500) return
      const next = direction > 0 ? startBar + visibleBars : Math.max(0, startBar - visibleBars)
      pagingEdge.current = { direction, since: time }
      if (next !== startBar && next < bars) onSelectBar(next)
    }, 35)
    return () => window.clearInterval(timer)
  })
  useEffect(() => {
    const p = pointerPosition.current
    if (p && gestureRef.current && gestureRef.current.kind !== 'box') advanceGesture(p.x, p.y, p.id)
    // Re-project the same immutable gesture when edge paging changes its window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart, windowTicks])
  const beatHeaders = Array.from({ length: visibleBars * 4 }, (_, i) => ({ bar: startBar + Math.floor(i / 4) + 1, beat: i % 4 + 1 })), playheadVisible = props.playhead !== undefined && props.playhead >= windowStart && props.playhead <= windowEnd
  const extraActions = <div className="note-tools note-batch-tools" role="toolbar" aria-label="Selected note actions"><button data-help-target={compact ? undefined : "select-chord"} disabled={disabled || !selected} title="Select notes starting within ⅛ beat. Exact timing is preserved." onClick={selectChord}>Select chord</button><button disabled={disabled || !notes.some(note => note.instrument === 'piano')} onClick={selectAll}>Select all</button>{!compact && <button disabled={disabled || !selectedIds.size} onClick={copySelection}>Copy notes</button>}<button disabled={disabled} onClick={() => pasteSelection()}>Paste notes</button>{!compact && <button disabled={disabled || !selectedIds.size} onClick={() => pasteSelection(true)}>Duplicate notes</button>}<button disabled={disabled || !selectedIds.size} onClick={() => octave(-12)}>Octave −</button><button disabled={disabled || !selectedIds.size} onClick={() => octave(12)}>Octave +</button>{!compact && <button onClick={fitNotes}>Fit notes vertically</button>}{rowHeight !== PIANO_ROLL_ROW_HEIGHT && <button onClick={() => { setRowHeight(PIANO_ROLL_ROW_HEIGHT); if (viewport.current) viewport.current.scrollTop = defaultRowTop(cursor.pitch + 3) }}>Reset note height</button>}{compact && <button onClick={() => setHintVisible(!hintVisible)}>{hintVisible ? 'Hide' : 'Show'} editing hint</button>}</div>
  return <div className={`piano-roll-editor composing-editor${compact ? ' composing-editor--compact' : ''}${props.scrollTimeline ? ' composing-editor--timeline' : ''}${disabled ? ' is-disabled' : ''}`} onKeyDown={editorKeyDown} aria-disabled={disabled || undefined}>
    <div className="note-tools" data-help-target="note-tools" role="toolbar" aria-label="Note tools">{(['draw', 'select', 'erase'] as const).map(value => <button type="button" key={value} aria-pressed={tool === value} disabled={disabled} onClick={() => setTool(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}<button type="button" disabled={disabled || tool !== 'draw'} onClick={() => placeKeyboard(cursor.pitch)}>Place {noteName(cursor.pitch)} at bar {Math.floor(cursorTick / TICKS_PER_BAR) + 1} beat {Number((cursorTick % TICKS_PER_BAR / TICKS_PER_BEAT + 1).toFixed(3))}</button><label>Snap<select aria-label="Snap grid" value={snap ?? 'off'} disabled={disabled} onChange={e => setSnap(e.target.value === 'off' ? null : Number(e.target.value) as PianoRollSnap)}><option value={480}>1 beat</option><option value={240}>½ beat</option><option value={120}>¼ beat</option><option value="off">Off</option></select></label>{compact && <button type="button" aria-label="Fit notes vertically" onClick={fitNotes}>Fit notes</button>}{compact ? <>{extraActions}{selectedIds.size > 0 && <><span className="selection-count">{selectedIds.size} selected</span><button disabled={disabled} onClick={copySelection}>Copy</button><button disabled={disabled} onClick={() => pasteSelection(true)}>Duplicate</button><button disabled={disabled} data-help-target="delete-notes" onClick={removeSelection}>Delete selected</button></>}</> : <><span className="selection-count" aria-live="polite">{selectedIds.size} selected</span><button type="button" className="delete-selection" data-help-target="delete-notes" title={!selectedIds.size ? 'Select one or more notes to delete.' : undefined} disabled={disabled || !selectedIds.size} onClick={removeSelection}>Delete selected</button></>}</div>
    {!compact && extraActions}

    {hintVisible && <div className="editor-hint">{compact ? 'Draw notes. Shift-click to select a chord; drag to move it.' : 'Click a note → Select chord. Or Shift-click notes / Select → drag a box. Drag any selected note to move the group.'}<button type="button" aria-label="Dismiss editor hint" onClick={() => setHintVisible(false)}>×</button></div>}
    <span className="sr-only" aria-live="polite">Placement cursor: {noteName(cursor.pitch)}, bar {Math.floor(cursorTick / TICKS_PER_BAR) + 1}, beat {Number((cursorTick % TICKS_PER_BAR / TICKS_PER_BEAT + 1).toFixed(3))}.</span>
    <div className="roll-ruler-viewport" ref={rulerViewport} style={{ width: props.scrollTimeline && rulerWidth ? rulerWidth : undefined }}><div className="roll-beats" style={{ width: props.scrollTimeline && timelineWidth ? timelineWidth : undefined, gridTemplateColumns: `${LABEL_WIDTH}px repeat(${beatHeaders.length}, minmax(0, 1fr))` }}><span>Pitch</span>{beatHeaders.map((item, i) => <button type="button" key={i} aria-label={`Set note cursor bar ${item.bar} beat ${item.beat}`} onClick={() => { const tick = windowStart + i * TICKS_PER_BEAT; setCursor(c => ({ ...c, tick })); props.onCursorChange?.(tick); viewport.current?.querySelector<HTMLButtonElement>(`[data-placement-pitch="${cursor.pitch}"]`)?.focus({ preventScroll: true }) }}><b>{compact ? item.beat === 1 ? `B${item.bar}` : item.beat : `B${item.bar} · ${item.beat}`}</b></button>)}</div></div>
    <div className="piano-roll-viewport" ref={viewport} onScroll={e => { if (rulerViewport.current) rulerViewport.current.scrollLeft = e.currentTarget.scrollLeft; if (props.scrollTimeline && timelineWidth) { const next = Math.min(bars - 1, Math.floor((e.currentTarget.scrollLeft + 1) / pixelsPerBar)); const group = Math.floor(next / barsPerView) * barsPerView; if (panReportedBar.current !== group) { panReportedBar.current = group; onSelectBar?.(group) } } if (active && viewportInitialized.current && e.currentTarget.clientHeight > 0) { viewSnapshot.current.scrollTop = e.currentTarget.scrollTop; viewSnapshot.current.scrollLeft = e.currentTarget.scrollLeft } }} data-help-target="piano-roll" tabIndex={-1} aria-label={`Piano roll, bars ${startBar + 1} to ${startBar + visibleBars}. Scroll vertically for pitches; scroll sideways or Shift+wheel for later bars.`}><div className="piano-roll-surface" ref={surface} style={{ height: MIDI_PITCH_COUNT * rowHeight, width: props.scrollTimeline && timelineWidth ? timelineWidth : undefined }} onPointerMove={updateGesture} onPointerUp={endGesture} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gestureRef.current) cancelGesture() }}>
      {Array.from({ length: MIDI_PITCH_COUNT }, (_, i) => 127 - i).map(pitch => <div className={`roll-row ${[1, 3, 6, 8, 10].includes(pitch % 12) ? 'roll-row--black' : ''}`} key={pitch} style={{ top: rowTop(pitch), height: rowHeight, fontSize: Math.min(10, rowHeight - 1) }}><span className="roll-pitch">{noteName(pitch)}</span><button type="button" className="roll-placement" style={{ backgroundSize: `${100 / (visibleBars * 16)}% 100%` }} data-placement-pitch={pitch} tabIndex={cursor.pitch === pitch ? 0 : -1} disabled={disabled} aria-describedby={placementHelpId} aria-label={visibleBars === 1 ? `Place ${noteName(pitch)} in bar ${startBar + 1}` : `Place ${noteName(pitch)} in bars ${startBar + 1} to ${startBar + visibleBars}`} onFocus={() => setCursor(c => ({ ...c, pitch }))} onKeyDown={e => placementKeyDown(e, pitch)} onPointerDown={e => beginGrid(e, pitch)} onPointerMove={updateGesture} onPointerUp={endGesture} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gestureRef.current) cancelGesture() }} onClick={e => { if (e.detail === 0) placeKeyboard(pitch) }}>{cursor.pitch === pitch && <span className="roll-placement-cursor" aria-hidden="true" style={{ left: `${(cursorTick - windowStart) / windowTicks * 100}%`, width: `${(snap ?? 1) / windowTicks * 100}%` }} />}</button></div>)}
      {playheadVisible && <div className={`roll-playhead${props.playing ? ' is-playing' : ''}`} aria-hidden="true" style={{ left: `calc(${LABEL_WIDTH}px + (100% - ${LABEL_WIDTH}px) * ${(props.playhead! - windowStart) / windowTicks})` }} />}
      <div className="roll-notes">{visibleNotes.map(note => { const active = selectedIds.has(note.id), before = note.startTick < windowStart, after = note.startTick + note.durationTicks > windowEnd, clippedStart = Math.max(windowStart, note.startTick), clippedEnd = Math.min(windowEnd, note.startTick + note.durationTicks); return <button type="button" key={note.id} disabled={disabled} data-help-target={active ? 'note-body' : undefined} data-help-track-id={props.helpDestination?.trackId} data-help-clip-id={props.helpDestination?.clipId} aria-pressed={active} aria-label={`Select ${noteName(note.pitch)}, tick ${note.startTick}, length ${note.durationTicks}, velocity ${note.velocity}`} data-note-id={note.id} data-continues-before={before || undefined} data-continues-after={after || undefined} className={`roll-note${active ? ' is-selected' : ''}`} style={{ top: rowTop(note.pitch) + Math.min(2, rowHeight / 8), height: rowHeight - Math.min(4, rowHeight / 4), fontSize: Math.min(10, rowHeight - 1), left: `${(clippedStart - windowStart) / windowTicks * 100}%`, width: `${(clippedEnd - clippedStart) / windowTicks * 100}%` }} onPointerDown={e => beginNote(e, note)} onPointerMove={updateGesture} onPointerUp={endGesture} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gestureRef.current) cancelGesture() }} onContextMenu={e => contextErase(e, note)}>{before ? '← ' : ''}{noteName(note.pitch)}{after ? ' →' : ''}{!after && <span className="roll-note-resize" data-help-target={active && !disabled ? 'note-resize' : undefined} data-help-track-id={props.helpDestination?.trackId} data-help-clip-id={props.helpDestination?.clipId} data-resize-note={note.id} aria-hidden="true" />}</button> })}</div>
      {selectionBox && <div className="selection-box" aria-hidden="true" style={selectionBox} />}
    </div></div>
    <div className={compact ? 'compact-editor-footer' : undefined}><details className={`note-properties${compact ? ' is-compact' : ''}`} open={compact ? undefined : true}><summary>Note properties{selectedIds.size ? ` · ${selectedIds.size} selected` : ''}</summary>
    <div className="note-inspector" data-help-target="selected-note" aria-label="Selected note inspector"><strong>{selectedIds.size > 1 ? `${selectedIds.size} notes` : 'Selected note'}</strong>{selected ? <>
      {compact && selectedIds.size > 1 && <fieldset className="group-relative"><legend>Move all selected</legend><button disabled={disabled} onClick={() => shiftSelection(-1)}>Pitch −1</button><button disabled={disabled} onClick={() => shiftSelection(1)}>Pitch +1</button><button disabled={disabled} onClick={() => shiftSelection(0, -TICKS_PER_BEAT)}>Time −1 beat</button><button disabled={disabled} onClick={() => shiftSelection(0, TICKS_PER_BEAT)}>Time +1 beat</button></fieldset>}
      <details className="individual-note" open={!compact || selectedIds.size < 2 ? true : undefined}><summary>Individual note · {noteName(selected.pitch)}</summary><div className="individual-note-fields">
      <label>Pitch<select aria-label="Selected note pitch" value={selected.pitch} disabled={disabled} onChange={e => updateSelected({ pitch: Number(e.target.value) })}>{Array.from({ length: 128 }, (_, p) => <option key={p} value={p}>{noteName(p)}</option>)}</select></label>
      <fieldset><legend>Position · primary note</legend><label>Bar<NumericDraft key={`bar-${selected.id}-${selected.startTick}`} label="Selected note position bar" min={1} max={MAX_BARS} integer value={Math.floor(selected.startTick / TICKS_PER_BAR) + 1} disabled={disabled} onCommit={value => updateSelected({ startTick: (value - 1) * TICKS_PER_BAR + selected.startTick % TICKS_PER_BAR })} /></label><label>Beat<NumericDraft key={`beat-${selected.id}-${selected.startTick}`} label="Selected note position beat" min={1} max={1 + (TICKS_PER_BAR - 1) / TICKS_PER_BEAT} value={selected.startTick % TICKS_PER_BAR / TICKS_PER_BEAT + 1} disabled={disabled} onCommit={value => updateSelected({ startTick: Math.floor(selected.startTick / TICKS_PER_BAR) * TICKS_PER_BAR + Math.round((value - 1) * TICKS_PER_BEAT) })} /></label></fieldset>
      </div></details>
      <label>{selectedIds.size > 1 ? 'Length (beats) · all selected' : 'Length (beats)'}<NumericDraft key={`length-${selected.id}-${selected.durationTicks}`} label="Selected note length beats" min={1 / TICKS_PER_BEAT} value={selected.durationTicks / TICKS_PER_BEAT} disabled={disabled} onCommit={value => batchPatch({ durationTicks: Math.round(value * TICKS_PER_BEAT) })} /></label><label>{selectedIds.size > 1 ? 'Strength · all selected' : 'Strength'}<NumericDraft key={`velocity-${selected.id}-${selected.velocity}`} label="Selected note velocity" min={1} max={127} integer value={selected.velocity} disabled={disabled} onCommit={value => batchPatch({ velocity: value })} /></label>
      {!compact && <button type="button" disabled={disabled} onClick={() => { if (commit(deletePianoNotes(notes, new Set([selected.id]), bars))) { choose(new Set([...selectedIds].filter(id => id !== selected.id)), null); deletedMessage(1) } }}>Delete note</button>}<details className="advanced-note"><summary>Advanced · exact ticks</summary><label>Start tick · individual note<NumericDraft key={`start-${selected.id}-${selected.startTick}`} label="Selected note start tick" min={0} integer value={selected.startTick} disabled={disabled} onCommit={value => updateSelected({ startTick: value })} /></label><label>Length ticks · primary note<NumericDraft key={`ticks-${selected.id}-${selected.durationTicks}`} label="Selected note length ticks" min={1} integer value={selected.durationTicks} disabled={disabled} onCommit={value => updateSelected({ durationTicks: value })} /></label></details>
    </> : <span>Select a note to edit pitch, position, length and strength.</span>}</div></details>
    <details className="roll-help"><summary>Help & shortcuts</summary><div id={placementHelpId}>Draw: click for a one-beat note or drag for length. Notes: drag to move; drag the right edge to resize; right-click to erase. While drawing, moving, resizing or erasing, hold near a side edge to reach earlier or later bars; near the top or bottom to reach more pitches. Select: drag a box within the shown bars; Shift-click toggles. Ctrl/Cmd+A in the editor selects all notes. Erase: drag across notes. Delete/Backspace removes selected notes. Escape cancels a gesture. Keyboard grid: ↑↓ pitch · ←→ time · Home/End · Enter places. Selected notes: arrows move · Shift moves 120 ticks · Alt+←→ resizes · 480 ticks = 1 beat.</div></details>
    </div>
  </div>
}
