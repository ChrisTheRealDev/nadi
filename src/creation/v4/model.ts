import { createProject, decodeProject, MAX_BARS, MAX_NOTES, MAX_PROJECT_BYTES, TICKS_PER_BAR, type CreationProject, type Instrument, type Note } from '../model'
import { validateIdeas, type Idea } from '../ideas'
import { validateNotationState, type NotationState } from './notationModel'

export { MAX_BARS, MAX_NOTES, MAX_PROJECT_BYTES, TICKS_PER_BAR }
export const MAX_TRACKS = 16
export const MAX_MELODIC_TRACKS = 15
export const SOUND_IDS = ['piano', 'kick', 'snare', 'hat', 'electric-piano', 'synth-bass', 'strings', 'soft-pad', 'plucked-guitar', 'french-horn', 'trumpet', 'oboe', 'ancient-reed', 'vocal-air', 'bronze-resonance', 'violin', 'viola', 'cello', 'double-bass', 'flute', 'clarinet', 'bassoon', 'trombone', 'tuba', 'harp', 'timpani'] as const
export type SoundId = typeof SOUND_IDS[number]
export const SOUND_LABELS: Record<SoundId, string> = {
  piano: 'Piano', kick: 'Kick', snare: 'Snare', hat: 'Hi-hat', 'electric-piano': 'Electric Piano',
  'synth-bass': 'Synth Bass', strings: 'Strings', 'soft-pad': 'Soft Pad', 'plucked-guitar': 'Plucked Guitar',
  'french-horn': 'French Horn', trumpet: 'Trumpet',
  oboe: 'Oboe', 'ancient-reed': 'Ancient Reed — approximation', 'vocal-air': 'Vocal Air — synthetic', 'bronze-resonance': 'Bronze Resonance — synthetic',
  violin: 'Violin', viola: 'Viola section', cello: 'Cello section', 'double-bass': 'Double Bass', flute: 'Flute', clarinet: 'Clarinet', bassoon: 'Bassoon', trombone: 'Trombone', tuba: 'Tuba', harp: 'Harp', timpani: 'Timpani',
}
export const MAX_EXPRESSION_POINTS = 2048
export interface ExpressionPoint { tick: number; value: number }
export interface TrackProduction { pan: number; space: number; spaceBypass: boolean; expression: ExpressionPoint[] }
export function defaultTrackProduction(): TrackProduction { return { pan: 0, space: 0, spaceBypass: false, expression: [] } }
export interface Track extends TrackProduction { id: string; name: string; color: string; soundId: SoundId; soundVersion: 1; level: number; muted: boolean; hidden: boolean }
export interface PatternNote { id: string; pitch: number; startTick: number; durationTicks: number; velocity: number }
export interface Pattern { id: string; trackId: string; name: string; lengthTicks: number; notes: PatternNote[] }
export interface Clip { id: string; trackId: string; patternId: string; startTick: number }
export interface StudioProject {
  format: 'nadi-creation'; version: 5 | 6; id: string; revision: number; name: string; bpm: number; bars: number
  tracks: Track[]; patterns: Pattern[]; clips: Clip[]; ideas: Idea[]; guidance: CreationProject['guidance']
  notation?: NotationState
}
export type StudioProjectV4 = Omit<StudioProject, 'version' | 'tracks'> & { version: 4; tracks: Omit<Track, keyof TrackProduction>[] }
export interface CompiledNote extends Note { trackId: string; soundId: SoundId; clipId: string; patternId: string; sourceNoteId: string }

export function isSoundId(value: unknown): value is SoundId { return typeof value === 'string' && (SOUND_IDS as readonly string[]).includes(value) }
export function isMelodicSound(soundId: SoundId): boolean { return !(['kick', 'snare', 'hat'] as string[]).includes(soundId) }
export function editorInstrument(soundId: SoundId): Instrument { return isMelodicSound(soundId) ? 'piano' : soundId as Instrument }
export function makeStudioId(): string { return globalThis.crypto?.randomUUID?.() ?? `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }

export function createStudioProject(): StudioProject {
  const legacy = createProject()
  const trackId = makeStudioId(), patternId = makeStudioId()
  return {
    format: legacy.format, version: 5, id: legacy.id, revision: 0, name: legacy.name, bpm: legacy.bpm, bars: 4,
    tracks: [{ id: trackId, name: 'Piano', color: '#56b89a', soundId: 'piano', soundVersion: 1, level: 100, muted: false, hidden: false, ...defaultTrackProduction() }],
    patterns: [{ id: patternId, trackId, name: 'Piano part 1', lengthTicks: 4 * TICKS_PER_BAR, notes: [] }],
    clips: [{ id: makeStudioId(), trackId, patternId, startTick: 0 }], ideas: [], guidance: legacy.guidance,
  }
}

/** Decode at trust boundaries. Legacy objects are cloned, never durably upgraded here. */
export function decodeStudioProject(value: unknown): StudioProject {
  if (validateStudioProject(value)) return structuredClone(value)
  if (validateStudioProjectV4(value)) {
    const old = structuredClone(value)
    const upgraded: StudioProject = { ...old, version: 5, tracks: old.tracks.map(track => ({ ...track, ...defaultTrackProduction() })) }
    assertStudioProject(upgraded)
    return upgraded
  }
  const legacy = decodeProject(value)
  const sounds: Instrument[] = ['piano', 'kick', 'snare', 'hat']
  const tracks: Track[] = sounds.map((soundId, index) => ({
    id: `legacy-track-${soundId}`, name: SOUND_LABELS[soundId], color: ['#56b89a', '#d2a45c', '#cb8277', '#809dd2'][index],
    soundId, soundVersion: 1, level: legacy.mix[soundId].level, muted: legacy.mix[soundId].muted, hidden: false, ...defaultTrackProduction(),
  }))
  const patterns: Pattern[] = tracks.map(track => ({
    id: `legacy-pattern-${track.soundId}`, trackId: track.id, name: `${track.name} part 1`, lengthTicks: legacy.bars * TICKS_PER_BAR,
    notes: legacy.notes.filter(note => note.instrument === track.soundId).map(({ id, pitch, startTick, durationTicks, velocity }) => ({ id, pitch, startTick, durationTicks, velocity })),
  }))
  const project: StudioProject = {
    format: legacy.format, version: 5, id: legacy.id, revision: legacy.revision, name: legacy.name, bpm: legacy.bpm, bars: legacy.bars,
    tracks, patterns, clips: patterns.map(pattern => ({ id: `legacy-clip-${pattern.trackId}`, trackId: pattern.trackId, patternId: pattern.id, startTick: 0 })),
    ideas: structuredClone(legacy.ideas), guidance: structuredClone(legacy.guidance),
  }
  assertStudioProject(project)
  return project
}

export function assertStudioProject(value: unknown): asserts value is StudioProject {
  if (!validateStudioProject(value)) throw new TypeError('The studio project is invalid, unsupported, or exceeds its track, note, bar or size limits. No change was made.')
}

export function validateStudioProject(value: unknown): value is StudioProject {
  return validateGraph(value, 5) || validateGraph(value, 6)
}

/** v4 remains strict: production fields cannot be smuggled into an old format. */
export function validateStudioProjectV4(value: unknown): value is StudioProjectV4 {
  return validateGraph(value, 4)
}

export function validateTrackProduction(value: TrackProduction, endTick: number): boolean {
  if (!finite(value.pan, -1, 1) || !finite(value.space, 0, 1) || typeof value.spaceBypass !== 'boolean'
    || !Array.isArray(value.expression) || value.expression.length > MAX_EXPRESSION_POINTS) return false
  let previous = -1
  for (const point of value.expression) {
    if (!record(point) || !exact(point, ['tick', 'value']) || !integer(point.tick, 0, endTick) || point.tick <= previous || !finite(point.value, 0, 1)) return false
    previous = point.tick
  }
  return true
}

function validateGraph(value: unknown, version: 4 | 5 | 6): boolean {
  if (!record(value) || !exact(value, ['format', 'version', 'id', 'revision', 'name', 'bpm', 'bars', 'tracks', 'patterns', 'clips', 'ideas', 'guidance', ...(version === 6 ? ['notation'] : [])])) return false
  if (value.format !== 'nadi-creation' || value.version !== version || !label(value.id) || !label(value.name) || !integer(value.revision, 0, Number.MAX_SAFE_INTEGER)
    || !finite(value.bpm, 30, 300) || !integer(value.bars, 1, MAX_BARS)) return false
  const end = value.bars * TICKS_PER_BAR
  if (!record(value.guidance) || !exact(value.guidance, ['open', 'step', 'experience']) || typeof value.guidance.open !== 'boolean'
    || !integer(value.guidance.step, 0, 10_000) || typeof value.guidance.experience !== 'string' || !['new', 'player', 'producer'].includes(value.guidance.experience) || !validateIdeas(value.ideas, end)) return false
  if (!Array.isArray(value.tracks) || value.tracks.length > MAX_TRACKS || !Array.isArray(value.patterns) || !Array.isArray(value.clips)) return false
  // Empty parts/clips consume space too; bound traversals before processing them.
  if (value.patterns.length > MAX_NOTES || value.clips.length > MAX_NOTES) return false
  const tracks = new Map<string, Track>(), patterns = new Map<string, Pattern>(), noteIds = new Set<string>(), clipIds = new Set<string>()
  let melodic = 0, stored = 0, expanded = 0
  for (const track of value.tracks) {
    const trackKeys = ['id', 'name', 'color', 'soundId', 'soundVersion', 'level', 'muted', 'hidden', ...(version >= 5 ? ['pan', 'space', 'spaceBypass', 'expression'] : [])]
    if (!record(track) || !exact(track, trackKeys) || !label(track.id) || tracks.has(track.id)
      || !label(track.name) || typeof track.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(track.color) || !isSoundId(track.soundId) || track.soundVersion !== 1
      || !integer(track.level, 0, 100) || typeof track.muted !== 'boolean' || typeof track.hidden !== 'boolean') return false
    if (version >= 5 && !validateTrackProduction(track as unknown as TrackProduction, end)) return false
    if (isMelodicSound(track.soundId) && ++melodic > MAX_MELODIC_TRACKS) return false
    tracks.set(track.id, track as unknown as Track)
  }
  for (const pattern of value.patterns) {
    if (!record(pattern) || !exact(pattern, ['id', 'trackId', 'name', 'lengthTicks', 'notes']) || !label(pattern.id) || patterns.has(pattern.id)
      || !label(pattern.trackId) || !tracks.has(pattern.trackId) || !label(pattern.name) || !integer(pattern.lengthTicks, 1, end) || !Array.isArray(pattern.notes)) return false
    stored += pattern.notes.length
    if (stored > MAX_NOTES) return false
    for (const note of pattern.notes) {
      if (!record(note) || !exact(note, ['id', 'pitch', 'startTick', 'durationTicks', 'velocity']) || !label(note.id) || noteIds.has(note.id)
        || !integer(note.pitch, 0, 127) || !integer(note.startTick, 0, pattern.lengthTicks - 1) || !integer(note.durationTicks, 1, end)
        || note.startTick + note.durationTicks > end || !integer(note.velocity, 1, 127)) return false
      noteIds.add(note.id)
    }
    patterns.set(pattern.id, pattern as unknown as Pattern)
  }
  for (const clip of value.clips) {
    if (!record(clip) || !exact(clip, ['id', 'trackId', 'patternId', 'startTick']) || !label(clip.id) || clipIds.has(clip.id)
      || !label(clip.trackId) || !tracks.has(clip.trackId) || !label(clip.patternId) || !integer(clip.startTick, 0, end - 1)) return false
    const pattern = patterns.get(clip.patternId)
    if (!pattern || pattern.trackId !== clip.trackId || clip.startTick + pattern.lengthTicks > end) return false
    const clipStart = clip.startTick
    expanded += pattern.notes.length
    if (expanded > MAX_NOTES || pattern.notes.some(note => clipStart + note.startTick + note.durationTicks > end)) return false
    clipIds.add(clip.id)
  }
  if (version === 6 && !validateNotationState(value.notation, value as unknown as StudioProject)) return false
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PROJECT_BYTES } catch { return false }
}

/** Exact event expansion. Hidden/muted tracks remain musical data; the mixer alone silences audio. */
export function compileArrangement(project: StudioProject): CompiledNote[] {
  assertStudioProject(project)
  const tracks = new Map(project.tracks.map(track => [track.id, track]))
  const patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]))
  const events: CompiledNote[] = []
  for (const clip of project.clips) {
    const track = tracks.get(clip.trackId)!, pattern = patterns.get(clip.patternId)!
    for (const note of pattern.notes) events.push({
      ...note, id: JSON.stringify([clip.id, note.id]), startTick: clip.startTick + note.startTick,
      instrument: editorInstrument(track.soundId), trackId: track.id, soundId: track.soundId, clipId: clip.id, patternId: pattern.id, sourceNoteId: note.id,
    })
  }
  // Stable source-array ordering resolves ties without locale-dependent comparisons.
  return events.sort((a, b) => a.startTick - b.startTick)
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && finite(value, min, max)
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 120 && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
