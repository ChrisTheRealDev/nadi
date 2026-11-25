import { instrumentProfile } from './instrumentProfiles'
import { type StudioProject, type SoundId } from './model'

export type PerformerMode = 'default' | 'solo' | 'ensemble' | 'electronic'
export interface PlayabilityLocation {
  readonly trackId: string
  readonly patternId: string
  readonly clipId: string | null
  readonly noteId: string
  /** Global arrangement ticks, or pattern-local ticks for an unplaced pattern. */
  readonly startTick: number
  readonly endTick: number
  readonly pitch: number
}
export interface PlayabilityFinding {
  readonly id: string
  readonly rule: 'reference-range' | 'single-player-overlap' | 'performer-unspecified'
  readonly severity: 'review' | 'conventional-conflict' | 'information'
  readonly trackId: string
  readonly soundId: SoundId
  readonly trackName: string
  readonly title: string
  readonly explanation: string
  readonly alternatives: readonly string[]
  readonly affected: readonly PlayabilityLocation[]
  readonly sources: readonly string[]
}
export interface PlayabilitySnapshot {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly projectRevision: number
  readonly performerModes: Readonly<Record<string, PerformerMode>>
  readonly findings: readonly PlayabilityFinding[]
  readonly checkedNoteOccurrences: number
  readonly limitation: string
}
export const PLAYABILITY_LIMITATION = 'Reference ranges and conventional wind/brass overlaps only. No warning does not certify playability; ask your tutor about technique, breathing, fingering and the actual performers.'
export function pitchLabel(pitch: number): string {
  return `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

/** Read-only, offline checks. Never infer player count from a user-entered track name. */
export function analyzePlayability(project: StudioProject, performerModes: Readonly<Record<string, PerformerMode>> = Object.fromEntries(Object.entries(project.notation?.tracks ?? {}).map(([id, track]) => [id, track.performerMode ?? 'default']))): PlayabilitySnapshot {
  const findings: PlayabilityFinding[] = []
  const byTrack = new Map<string, PlayabilityLocation[]>()
  const patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]))
  const placed = new Set<string>()
  const add = (location: PlayabilityLocation) => {
    const list = byTrack.get(location.trackId) ?? []
    list.push(Object.freeze(location)); byTrack.set(location.trackId, list)
  }
  for (const clip of project.clips) {
    const pattern = patterns.get(clip.patternId)
    if (!pattern) continue
    placed.add(pattern.id)
    for (const note of pattern.notes) add({ trackId: clip.trackId, patternId: pattern.id, clipId: clip.id, noteId: note.id, startTick: clip.startTick + note.startTick, endTick: clip.startTick + note.startTick + note.durationTicks, pitch: note.pitch })
  }
  // Unplaced musical ideas are checked separately; they never conflict with another pattern.
  for (const pattern of project.patterns) if (!placed.has(pattern.id)) {
    for (const note of pattern.notes) add({ trackId: pattern.trackId, patternId: pattern.id, clipId: null, noteId: note.id, startTick: note.startTick, endTick: note.startTick + note.durationTicks, pitch: note.pitch })
  }
  for (const track of project.tracks) {
    const locations = byTrack.get(track.id) ?? []
    if (!locations.length) continue
    const profile = instrumentProfile(track.soundId), mode = performerModes[track.id] ?? 'default'
    const push = (finding: Omit<PlayabilityFinding, 'id' | 'trackId' | 'soundId' | 'trackName' | 'sources'>) => findings.push(Object.freeze({
      ...finding, id: `${track.id}:${finding.rule}`, trackId: track.id, soundId: track.soundId, trackName: track.name,
      affected: Object.freeze([...finding.affected]), alternatives: Object.freeze([...finding.alternatives]), sources: profile.sources,
    }))
    if (mode === 'electronic') continue
    if (profile.kind === 'approximation' || profile.kind === 'synthetic' || (profile.kind === 'ensemble' && !profile.soundingRange)) {
      push({ rule: 'performer-unspecified', severity: 'information', title: 'Choose the real performers',
        explanation: `${profile.label} does not identify a specific live instrument or player range. ${profile.assumption}`,
        alternatives: ['Keep this part electronic if that is the intended performance.', 'Assign a specific acoustic instrument or divide the music into individual performer parts, then review them with your tutor.'], affected: locations })
      continue
    }
    if (profile.soundingRange) {
      const [low, high] = profile.soundingRange
      const outside = locations.filter(note => note.pitch < low || note.pitch > high)
      if (outside.length) push({ rule: 'reference-range', severity: 'review', title: 'Review the instrument range',
        explanation: `${outside.length} note occurrence${outside.length === 1 ? ' is' : 's are'} outside the ${pitchLabel(low)}–${pitchLabel(high)} sounding reference for ${profile.label}. ${profile.assumption}`,
        alternatives: [`Move the affected passage into ${pitchLabel(low)}–${pitchLabel(high)}, checking that the musical idea still works.`, 'Give those notes to another instrument, or confirm an extension or specialist technique with the performer.'], affected: outside })
    }
    if (profile.conventionalSingleLine && mode !== 'ensemble') {
      const groups = new Map<string, PlayabilityLocation[]>()
      for (const note of locations) {
        const key = note.clipId === null ? `pattern:${note.patternId}` : 'arrangement'
        const list = groups.get(key) ?? []; list.push(note); groups.set(key, list)
      }
      const overlaps = [...groups.values()].flatMap(simultaneousDifferentPitches)
      if (overlaps.length) push({ rule: 'single-player-overlap', severity: 'conventional-conflict', title: 'More than one pitch for one player',
        explanation: `${profile.label} has overlapping different pitches. One player using conventional single-note technique cannot sustain this as written. Extended techniques such as multiphonics need specific performer guidance.`,
        alternatives: ['Split the simultaneous lines across separate players.', 'Shorten the overlap or play the notes one after another.', 'Give the chord to a keyboard or other suitable instrument. If this track already represents multiple players, set its performance assumption to ensemble.'], affected: overlaps })
    }
  }
  return Object.freeze({ schemaVersion: 1, projectId: project.id, projectRevision: project.revision,
    performerModes: Object.freeze({ ...performerModes }), findings: Object.freeze(findings),
    checkedNoteOccurrences: [...byTrack.values()].reduce((count, notes) => count + notes.length, 0), limitation: PLAYABILITY_LIMITATION })
}

/** Sweep note intervals, end before start at equal ticks. Each affected note is added only once. */
function simultaneousDifferentPitches(notes: readonly PlayabilityLocation[]): PlayabilityLocation[] {
  const events = notes.flatMap((note, index) => [{ tick: note.startTick, start: true, index }, { tick: note.endTick, start: false, index }])
    .sort((a, b) => a.tick - b.tick || Number(a.start) - Number(b.start) || a.index - b.index)
  const pitches = new Map<number, number>(), pending = new Set<number>(), affected = new Set<number>()
  for (const event of events) {
    const pitch = notes[event.index].pitch
    if (event.start) {
      pitches.set(pitch, (pitches.get(pitch) ?? 0) + 1); pending.add(event.index)
      if (pitches.size > 1) { for (const index of pending) affected.add(index); pending.clear() }
    } else {
      const remaining = (pitches.get(pitch) ?? 1) - 1
      if (remaining) pitches.set(pitch, remaining); else pitches.delete(pitch)
      pending.delete(event.index)
    }
  }
  return [...affected].sort((a, b) => notes[a].startTick - notes[b].startTick || a - b).map(index => notes[index])
}
