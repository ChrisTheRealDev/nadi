import { useEffect, useMemo, useRef, useState } from 'react'
import { PianoRoll, type PianoRollUiState } from '../PianoRoll'
import { editorProjection, patternNotes } from './editorAdapter'
import { updatePatternNotes } from './operations'
import { EditorContext, TrackControls, type WorkbenchProps, type SoundControls } from './Workbench'
import type { Note } from '../model'
import type { HistoryDescription } from './history'
import { duplicateBarToEnd, repeatBarNext } from '../edits'
import { patchNotesPanelView, type NotesPanelView as View } from './notesPanelState'
import type { PianoGuidanceAction } from '../pianoRollGuidance'

export interface NotesPanelProps extends WorkbenchProps, SoundControls {
  active: boolean; playhead: number; playing: boolean; previewEnabled: boolean
  onEdit: (next: WorkbenchProps['project'], description?: HistoryDescription) => boolean
  onPreview: (note: Note, trackId: string) => void
  onMessage: (text: string) => void; onUndo: () => void; onTogglePreview: () => void
  onUiState?: (state: PianoRollUiState) => void; onRejected?: (message: string) => void
  onRepeated?: (destination: { trackId: string; clipId: string }) => void
  onGuidanceAction?: (action: PianoGuidanceAction, destination: { trackId: string; clipId: string }) => void
  onPosition: (bar: number, cursor: number, visible: 1 | 2 | 4) => void
  onActivate: () => void
  restoreSelection?: { sequence: number; ids: string[] }
  controlledView?: View
  onViewChange?: (patch: Partial<View>) => void
}
export function NotesPanel(props: NotesPanelProps) {
  const { project, selectedTrackId, selectedClipId } = props
  const clip = project.clips.find(item => item.id === selectedClipId && item.trackId === selectedTrackId)
  const part = project.patterns.find(item => item.id === clip?.patternId)
  const key = `${project.id}:${part?.id ?? selectedTrackId}`
  const [views, setViews] = useState<Record<string, View>>({})
  const viewsCurrent = useRef<Record<string, View>>({})
  const view = props.controlledView ?? views[key] ?? { bar: 0, visible: 4, primary: null, cursor: 0 }
  const projection = useMemo(() => editorProjection(project, selectedTrackId ?? undefined, part?.id), [project, selectedTrackId, part?.id])
  const restore = props.restoreSelection
  const consumedRestores = useRef(new Map<string, number>())
  useEffect(() => {
    if (!restore || consumedRestores.current.get(key) === restore.sequence) return
    consumedRestores.current.set(key, restore.sequence)
    const note = part?.notes.find(item => restore.ids.includes(item.id))
    if (note) {
      if (props.onViewChange) { props.onViewChange({ bar: Math.floor(note.startTick / 1920), primary: note.id }); return }
      const restored = patchNotesPanelView(viewsCurrent.current, key, { bar: Math.floor(note.startTick / 1920), primary: note.id })
      viewsCurrent.current = restored.views
      // Synchronize an external history command, not derived project state.
      setViews(restored.views)
    }
  // A history event should reveal once, not jump back during subsequent editing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.sequence, key])
  const bar = Math.min(view.bar, projection.bars - 1), start = Math.floor(bar / view.visible) * view.visible
  const patch = (change: Partial<View>) => {
    if (props.onViewChange) { props.onViewChange(change); return }
    const result = patchNotesPanelView(viewsCurrent.current, key, change)
    // A pointer event can choose a bar, then selection, then cursor before React renders.
    viewsCurrent.current = result.views; setViews(result.views)
    props.onPosition(result.next.bar, result.next.cursor, result.next.visible)
  }
  const activate = () => { const latest = props.controlledView ?? viewsCurrent.current[key] ?? view; props.onActivate(); props.onPosition(Math.min(latest.bar, projection.bars - 1), latest.cursor, latest.visible) }
  const safeEdit = (operation: () => WorkbenchProps['project'], description: HistoryDescription) => {
    if (props.disabled || !props.active || !part) return false
    try { return props.onEdit(operation(), { ...description, context: { panel: 'notes', trackId: selectedTrackId ?? undefined, clipId: clip?.id, ...description.context } }) }
    catch (error) { const message = error instanceof Error ? error.message : 'That edit could not be applied.'; props.onMessage(`${message} Your music is unchanged.`); props.onRejected?.(message); return false }
  }
  const repeat = (toEnd: boolean) => {
    if (!part) return
    let target = bar + 1
    const accepted = safeEdit(() => {
      const copied = (toEnd ? duplicateBarToEnd : repeatBarNext)({ ...projection, ideas: [] }, bar)
      if (toEnd) target = projection.bars
      return updatePatternNotes(project, part.id, patternNotes(copied.notes), copied.bars * 1920)
    }, { label: toEnd ? 'Duplicate bar to end' : 'Repeat bar in next bar' })
    if (accepted) { if (selectedTrackId && clip) props.onRepeated?.({ trackId: selectedTrackId, clipId: clip.id }); patch({ bar: target, cursor: target * 1920 }) }
  }
  const clear = () => {
    if (!part) return
    const notes = part.notes.filter(note => note.startTick < bar * 1920 || note.startTick >= (bar + 1) * 1920)
    if (notes.length === part.notes.length || !window.confirm(`Clear notes starting in bar ${bar + 1}? Earlier sustained notes are kept. Undo is available.`)) return
    safeEdit(() => updatePatternNotes(project, part.id, notes), { label: 'Clear bar', affectedIds: part.notes.filter(note => !notes.some(kept => kept.id === note.id)).map(note => note.id) })
  }
  return <div className="minimal-notes-panel" onPointerDownCapture={activate} onFocusCapture={activate}>
    <div className="notes-part-toolbar"><TrackControls {...props} melodicOnly /><EditorContext {...props} /></div>
    {!part ? <div className="empty-part"><p>Choose a part to draw notes.</p>{project.patterns.filter(item => item.trackId === selectedTrackId).map(item => <button key={item.id} disabled={props.disabled} onClick={() => props.onAction({ type: 'clip-place', patternId: item.id, startTick: 0 })}>Place {item.name}</button>)}<button disabled={props.disabled || !selectedTrackId} onClick={() => selectedTrackId && props.onAction({ type: 'pattern-create', trackId: selectedTrackId, startTick: 0 })}>Create new part</button></div> : <>
      <div className="minimal-note-navigation"><button aria-label="Previous bars" disabled={!start} onClick={() => patch({ bar: Math.max(0, start - view.visible) })}>←</button><span>Bars {start + 1}–{Math.min(projection.bars, start + view.visible)}</span><button aria-label="Next bars" disabled={start + view.visible >= projection.bars} onClick={() => patch({ bar: start + view.visible })}>→</button><select aria-label="Visible bars" value={view.visible} onChange={event => patch({ visible: Number(event.target.value) as 1 | 2 | 4 })}><option value={1}>1 bar</option><option value={2}>2 bars</option><option value={4}>4 bars</option></select><details><summary>Bar actions</summary><div><button disabled={props.disabled || projection.bars >= 256} onClick={() => safeEdit(() => updatePatternNotes(project, part.id, part.notes, (projection.bars + 1) * 1920), { label: 'Extend part' })}>Add bar</button><button data-help-target="repeat-next-bar" disabled={props.disabled} onClick={() => repeat(false)}>Repeat in next bar</button><button data-help-target="duplicate-bar" disabled={props.disabled} onClick={() => repeat(true)}>Duplicate bar to end</button><button disabled={props.disabled} onClick={clear}>Clear notes in bar {bar + 1}</button><label><input type="checkbox" data-help-target="preview-notes" checked={props.previewEnabled} onChange={props.onTogglePreview} />Preview notes</label></div></details></div>
      <PianoRoll helpDestination={{ trackId: selectedTrackId ?? undefined, clipId: clip?.id }} onGuidanceAction={action => { if (selectedTrackId && clip) props.onGuidanceAction?.(action, { trackId: selectedTrackId, clipId: clip.id }) }} key={key} stateKey={key} compact scrollTimeline active={props.active} notes={projection.notes} bars={projection.bars} selectedBar={bar} startBar={start} visibleBars={view.visible} selectedId={view.primary} onSelection={primary => patch({ primary })} onSelectBar={next => patch({ bar: next })} onCursorChange={cursor => patch({ cursor })} onChange={(notes, _bars, description) => safeEdit(() => updatePatternNotes(project, part.id, patternNotes(notes)), { ...description, label: description?.label ?? 'Edit notes', context: { noteIds: description?.affectedIds } })} playhead={props.playhead - (clip?.startTick ?? 0)} playing={props.playing} disabled={props.disabled} previewEnabled={props.previewEnabled} onPreview={note => selectedTrackId && props.onPreview(note, selectedTrackId)} onMessage={props.onMessage} onUiState={props.onUiState} onRejected={props.onRejected} onUndo={props.onUndo} restoreSelection={props.restoreSelection} />
    </>}
  </div>
}
