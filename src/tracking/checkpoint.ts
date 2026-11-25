import {
  assertStudioProject,
  decodeStudioProject,
  type StudioProject,
} from '../creation/v4/model'

/** Sharing format, deliberately separate from the private .nadi project. */
export interface CheckpointDTO {
  format: 'nadi-checkpoint'
  version: 1
  projectVersion: 5
  bpm: number
  bars: number
  tracks: StudioProject['tracks']
  patterns: StudioProject['patterns']
  clips: StudioProject['clips']
}

const KEYS = ['format', 'version', 'projectVersion', 'bpm', 'bars', 'tracks', 'patterns', 'clips']

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function playbackCandidate(value: Record<string, unknown>) {
  return {
    format: 'nadi-creation', version: 5,
    id: 'shared-checkpoint-playback', revision: 0, name: 'Shared checkpoint',
    bpm: value.bpm, bars: value.bars,
    tracks: value.tracks, patterns: value.patterns, clips: value.clips,
    ideas: [], guidance: { open: false, step: 0, experience: 'new' },
  }
}

/** No coercion, legacy upgrade, truncation, or private-field stripping on input. */
export function validateCheckpoint(value: unknown): string[] {
  try {
    if (!record(value) || Object.keys(value).length !== KEYS.length
      || !KEYS.every(key => Object.hasOwn(value, key))) {
      return ['Checkpoint fields do not match the supported sharing format.']
    }
    if (value.format !== 'nadi-checkpoint' || value.version !== 1 || value.projectVersion !== 5) {
      return ['This checkpoint format or musical project version is unsupported.']
    }
    // Reuse the musical trust boundary: nested exact keys, references, sounds,
    // production values, sustained tails, expanded-note and byte limits.
    const project = decodeStudioProject(playbackCandidate(value))
    const placedParts = new Set(project.clips.map(clip => clip.patternId))
    const placedTracks = new Set(project.clips.map(clip => clip.trackId))
    if (project.patterns.some(pattern => !placedParts.has(pattern.id))
      || project.tracks.some(track => !placedTracks.has(track.id))) {
      return ['Checkpoints may contain only parts and tracks placed in the shared arrangement.']
    }
    return []
  } catch {
    return ['The checkpoint contains invalid musical data or exceeds project limits.']
  }
}

/** Pure, detached checkpoint projection. Account synchronization separately includes unplaced music and finalized captures. */
export function createCheckpoint(project: StudioProject): CheckpointDTO {
  assertStudioProject(project)
  const placedParts = new Set(project.clips.map(clip => clip.patternId))
  const placedTracks = new Set(project.clips.map(clip => clip.trackId))
  const checkpoint: CheckpointDTO = structuredClone({
    format: 'nadi-checkpoint', version: 1, projectVersion: 5,
    bpm: project.bpm, bars: project.bars,
    tracks: project.tracks.filter(track => placedTracks.has(track.id)),
    patterns: project.patterns.filter(pattern => placedParts.has(pattern.id)),
    clips: project.clips,
  })
  const errors = validateCheckpoint(checkpoint)
  if (errors.length) throw new TypeError(errors.join(' '))
  return checkpoint
}

/** Ephemeral playback adapter only; callers must not activate/save it as a draft. */
export function checkpointToProject(value: unknown): StudioProject {
  const errors = validateCheckpoint(value)
  if (errors.length) throw new TypeError(errors.join(' '))
  return decodeStudioProject(playbackCandidate(value as unknown as Record<string, unknown>))
}
