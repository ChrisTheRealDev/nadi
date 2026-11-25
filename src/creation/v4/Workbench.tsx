import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { Clip, Pattern, SoundId, StudioProject, Track } from './model'
import { SOUNDS as SOUND_CHOICES } from './sounds'
import { stackClips } from './workbenchMath'
import type { StudioMeters } from './audio'
import { createClipClipboard, type ClipClipboard } from './operations'
import './workbench.css'
import { NameDraft, ColourDraft } from './EditDraft'
import { ProductionControls } from './ProductionControls'
import type { TrackProduction } from './model'

let savedClipClipboard: { projectId: string; value: ClipClipboard } | null = null
function storeClipClipboard(project: StudioProject, ids: string[]) {
  savedClipClipboard = { projectId: project.id, value: createClipClipboard(project, ids) }
  return savedClipClipboard
}
const BAR = 1920
export type WorkbenchAction =
  | { type: 'track-add'; soundId: SoundId }
  | { type: 'track-select'; trackId: string }
  | { type: 'track-update'; trackId: string; patch: Partial<Pick<Track, 'name' | 'color' | 'soundId' | 'level' | 'muted' | 'hidden'>> }
  | { type: 'track-delete'; trackId: string }
  | { type: 'track-production'; trackId: string; patch: Partial<TrackProduction> }
  | { type: 'pattern-create'; trackId: string; startTick: number }
  | { type: 'pattern-rename'; patternId: string; name: string }
  | { type: 'clip-select'; clipId: string }
  | { type: 'clip-place'; patternId: string; startTick: number }
  | { type: 'clip-move'; clipId: string; startTick: number }
  | { type: 'clip-duplicate'; clipId: string; linked: boolean }
  | { type: 'clip-independent'; clipId: string }
  | { type: 'clip-delete'; clipId: string }
  | { type: 'clip-paste'; trackId: string; startTick: number; pattern: Pattern }
  | { type: 'clips-select'; clipIds: string[]; primary: string }
  | { type: 'clips-move'; clipIds: string[]; deltaTicks: number }
  | { type: 'clips-delete'; clipIds: string[] }
  | { type: 'clips-duplicate'; clipIds: string[] }
  | { type: 'clips-paste'; clipboard: ClipClipboard; startTick: number }

export interface WorkbenchProps {
  project: StudioProject
  selectedTrackId: string | null
  selectedClipId: string | null
  selectedClipIds?: string[]
  onAction: (action: WorkbenchAction) => void
  disabled?: boolean
  active?: boolean
  onEditClip?: (clipId: string) => void
}
export interface SoundControls {
  onPreviewSound?: (soundId: SoundId) => void
  soundStatus?: Partial<Record<SoundId, { state: 'loading' | 'ready' | 'error'; message?: string }>>
  onRetrySound?: (soundId: SoundId) => void
}

export function SoundBrowser({ project, onAction, disabled, onPreviewSound, soundStatus, onRetrySound }: WorkbenchProps & SoundControls) {
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState('All')
  const categories = [...new Set(SOUND_CHOICES.map(sound => sound.category))]
  const matches = SOUND_CHOICES.filter(sound => (family === 'All' || sound.category === family) && `${sound.name} ${sound.category}`.toLowerCase().includes(search.trim().toLowerCase()))
  const melodicCount = project.tracks.filter(track => !['kick', 'snare', 'hat'].includes(track.soundId)).length
  return <div className="v4-sounds" data-help-target="instrument-picker" tabIndex={-1}><h2>Add instrument</h2><p>Each addition gets its own track. Preview does not add notes.</p><div className="v4-sound-filters"><label>Find a sound<input type="search" aria-label="Find a sound" placeholder="Cello, flute, brass…" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Family<select aria-label="Sound family" value={family} onChange={event => setFamily(event.target.value)}><option>All</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label></div>{!matches.length && <p role="status">No matching sounds. Try another name or choose All.</p>}{categories.filter(category => matches.some(sound => sound.category === category)).map(category => <section key={category}><h3>{category}</h3>{matches.filter(sound => sound.category === category).map(sound => {
    const status = soundStatus?.[sound.id]
    const full = project.tracks.length >= 16 || (category !== 'Drums' && melodicCount >= 15)
    return <div className="v4-sound" key={sound.id}><strong>{sound.name}</strong><button type="button" aria-label={`Preview ${sound.name}`} disabled={!onPreviewSound || status?.state === 'loading'} onClick={() => onPreviewSound?.(sound.id)}>▶</button><button type="button" aria-label={`Add ${sound.name}`} disabled={disabled || full} title={full ? 'Maximum 16 tracks, including 15 melodic tracks.' : undefined} onClick={event => { onAction({ type: 'track-add', soundId: sound.id }); const menu = event.currentTarget.closest('details'); if (menu) menu.open = false }}>Add</button>{status?.state === 'loading' && <small role="status">Loading sound…</small>}{status?.state === 'error' && <small role="alert">{status.message ?? 'Sound unavailable.'} <button type="button" onClick={() => onRetrySound?.(sound.id)}>Retry {sound.name}</button></small>}</div>
  })}</section>)}</div>
}

export function TrackControls(props: WorkbenchProps & SoundControls & { melodicOnly?: boolean; hideAdd?: boolean }) {
  const { project, selectedTrackId, onAction, disabled } = props
  const track = project.tracks.find(item => item.id === selectedTrackId)
  const selectableTracks = props.melodicOnly ? project.tracks.filter(item => !['kick', 'snare', 'hat'].includes(item.soundId)) : project.tracks
  const update = (patch: Extract<WorkbenchAction, { type: 'track-update' }>['patch']) => { if (track) onAction({ type: 'track-update', trackId: track.id, patch }) }
  const remove = () => {
    if (!track) return
    const notes = project.patterns.filter(pattern => pattern.trackId === track.id).reduce((sum, pattern) => sum + pattern.notes.length, 0)
    if (notes && !window.confirm(`Delete “${track.name}” and its ${notes} notes, patterns and clips? You can undo this.`)) return
    onAction({ type: 'track-delete', trackId: track.id })
  }
  return <div className="v4-track-controls" data-help-target="track-controls"><label>Track<select aria-label="Selected instrument track" value={track?.id ?? ''} disabled={disabled} onChange={event => onAction({ type: 'track-select', trackId: event.target.value })}>{!track && <option value="">Choose a track</option>}{selectableTracks.map(item => <option key={item.id} value={item.id}>{item.name}{item.hidden ? ' · hidden' : ''}</option>)}</select></label>{!props.hideAdd && <details className="v4-add-menu"><summary data-help-target="instrument-picker">+ Add instrument</summary><SoundBrowser {...props} /></details>}{track && <><details className="v4-track-settings"><summary data-help-target="track-settings">Track settings</summary><div><label>Name<NameDraft key={`${track.id}:${track.name}`} label="Track name" value={track.name} disabled={disabled} onCommit={name => update({ name })} /></label><label>Colour<ColourDraft key={`${track.id}:${track.color}`} value={track.color} disabled={disabled} onCommit={color => update({ color })} /></label><label>Sound<select data-help-target="track-sound" aria-label="Track sound" value={track.soundId} disabled={disabled} onChange={event => update({ soundId: event.target.value as SoundId })}>{SOUND_CHOICES.map(sound => <option key={sound.id} value={sound.id}>{sound.name}</option>)}</select></label><button type="button" disabled={disabled} onClick={() => update({ hidden: !track.hidden })}>{track.hidden ? 'Show track' : 'Hide track'}</button><button type="button" className="danger-quiet" data-help-target="delete-track" disabled={disabled} onClick={remove}>Delete track</button><small>Hide removes the lane from view, not from your song.</small></div></details><span className="v4-record-target" data-help-target="record-destination">Playing / recording: <strong>{track.name}</strong></span></>}</div>
}

export function EditorContext({ project, selectedTrackId, selectedClipId, onAction, disabled }: WorkbenchProps) {
  const track = project.tracks.find(item => item.id === selectedTrackId)
  const clip = project.clips.find(item => item.id === selectedClipId)
  const pattern = project.patterns.find(item => item.id === clip?.patternId)
  const uses = project.clips.filter(item => item.patternId === pattern?.id).length
  return <div className="v4-editor-context" data-help-target="pattern-context" data-help-track-id={track?.id} data-help-clip-id={clip?.id}><strong>{track?.name ?? 'Select a track'}</strong>{pattern && clip ? <><span> / </span><label>Part<NameDraft key={`${pattern.id}:${pattern.name}`} label="Part name" value={pattern.name} disabled={disabled} onCommit={name => onAction({ type: 'pattern-rename', patternId: pattern.id, name })} /></label><span>Song bar {Number((clip.startTick / BAR + 1).toFixed(3))}</span>{uses > 1 && <span className="v4-linked-warning">Linked ×{uses} · Edits affect these copies <button type="button" disabled={disabled} data-help-target="make-independent" data-help-track-id={track?.id} data-help-clip-id={clip.id} onClick={() => onAction({ type: 'clip-independent', clipId: clip.id })}>Make independent</button></span>}</> : <span>Select a clip or create a new part to draw notes.</span>}</div>
}

type ClipDrag = { pointer: number; clipIds: string[]; startX: number; delta: number; ticksPerPixel: number; signature: string; moved: boolean; invalid: boolean }

function movementError(project: StudioProject, ids: readonly string[], delta: number): string | null {
  if (!Number.isSafeInteger(delta) || !ids.length) return 'Select a clip and enter a valid position.'
  for (const id of ids) {
    const clip = project.clips.find(item => item.id === id), pattern = project.patterns.find(item => item.id === clip?.patternId)
    if (!clip || !pattern) return 'The selected clips changed. Select them again.'
    const end = pattern.notes.reduce((last, note) => Math.max(last, note.startTick + note.durationTicks), pattern.lengthTicks)
    if (clip.startTick + delta < 0 || clip.startTick + delta + end > 256 * BAR) return 'The whole selection, including sustained notes, must stay inside bars 1–256. No clips were moved.'
  }
  return null
}

function ClipPositionInput({ clip, project, selection, onAction, disabled }: { clip: Clip; project: StudioProject; selection: string[]; onAction: WorkbenchProps['onAction']; disabled?: boolean }) {
  const original = String(clip.startTick / BAR + 1), [draft, setDraft] = useState(original), [error, setError] = useState('')
  const cancelBlur = useRef(false)
  const commit = () => {
    if (cancelBlur.current) { cancelBlur.current = false; return }
    if (disabled || draft === original) return
    const value = draft.trim()
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value) || !Number.isFinite(Number(value)) || Number(value) < 1 || Number(value) > 256) { setError('Enter a bar from 1 to 256; decimals are allowed.'); return }
    const deltaTicks = Math.round((Number(value) - 1) * BAR) - clip.startTick
    const problem = movementError(project, selection, deltaTicks)
    if (problem) { setError(problem); return }
    setError(''); if (deltaTicks) onAction({ type: 'clips-move', clipIds: selection, deltaTicks })
  }
  return <span className="v4-position-control"><label>Start at bar<input aria-label="Clip start bar" type="text" inputMode="decimal" value={draft} aria-invalid={!!error} disabled={disabled} onChange={event => { setDraft(event.target.value); setError('') }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelBlur.current = true; setDraft(original); setError(''); event.currentTarget.blur() } }} /></label>{error && <span role="alert" className="v4-position-error">{error}</span>}</span>
}

export function PatternPlaylist({ project, selectedTrackId, selectedClipId, selectedClipIds, onAction, disabled, active = true, onEditClip, playhead = 0, playing = false, onSeek }: WorkbenchProps & { playhead?: number; playing?: boolean; onSeek?: (tick: number) => void }) {
  const [snap, setSnap] = useState(BAR)
  const [clipClipboard, setClipClipboard] = useState<{ projectId: string; value: ClipClipboard } | null>(() => savedClipClipboard)
  const [dragView, setDragView] = useState<{ clipIds: string[]; delta: number; invalid: boolean } | null>(null)
  const [dragError, setDragError] = useState('')
  const drag = useRef<ClipDrag | null>(null)
  const selected = project.clips.find(clip => clip.id === selectedClipId)
  const pattern = project.patterns.find(item => item.id === selected?.patternId)
  const selection = (selectedClipIds ?? (selectedClipId ? [selectedClipId] : [])).filter(id => project.clips.some(clip => clip.id === id))
  const tracks = project.tracks.filter(track => !track.hidden)
  const signature = JSON.stringify(project)
  const latest = useRef({ signature, disabled })
  useLayoutEffect(() => { latest.current = { signature, disabled } }, [signature, disabled])
  const copy = () => { if (selection.length) setClipClipboard(storeClipClipboard(project, selection)) }
  const paste = () => { if (clipClipboard?.projectId === project.id && !disabled) onAction({ type: 'clips-paste', clipboard: structuredClone(clipClipboard.value), startTick: selected && pattern ? selected.startTick + pattern.lengthTicks : 0 }) }
  const cancel = () => { drag.current = null; setDragView(null) }
  // Hiding a surface is an external cancellation boundary, never a musical commit.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!active) { drag.current = null; setDragView(null) } }, [active])
  useEffect(() => {
    const abandon = () => { drag.current = null; setDragView(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); abandon() } }
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', abandon)
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', abandon) }
  }, [])
  const pointerStart = (event: PointerEvent<HTMLButtonElement>, clip: Clip) => {
    if (disabled || event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
    const ids = event.shiftKey ? selection.includes(clip.id) ? selection.filter(id => id !== clip.id) : [...selection, clip.id] : selection.includes(clip.id) ? selection : [clip.id]
    onAction({ type: 'clips-select', clipIds: ids, primary: ids.includes(clip.id) ? clip.id : ids[0] ?? '' })
    setDragError('')
    if (!ids.includes(clip.id)) return
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
    if (!width) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, clipIds: ids, startX: event.clientX, delta: 0, ticksPerPixel: project.bars * BAR / width, signature, moved: false, invalid: false }
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    if (latest.current.disabled || latest.current.signature !== current.signature) { cancel(); return }
    const delta = (event.clientX - current.startX) * current.ticksPerPixel
    current.moved ||= Math.abs(event.clientX - current.startX) > 3
    current.delta = snap ? Math.round(delta / snap) * snap : Math.round(delta)
    current.invalid = movementError(project, current.clipIds, current.delta) !== null
    if (current.moved) setDragView({ clipIds: current.clipIds, delta: current.delta, invalid: current.invalid })
  }
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    cancel()
    if (latest.current.disabled || latest.current.signature !== current.signature) return
    if (current.invalid) { setDragError(movementError(project, current.clipIds, current.delta) ?? 'This move is invalid.'); return }
    if (current.moved && current.delta !== 0) onAction({ type: 'clips-move', clipIds: current.clipIds, deltaTicks: current.delta })
  }
  return <div className="v4-playlist" data-help-target="pattern-playlist" onKeyDown={event => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]')) return
    if (event.key === 'Escape') { cancel(); return }
    if (disabled) return
    if ((event.ctrlKey || event.metaKey) && ['c', 'v'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); if (event.key.toLowerCase() === 'c') copy(); else paste() }
    else if (selection.length && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onAction({ type: 'clips-delete', clipIds: selection }) }
    else if (selection.length && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onAction({ type: 'clips-move', clipIds: selection, deltaTicks: (event.key === 'ArrowLeft' ? -1 : 1) * (snap || 1) }) }
  }}>
    <div className="v4-playlist-heading"><h1 id="arrangement-title">Playlist</h1><span>{project.tracks.length} tracks · {project.bars} bars</span><label>Snap<select aria-label="Clip snap" value={snap} onChange={event => { cancel(); setSnap(Number(event.target.value)) }}><option value={BAR}>Bar</option><option value={480}>Beat</option><option value={0}>Off</option></select></label><button type="button" disabled={disabled || !selectedTrackId} onClick={() => selectedTrackId && onAction({ type: 'pattern-create', trackId: selectedTrackId, startTick: selected && pattern ? selected.startTick + pattern.lengthTicks : 0 })}>+ New part</button></div>
    <div className="v4-clip-actions" data-help-track-id={selected?.trackId} data-help-clip-id={selected?.id}><span>{selection.length} clips selected · Shift-click to add</span><button type="button" disabled={disabled || !selection.length} data-help-target="duplicate-independent" data-help-track-id={selected?.trackId} data-help-clip-id={selected?.id} onClick={() => onAction({ type: 'clips-duplicate', clipIds: selection })}>Duplicate independently</button><button type="button" disabled={disabled || !selected || selection.length !== 1} data-help-target="repeat-linked" data-help-track-id={selected?.trackId} data-help-clip-id={selected?.id} onClick={() => selected && onAction({ type: 'clip-duplicate', clipId: selected.id, linked: true })}>Repeat linked</button><button type="button" disabled={!selection.length} onClick={copy}>Copy part</button><button type="button" disabled={disabled || clipClipboard?.projectId !== project.id} onClick={paste}>Paste independent</button><button type="button" data-help-target="delete-clip" data-help-track-id={selected?.trackId} data-help-clip-id={selected?.id} disabled={disabled || !selection.length} onClick={() => onAction({ type: 'clips-delete', clipIds: selection })}>Delete clip</button>{selected && <ClipPositionInput key={`${selected.id}:${selected.startTick}`} clip={selected} project={project} selection={selection} disabled={disabled} onAction={onAction} />}</div>
    {dragError && <p role="alert" className="v4-position-error">{dragError}</p>}
    <div className="v4-arrangement-scroll"><div className="v4-arrangement-inner" style={{ minWidth: Math.max(500, project.bars * 66 + 130) }}><div className="v4-ruler"><span>TRACK</span><div>{Array.from({ length: project.bars }, (_, bar) => <button type="button" key={bar} aria-label={`Seek to bar ${bar + 1}`} disabled={disabled || !onSeek} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); const fraction = event.detail === 0 ? 0 : Math.max(0, Math.min(.999999, (event.clientX - rect.left) / rect.width)); const raw = bar * BAR + fraction * BAR; const tick = snap ? Math.floor(raw / snap) * snap : Math.round(raw); onSeek?.(Math.min(project.bars * BAR - 1, tick)) }}>{bar + 1}</button>)}</div></div>{tracks.map(track => {
      const stacked = stackClips(project.clips.filter(clip => clip.trackId === track.id), project.patterns)
      const rows = Math.max(1, ...stacked.map(item => item.row + 1))
      return <div className="v4-lane" key={track.id} style={{ '--track-color': track.color } as CSSProperties}><button type="button" className="v4-lane-label" title={track.name} disabled={disabled} aria-pressed={track.id === selectedTrackId} onClick={() => onAction({ type: 'track-select', trackId: track.id })}><span>{track.name}</span><small>{track.muted ? 'Muted' : SOUND_CHOICES.find(sound => sound.id === track.soundId)?.name}</small></button><div className="v4-clip-area" style={{ height: rows * 30 + 8, '--song-bars': project.bars } as CSSProperties}>{stacked.map(({ clip, row, length }) => { const part = project.patterns.find(item => item.id === clip.patternId); const previewed = dragView?.clipIds.includes(clip.id); const start = clip.startTick + (previewed ? dragView!.delta : 0); const uses = project.clips.filter(item => item.patternId === clip.patternId).length; return <button type="button" key={clip.id} className={`v4-clip${previewed && dragView?.invalid ? ' v4-clip-invalid' : ''}`} data-clip-id={clip.id} aria-label={`${part?.name ?? 'Part'}, ${track.name}, bar ${Number((start / BAR + 1).toFixed(3))}`} aria-pressed={selection.includes(clip.id)} disabled={disabled} style={{ left: `${start / (project.bars * BAR) * 100}%`, width: `${length / (project.bars * BAR) * 100}%`, top: row * 30 + 4 }} onPointerDown={event => pointerStart(event, clip)} onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onDoubleClick={() => { onAction({ type: 'clip-select', clipId: clip.id }); onEditClip?.(clip.id) }} onClick={event => { if (event.detail === 0) { const ids = event.shiftKey ? selection.includes(clip.id) ? selection.filter(id => id !== clip.id) : [...selection, clip.id] : [clip.id]; onAction({ type: 'clips-select', clipIds: ids, primary: ids.includes(clip.id) ? clip.id : ids[0] ?? '' }) } }}><span>{part?.name}</span><small>{uses > 1 ? `Linked ×${uses}` : `${part?.notes.length ?? 0} notes`}</small></button> })}{(playing || playhead > 0) && <i className="v4-playhead" style={{ left: `${playhead / (project.bars * BAR) * 100}%` }} />}</div></div>
    })}</div></div>
    <details className="v4-pattern-list"><summary>Reusable parts ({project.patterns.length}){project.tracks.some(track => track.hidden) ? ' · hidden tracks available' : ''}</summary><p>A part contains notes; a clip places it in your song. Placing a saved part links it. Duplicate creates a separate copy.</p>{project.patterns.filter(part => part.trackId === selectedTrackId).map(part => <div key={part.id}><span>{part.name} · {part.notes.length} notes</span><button type="button" disabled={disabled} onClick={() => onAction({ type: 'clip-place', patternId: part.id, startTick: selected && pattern ? selected.startTick + pattern.lengthTicks : 0 })}>Place linked</button></div>)}{project.tracks.filter(track => track.hidden).map(track => <button type="button" key={track.id} disabled={disabled} onClick={() => onAction({ type: 'track-update', trackId: track.id, patch: { hidden: false } })}>Show {track.name}</button>)}</details>
  </div>
}

export interface TrackMixerOptions {
  onPreviewLevel?: (trackId: string, level: number) => void
  onPreviewProduction?: (trackId: string, patch: Partial<TrackProduction>) => void
  soloTracks?: readonly string[]
  onSolo?: (trackId: string) => void
  meters?: StudioMeters
}

function LevelMeter({ name, value = 0 }: { name: string; value?: number }) {
  const peak = Number.isFinite(value) ? Math.max(0, value) : 0
  const db = peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : 'Silent'
  return <meter className="v4-level-meter" min={0} max={1} high={.9} optimum={.6} value={Math.min(1, peak)} aria-label={`${name} signal level`} title={db} />
}

export function TrackMixer({ project, selectedTrackId, onAction, disabled, active = true, onPreviewLevel, onPreviewProduction, soloTracks = [], onSolo, meters }: WorkbenchProps & TrackMixerOptions) {
  const [draft, setDraft] = useState<{ trackId: string; level: number } | null>(null)
  const gesture = useRef<{ trackId: string; level: number; signature: string } | null>(null)
  const signature = JSON.stringify(project.tracks)
  const cancel = () => { const current = gesture.current; gesture.current = null; setDraft(null); const track = project.tracks.find(item => item.id === current?.trackId); if (track) onPreviewLevel?.(track.id, track.level) }
  useEffect(() => {
    // Restore the audio preview when presentation hides or locks this surface.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!active || disabled) cancel()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  // Preview callbacks change each render; only gesture visibility changes cancel it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabled])
  useEffect(() => {
    // A project change during a held slider gesture invalidates its draft audio.
    if (gesture.current && gesture.current.signature !== signature) cancel()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  const commit = () => { const current = gesture.current; if (!current) return; if (current.signature !== signature || disabled) { cancel(); return } gesture.current = null; setDraft(null); const track = project.tracks.find(item => item.id === current.trackId); if (track && track.level !== current.level) onAction({ type: 'track-update', trackId: track.id, patch: { level: current.level } }) }
  return <section id="studio-mixer" className="v4-mixer" aria-label="Track sounds and volume" data-help-target="track-mixer">
    <div className="v4-mixer-heading"><strong>Mixer</strong><span>Solo is for listening; exports use saved Mute and volume.</span><span className="v4-master-level">Master <LevelMeter name="Master" value={meters?.master} /><strong className={meters?.clipping ? 'v4-clipping-warning' : 'v4-level-ok'} aria-label={meters?.clipping ? 'Master is clipping. Lower track volumes.' : 'Master not clipping'}>{meters?.clipping ? 'CLIP — lower volumes' : 'No clipping'}</strong></span></div>
    <div className="v4-mixer-inner">{project.tracks.map(track => <div className="v4-mixer-channel" key={track.id} data-help-track-id={track.id} style={{ '--track-color': track.color } as CSSProperties}><div className="v4-mixer-strip">
      <button type="button" aria-pressed={selectedTrackId === track.id} disabled={disabled} onClick={() => onAction({ type: 'track-select', trackId: track.id })}>{track.name}</button>
      <label><span className="sr-only">{track.name} volume</span><input type="range" aria-label={`${track.name} volume`} min="0" max="100" value={draft?.trackId === track.id ? draft.level : track.level} disabled={disabled} onChange={event => { const level = Number(event.target.value); gesture.current = { trackId: track.id, level, signature }; setDraft({ trackId: track.id, level }); onPreviewLevel?.(track.id, level) }} onPointerUp={commit} onPointerCancel={cancel} onBlur={commit} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit() }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }} /></label>
      <output>{draft?.trackId === track.id ? draft.level : track.level}%</output>
      <button type="button" aria-label={`Mute ${track.name}`} aria-pressed={track.muted} disabled={disabled} onClick={() => { cancel(); onAction({ type: 'track-update', trackId: track.id, patch: { muted: !track.muted } }) }}>Mute</button>
      <button type="button" aria-label={`Solo ${track.name}`} aria-pressed={soloTracks.includes(track.id)} disabled={disabled || !onSolo} onClick={() => { cancel(); onSolo?.(track.id) }}>Solo</button>
      <LevelMeter name={track.name} value={meters?.tracks[track.id]} />
    </div><ProductionControls track={track} bars={project.bars} active={active} disabled={disabled} onCommit={patch => { cancel(); onAction({ type: 'track-production', trackId: track.id, patch }) }} onPreview={patch => onPreviewProduction?.(track.id, patch)} /></div>)}</div>
  </section>
}
