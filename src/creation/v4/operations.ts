import { pruneNotation } from './notationCommands'
import { assertStudioProject, defaultTrackProduction, isSoundId, makeStudioId, MAX_BARS, MAX_TRACKS, MAX_NOTES, MAX_PROJECT_BYTES, SOUND_LABELS, TICKS_PER_BAR, type Pattern, type PatternNote, type SoundId, type StudioProject, type TrackProduction } from './model'
import { MAX_IDEAS, MAX_IDEA_EVENTS, MAX_TOTAL_AUDIO_BYTES } from '../ideas'

const clone = <T,>(value: T): T => structuredClone(value)
function cloneNotes(project: StudioProject, notes: PatternNote[]): PatternNote[] { return notes.map(note => { const id = makeStudioId(); if (project.notation?.notes[note.id]) project.notation.notes[id] = clone(project.notation.notes[note.id]); return { ...note, id } }) }
function begin(project: StudioProject): StudioProject { assertStudioProject(project); return clone(project) }
function finish(project: StudioProject): StudioProject {
  let end = project.bars * TICKS_PER_BAR
  const tails = new Map<string, number>()
  for (const pattern of project.patterns) {
    const tail = pattern.notes.reduce((max, note) => Math.max(max, note.startTick + note.durationTicks), pattern.lengthTicks)
    end = Math.max(end, tail)
    tails.set(pattern.id, tail)
  }
  for (const clip of project.clips) end = Math.max(end, clip.startTick + (tails.get(clip.patternId) ?? 0))
  project.bars = Math.ceil(end / TICKS_PER_BAR)
  if (project.bars > MAX_BARS) throw new RangeError(`This change would exceed the ${MAX_BARS}-bar project limit. No change was made.`)
  pruneNotation(project)
  assertStudioProject(project)
  return project
}
function clipIn(project: StudioProject, id: string) {
  const clip = project.clips.find(item => item.id === id)
  if (!clip) throw new RangeError('Choose an existing clip. No change was made.')
  return clip
}
function checkTick(tick: number) { if (!Number.isSafeInteger(tick) || tick < 0 || tick >= MAX_BARS * TICKS_PER_BAR) throw new RangeError('Choose a position inside the song limit. No change was made.') }

export function addTrack(project: StudioProject, soundId: SoundId): StudioProject {
  const next = begin(project)
  if (!isSoundId(soundId)) throw new TypeError('Choose a supported instrument.')
  if (next.tracks.length >= MAX_TRACKS) throw new RangeError('This studio supports up to 16 tracks.')
  const id = makeStudioId(), baseName = SOUND_LABELS[soundId]
  let name = baseName, suffix = 2
  while (next.tracks.some(track => track.name === name)) name = `${baseName} ${suffix++}`
  next.tracks.push({ id, name, color: ['#56b89a', '#d2a45c', '#809dd2', '#cb8277', '#a194cc'][next.tracks.length % 5], soundId, soundVersion: 1, level: 100, muted: false, hidden: false, ...defaultTrackProduction() })
  return addPattern(finish(next), id)
}

/** Production gestures commit atomically; validation rejects rather than clamps or sorts. */
export function updateTrackProduction(project: StudioProject, trackId: string, patch: Partial<TrackProduction>): StudioProject {
  const next = begin(project), track = next.tracks.find(item => item.id === trackId)
  if (!track) throw new RangeError('Choose an existing track. No change was made.')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['pan', 'space', 'spaceBypass', 'expression'].includes(key))) {
    throw new TypeError('Choose supported production settings. No change was made.')
  }
  Object.assign(track, clone(patch))
  assertStudioProject(next)
  return next
}

/** Adds a fresh empty part and its first placement. Existing patterns are untouched. */
export function addPattern(project: StudioProject, trackId: string, startTick = 0, lengthTicks = 4 * TICKS_PER_BAR): StudioProject {
  const next = begin(project), track = next.tracks.find(item => item.id === trackId)
  if (!track) throw new RangeError('Choose an existing track.')
  checkTick(startTick)
  if (!Number.isSafeInteger(lengthTicks) || lengthTicks < 1 || lengthTicks > MAX_BARS * TICKS_PER_BAR) throw new RangeError('Choose a valid part length.')
  const id = makeStudioId()
  next.patterns.push({ id, trackId, name: `${track.name.slice(0, 95)} part ${next.patterns.filter(item => item.trackId === trackId).length + 1}`, lengthTicks, notes: [] })
  next.clips.push({ id: makeStudioId(), trackId, patternId: id, startTick })
  return finish(next)
}

export function duplicateClip(project: StudioProject, clipId: string, linked = false, startTick?: number): StudioProject {
  assertStudioProject(project)
  const source = clipIn(project, clipId), pattern = project.patterns.find(item => item.id === source.patternId)!
  const position = startTick ?? source.startTick + pattern.lengthTicks
  return placePattern(project, pattern.id, position, linked)
}

/** Reusable library parts remain placeable even after their last occurrence was removed. */
export function placePattern(project: StudioProject, sourcePatternId: string, startTick: number, linked = false): StudioProject {
  const next = begin(project), pattern = next.patterns.find(item => item.id === sourcePatternId)
  if (!pattern) throw new RangeError('Choose an existing part.')
  checkTick(startTick)
  let patternId = pattern.id
  if (!linked) {
    patternId = makeStudioId()
    next.patterns.push({ ...clone(pattern), id: patternId, name: `${pattern.name.slice(0, 115)} copy`, notes: cloneNotes(next, pattern.notes) })
  }
  next.clips.push({ id: makeStudioId(), trackId: pattern.trackId, patternId, startTick })
  return finish(next)
}

/** Clipboard snapshots never retain ownership/IDs from their source project or track. */
export function pastePattern(project: StudioProject, trackId: string, snapshot: Pattern, startTick: number): StudioProject {
  const next = begin(project)
  if (!next.tracks.some(track => track.id === trackId)) throw new RangeError('Choose an existing destination track.')
  checkTick(startTick)
  // Validate the snapshot before replacing its identity, including unknown fields and malformed notes.
  const probe: StudioProject = {
    ...createClipboardProbe(next, snapshot),
    patterns: [clone(snapshot)], clips: [],
  }
  assertStudioProject(pruneNotation(probe))
  const id = makeStudioId()
  next.patterns.push({ ...clone(snapshot), id, trackId, notes: cloneNotes(next, snapshot.notes) })
  next.clips.push({ id: makeStudioId(), trackId, patternId: id, startTick })
  return finish(next)
}

function createClipboardProbe(project: StudioProject, snapshot: Pattern): StudioProject {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('The copied part is invalid.')
  const track = project.tracks[0]
  return {
    ...clone(project), bars: MAX_BARS, ideas: [], patterns: [], clips: [],
    tracks: [{ ...track, id: snapshot.trackId }],
  }
}

export function makeIndependent(project: StudioProject, clipId: string): StudioProject {
  const next = begin(project), clip = clipIn(next, clipId), pattern = next.patterns.find(item => item.id === clip.patternId)!
  const id = makeStudioId()
  next.patterns.push({ ...clone(pattern), id, name: `${pattern.name.slice(0, 115)} copy`, notes: cloneNotes(next, pattern.notes) })
  clip.patternId = id
  return finish(next)
}

export function moveClip(project: StudioProject, clipId: string, startTick: number): StudioProject {
  const next = begin(project)
  checkTick(startTick); clipIn(next, clipId).startTick = startTick
  return finish(next)
}
export function deleteClip(project: StudioProject, clipId: string): StudioProject {
  const next = begin(project); clipIn(next, clipId)
  next.clips = next.clips.filter(item => item.id !== clipId)
  return finish(next)
}
export function deleteTrack(project: StudioProject, trackId: string): StudioProject {
  const next = begin(project)
  if (!next.tracks.some(item => item.id === trackId)) throw new RangeError('Choose an existing track.')
  next.tracks = next.tracks.filter(item => item.id !== trackId)
  next.patterns = next.patterns.filter(item => item.trackId !== trackId)
  next.clips = next.clips.filter(item => item.trackId !== trackId)
  return finish(next)
}
export function updatePatternNotes(project: StudioProject, patternId: string, notes: PatternNote[], lengthTicks?: number): StudioProject {
  const next = begin(project), pattern = next.patterns.find(item => item.id === patternId)
  if (!pattern) throw new RangeError('Choose an existing part.')
  pattern.notes = clone(notes)
  if (lengthTicks !== undefined) pattern.lengthTicks = lengthTicks
  else pattern.lengthTicks = Math.max(pattern.lengthTicks, Math.ceil(notes.reduce((max, note) => Math.max(max, note.startTick + 1), 1) / TICKS_PER_BAR) * TICKS_PER_BAR)
  return finish(next)
}

function selectedClips(project: StudioProject, ids: readonly string[]) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new RangeError('Select distinct existing clips. No change was made.')
  return ids.map(id => clipIn(project, id))
}

/** One immutable transaction; no partial movement if any member exceeds a limit. */
export function moveClips(project: StudioProject, ids: readonly string[], deltaTicks: number): StudioProject {
  const next = begin(project)
  if (!Number.isSafeInteger(deltaTicks)) throw new RangeError('Choose an exact movement amount.')
  for (const clip of selectedClips(next, ids)) { checkTick(clip.startTick + deltaTicks); clip.startTick += deltaTicks }
  return finish(next)
}

export function deleteClips(project: StudioProject, ids: readonly string[]): StudioProject {
  const next = begin(project); selectedClips(next, ids)
  const selected = new Set(ids)
  next.clips = next.clips.filter(clip => !selected.has(clip.id))
  return finish(next)
}

export interface ClipClipboard { entries: { trackId: string; offsetTick: number; pattern: Pattern }[] }
export function createClipClipboard(project: StudioProject, ids: readonly string[]): ClipClipboard {
  assertStudioProject(project)
  const clips = selectedClips(project, ids), first = Math.min(...clips.map(clip => clip.startTick))
  return { entries: clips.map(clip => ({ trackId: clip.trackId, offsetTick: clip.startTick - first, pattern: clone(project.patterns.find(pattern => pattern.id === clip.patternId)!) })) }
}

/** Each pasted occurrence is independent, even if the source selection was linked. */
export function pasteClips(project: StudioProject, clipboard: ClipClipboard, startTick: number, trackMap: Record<string, string> = {}): StudioProject {
  const next = begin(project); checkTick(startTick)
  if (!clipboard || !Array.isArray(clipboard.entries) || !clipboard.entries.length || clipboard.entries.length > MAX_NOTES) throw new TypeError('The copied section is invalid.')
  if (next.patterns.length + clipboard.entries.length > MAX_NOTES || next.clips.length + clipboard.entries.length > MAX_NOTES) throw new RangeError('This section exceeds the part or clip limit.')
  let stored = next.patterns.reduce((total, part) => total + part.notes.length, 0)
  const counts = new Map(next.patterns.map(part => [part.id, part.notes.length]))
  let expanded = next.clips.reduce((total, clip) => total + counts.get(clip.patternId)!, 0)
  for (const entry of clipboard.entries) {
    if (!entry || typeof entry.trackId !== 'string' || !Number.isSafeInteger(entry.offsetTick) || entry.offsetTick < 0) throw new TypeError('The copied section is invalid.')
    if (!entry.pattern || !Array.isArray(entry.pattern.notes)) throw new TypeError('The copied part is invalid.')
    stored += entry.pattern.notes.length; expanded += entry.pattern.notes.length
    if (stored > MAX_NOTES || expanded > MAX_NOTES) throw new RangeError('This section exceeds the stored or playable note limit. No change was made.')
    const trackId = Object.hasOwn(trackMap, entry.trackId) ? trackMap[entry.trackId] : entry.trackId
    if (!next.tracks.some(track => track.id === trackId)) throw new RangeError('Choose an existing destination for every copied track.')
    assertStudioProject(pruneNotation({ ...createClipboardProbe(next, entry.pattern), patterns: [clone(entry.pattern)], clips: [] }))
    const position = startTick + entry.offsetTick; checkTick(position)
    const id = makeStudioId()
    next.patterns.push({ ...clone(entry.pattern), id, trackId, notes: cloneNotes(next, entry.pattern.notes) })
    next.clips.push({ id: makeStudioId(), trackId, patternId: id, startTick: position })
  }
  return finish(next)
}

export function duplicateClips(project: StudioProject, ids: readonly string[], deltaTicks?: number, linked = false): StudioProject {
  const next = begin(project), sources = selectedClips(next, ids)
  const first = Math.min(...sources.map(clip => clip.startTick))
  const end = Math.max(...sources.map(clip => clip.startTick + next.patterns.find(part => part.id === clip.patternId)!.lengthTicks))
  const delta = deltaTicks ?? end - first
  if (!Number.isSafeInteger(delta)) throw new RangeError('Choose an exact repetition position.')
  if (!linked) return pasteClips(project, createClipClipboard(project, ids), first + delta)
  for (const clip of sources) { const position = clip.startTick + delta; checkTick(position); next.clips.push({ ...clip, id: makeStudioId(), startTick: position }) }
  return finish(next)
}

export function removeUnusedPatterns(project: StudioProject, patternIds?: readonly string[]): StudioProject {
  const next = begin(project), used = new Set(next.clips.map(clip => clip.patternId))
  const ids = patternIds ?? next.patterns.filter(pattern => !used.has(pattern.id)).map(pattern => pattern.id)
  if (new Set(ids).size !== ids.length || ids.some(id => used.has(id) || !next.patterns.some(pattern => pattern.id === id))) throw new RangeError('Only existing, unused parts can be removed. No change was made.')
  const selected = new Set(ids); next.patterns = next.patterns.filter(pattern => !selected.has(pattern.id))
  return finish(next)
}

/** Capacity includes library data, originals and saved expression, not just audible placements. */
export function fitProjectLength(project: StudioProject): StudioProject {
  const next = begin(project)
  const extents = new Map(next.patterns.map(pattern => [pattern.id, pattern.notes.reduce((end, note) => Math.max(end, note.startTick + note.durationTicks), pattern.lengthTicks)]))
  let end = TICKS_PER_BAR
  for (const extent of extents.values()) end = Math.max(end, extent)
  for (const clip of next.clips) end = Math.max(end, clip.startTick + extents.get(clip.patternId)!)
  for (const idea of next.ideas) end = Math.max(end, idea.attachedTick ?? 0)
  for (const track of next.tracks) for (const point of track.expression) end = Math.max(end, point.tick)
  next.bars = Math.ceil(end / TICKS_PER_BAR); assertStudioProject(next)
  return next
}

export function projectCapacity(project: StudioProject) {
  assertStudioProject(project)
  const used = new Set(project.clips.map(clip => clip.patternId)), counts = new Map(project.patterns.map(pattern => [pattern.id, pattern.notes.length]))
  return {
    tracks: project.tracks.length, trackLimit: MAX_TRACKS,
    storedNotes: project.patterns.reduce((total, part) => total + part.notes.length, 0),
    expandedNotes: project.clips.reduce((total, clip) => total + counts.get(clip.patternId)!, 0), noteLimit: MAX_NOTES,
    unusedPatterns: project.patterns.filter(pattern => !used.has(pattern.id)).map(pattern => ({ id: pattern.id, name: pattern.name, notes: pattern.notes.length })),
    projectBytes: new TextEncoder().encode(JSON.stringify(project)).byteLength, byteLimit: MAX_PROJECT_BYTES,
    bars: project.bars, barLimit: MAX_BARS,
    originals: project.ideas.length, originalLimit: MAX_IDEAS,
    originalEvents: project.ideas.reduce((total, idea) => total + (idea.original.kind === 'midi' ? idea.original.events.length : 0), 0), originalEventLimit: MAX_IDEA_EVENTS,
    originalAudioBytes: project.ideas.reduce((total, idea) => total + (idea.original.kind === 'audio' ? idea.original.byteLength : 0), 0), originalAudioByteLimit: MAX_TOTAL_AUDIO_BYTES,
  }
}
