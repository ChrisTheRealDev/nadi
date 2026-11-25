import { useState, type CSSProperties } from 'react'
import { DrumEditor, type DrumInstrument } from '../DrumEditor'
import type { Note } from '../model'
import { isMelodicSound, TICKS_PER_BAR, type StudioProject } from './model'
import { addPattern } from './operations'
import { applyDrumClip, drumClipsInRange, projectDrumClip } from './combinedDrumEdits'
import { normalizeEditResult, type EditResult } from './editResult'
import type { HistoryDescription } from './history'

export interface CombinedDrumsProps {
  project: StudioProject; startBar: number; visibleBars: number; selectedClipId: string | null
  onSelectClip: (id: string) => void; onEdit: (project: StudioProject, description?: HistoryDescription) => EditResult | boolean
  onMessage: (message: string) => void; onUndo: () => void; onPreview: (note: Note, trackId: string) => void
  onRejected?: (message: string) => void
  previewEnabled: boolean; playhead: number; playing: boolean; disabled?: boolean
  onNavigate?: (bar: number, visible: 1 | 2 | 4) => void
  onMakeIndependent?: (clipId: string) => void
  zoomBars?: 1 | 2 | 4
}

export function CombinedDrums({ project, startBar, visibleBars, selectedClipId, onSelectClip, onEdit, onMessage, onRejected, onUndo, onPreview, previewEnabled, playhead, playing, disabled = false, onNavigate, onMakeIndependent, zoomBars = 4 }: CombinedDrumsProps) {
  const [tool, setTool] = useState<'draw' | 'erase'>('draw')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const tracks = project.tracks.filter(track => !isMelodicSound(track.soundId) && !track.hidden)
  const rejected = (message: string): EditResult => { onRejected?.(message); return { status: 'rejected', message } }
  const apply = (next: StudioProject, description?: HistoryDescription): EditResult => {
    try { const result = normalizeEditResult(onEdit(next, description)); if (result.status === 'rejected') onRejected?.(result.message); return result }
    catch (error) { return rejected(error instanceof Error ? error.message : 'That drum edit could not be applied.') }
  }
  function choose(trackId: string, clipId: string) { setChoices(previous => ({ ...previous, [trackId]: clipId })); onSelectClip(clipId) }
  function create(trackId: string) {
    try { const next = addPattern(project, trackId, startBar * TICKS_PER_BAR, visibleBars * TICKS_PER_BAR); const created = next.clips.at(-1)!; const result = apply(next, { label: 'Create drum part', affectedIds: [created.id], context: { panel: 'drums', trackId, clipId: created.id } }); if (result.status === 'accepted') choose(trackId, created.id); else if (result.message) onMessage(result.message) }
    catch (error) { const message = error instanceof Error ? error.message : 'Could not create that drum part.'; onRejected?.(message); onMessage(message) }
  }
  return <section className="combined-drums" aria-label="Combined song drum grid" data-help-target="combined-drums">
    {onNavigate && <div className="minimal-note-navigation"><button aria-label="Previous drum bars" disabled={!startBar} onClick={() => onNavigate(Math.max(0, startBar - zoomBars), zoomBars)}>←</button><span>Bars {startBar + 1}–{startBar + visibleBars}</span><button aria-label="Next drum bars" disabled={startBar + visibleBars >= project.bars} onClick={() => onNavigate(startBar + visibleBars, zoomBars)}>→</button><select aria-label="Visible drum bars" value={zoomBars} onChange={event => onNavigate(startBar, Number(event.target.value) as 1 | 2 | 4)}><option value={1}>1 bar</option><option value={2}>2 bars</option><option value={4}>4 bars</option></select></div>}
    <div className="drum-toolbar" data-help-target="drum-tools"><strong>Song drum grid · bars {startBar + 1}–{startBar + visibleBars}</strong>{(['draw', 'erase'] as const).map(value => <button key={value} disabled={disabled} aria-pressed={tool === value} onClick={() => setTool(value)}>{value === 'draw' ? 'Draw' : 'Erase'}</button>)}<span>Each row names the part receiving your hits. Use the global Undo command.</span></div>
    {!tracks.length && <p>Add Kick, Snare or Hi-hat to start a beat. Hidden tracks keep their music.</p>}
    <div className="combined-drum-scroll"><div className="drum-surface combined-drum-time" style={{ '--visible-bars': visibleBars, '--surface-min-width': `${Math.max(720, visibleBars * 360)}px` } as CSSProperties}><div className="step-numbers drum-time-ruler" aria-hidden="true"><span className="drum-row-label">Time</span><div className="drum-ruler-bars">{Array.from({ length: visibleBars }, (_, bar) => <div className="drum-ruler-bar" key={bar}><em>Bar {startBar + bar + 1}</em>{[1, 2, 3, 4].map(beat => <b key={beat}>Beat {beat}</b>)}</div>)}</div></div></div>{tracks.map(track => {
      const candidates = drumClipsInRange(project, track.id, startBar, visibleBars)
      const explicit = candidates.find(clip => clip.id === selectedClipId) ?? candidates.find(clip => clip.id === choices[track.id])
      const clip = explicit ?? (candidates.length === 1 ? candidates[0] : undefined)
      const pattern = project.patterns.find(item => item.id === clip?.patternId)
      const uses = pattern ? project.clips.filter(item => item.patternId === pattern.id).length : 0
      return <div className="combined-drum-track" key={track.id} data-drum-track-id={track.id} onPointerDownCapture={() => { if (!disabled && clip && selectedClipId !== clip.id) onSelectClip(clip.id) }} onFocusCapture={() => { if (!disabled && clip && selectedClipId !== clip.id) onSelectClip(clip.id) }}>
        <div className="combined-drum-destination"><strong style={{ color: track.color }}>{track.name}</strong>{candidates.length > 1 && <label>Edit part<select aria-label={`Editing drum part for ${track.name}`} disabled={disabled} value={clip?.id ?? ''} onChange={event => choose(track.id, event.target.value)}><option value="" disabled>Choose a part before editing</option>{candidates.map(item => <option key={item.id} value={item.id}>{project.patterns.find(part => part.id === item.patternId)?.name} · song bar {Math.floor(item.startTick / TICKS_PER_BAR) + 1}{item.startTick % TICKS_PER_BAR ? ` + ${item.startTick % TICKS_PER_BAR} ticks` : ''}</option>)}</select></label>}
          {pattern && <span>Editing {pattern.name}{uses > 1 ? ` · linked: edits affect ${uses} copies` : ''}</span>}
          {uses > 1 && clip && onMakeIndependent && <button type="button" data-help-target="make-independent" data-help-track-id={track.id} data-help-clip-id={clip.id} disabled={disabled} onClick={() => onMakeIndependent(clip.id)}>Make independent</button>}
          {pattern && clip && <button disabled={disabled || !pattern.notes.some(note => note.startTick + clip.startTick >= startBar * TICKS_PER_BAR && note.startTick + clip.startTick < (startBar + 1) * TICKS_PER_BAR)} onClick={() => {
            if (!window.confirm(`Clear ${track.name} hits starting in song bar ${startBar + 1} of this part? Earlier starts are preserved. ${uses > 1 ? 'Linked copies share this edit. ' : ''}Undo is available.`)) return
            try { const before = projectDrumClip(project, clip.id); const notes = before.filter(note => note.startTick < startBar * TICKS_PER_BAR || note.startTick >= (startBar + 1) * TICKS_PER_BAR); const deleted = before.filter(note => !notes.some(item => item.id === note.id)); const result = apply(applyDrumClip(project, clip.id, notes), { label: `Clear ${track.name} in bar ${startBar + 1}`, affectedIds: deleted.map(note => note.id), context: { panel: 'drums', trackId: track.id, clipId: clip.id, noteIds: deleted.map(note => note.id) } }); if (result.status === 'accepted') onMessage(`Cleared ${track.name} in song bar ${startBar + 1}. Undo restores those hits.`); else if (result.message) onMessage(result.message) }
            catch (error) { const message = error instanceof Error ? error.message : 'No hits were cleared.'; onRejected?.(message); onMessage(message) }
          }}>Clear {track.name} · bar {startBar + 1}</button>}
          {!candidates.length && <button disabled={disabled} onClick={() => create(track.id)}>Create part here</button>}
        </div>
        {!clip ? <p>{candidates.length ? 'Multiple parts appear here. Choose which receives your edits.' : 'No part is placed in these bars.'}</p> : <DrumEditor key={clip.id}
          notes={projectDrumClip(project, clip.id)} bars={project.bars} startBar={startBar} visibleBars={visibleBars} playhead={playhead} playing={playing}
          instruments={[track.soundId as DrumInstrument]} controlledTool={tool} hideToolbar compact disabled={disabled} previewEnabled={previewEnabled}
          editableStartTick={clip.startTick} editableEndTick={clip.startTick + (pattern?.lengthTicks ?? 0)}
          onPreview={note => onPreview(note, track.id)} onMessage={onMessage} onUndo={onUndo}
          onChange={notes => { try { const before = projectDrumClip(project, clip.id); const added = notes.filter(note => !before.some(item => item.id === note.id)); const removed = before.filter(note => !notes.some(item => item.id === note.id)); const ids = [...added, ...removed].map(note => note.id); return apply(applyDrumClip(project, clip.id, notes), { label: added.length ? `Add ${added.length} drum hit(s)` : `Erase ${removed.length} drum hit(s)`, affectedIds: ids, context: { panel: 'drums', trackId: track.id, clipId: clip.id, noteIds: ids } }) } catch (error) { return rejected(error instanceof Error ? error.message : 'That drum edit could not be applied.') } }} />}
      </div>
    })}</div>
  </section>
}
