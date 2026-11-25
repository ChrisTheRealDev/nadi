import { describe, expect, it } from 'vitest'
import { compileArrangement, createStudioProject, MAX_NOTES, TICKS_PER_BAR, type StudioProject } from '../creation/v4/model'
import { createAudioIdea, createMidiIdea, createTextIdea } from '../creation/ideas'
import { checkpointToProject, createCheckpoint, validateCheckpoint } from './checkpoint'

function fixture(): StudioProject {
  const project = createStudioProject()
  project.name = 'PRIVATE PROJECT TITLE'
  project.bpm = 97.25
  project.patterns[0].lengthTicks = TICKS_PER_BAR
  project.patterns[0].notes = [
    { id: 'note-one', pitch: 60, startTick: 17, durationTicks: TICKS_PER_BAR + 41, velocity: 63 },
    { id: 'note-two', pitch: 60, startTick: 17, durationTicks: 19, velocity: 97 },
  ]
  project.tracks[0] = { ...project.tracks[0], pan: -0.31, space: 0.42, level: 76, muted: true, hidden: true,
    expression: [{ tick: 0, value: 0.23 }, { tick: 783, value: 0.91 }] }
  project.clips.push({ ...project.clips[0], id: 'second-placement', startTick: TICKS_PER_BAR })
  project.patterns.push({ id: 'private-unplaced', trackId: project.tracks[0].id, name: 'PRIVATE UNUSED PART', lengthTicks: TICKS_PER_BAR,
    notes: [{ id: 'private-note', pitch: 99, startTick: 0, durationTicks: 32, velocity: 70 }] })
  project.tracks.push({ ...project.tracks[0], id: 'private-empty-track', name: 'PRIVATE UNUSED TRACK' })
  project.ideas = [
    createTextIdea('PRIVATE REFLECTION NOT INTENDED FOR SHARING'),
    createAudioIdea('AAH+/w==', 'audio/webm', 4, 1000),
    createMidiIdea([
      { type: 'note-off', pitch: 72, velocity: 17, atMs: 300.75, order: 0, channel: 3, source: 'midi' },
      { type: 'note-on', pitch: 72, velocity: 80, atMs: 100.5, order: 1, channel: 3, source: 'midi' },
    ], 400),
  ]
  return project
}

describe('immutable arrangement checkpoint projection', () => {
  it('shares only the exact allowlisted arrangement fields and placed material', () => {
    const project = fixture(), original = structuredClone(project)
    const shared = createCheckpoint(project)
    expect(Object.keys(shared).sort()).toEqual(['format', 'version', 'projectVersion', 'bpm', 'bars', 'tracks', 'patterns', 'clips'].sort())
    expect(shared.tracks).toHaveLength(1)
    expect(shared.patterns).toHaveLength(1)
    expect(shared.clips).toHaveLength(2)
    expect(JSON.stringify(shared)).not.toContain('PRIVATE')
    expect(shared).not.toHaveProperty('ideas')
    expect(shared).not.toHaveProperty('guidance')
    expect(shared).not.toHaveProperty('id')
    expect(project).toEqual(original)
    expect(validateCheckpoint(shared)).toEqual([])
  })

  it('preserves exact notes, overlap, linked placements and all production settings', () => {
    const project = fixture(), shared = createCheckpoint(project)
    const playback = checkpointToProject(shared)
    expect(compileArrangement(playback)).toEqual(compileArrangement(project))
    expect(playback.tracks[0]).toEqual(project.tracks[0])
    expect(playback.patterns[0]).toEqual(project.patterns[0])
    expect(playback.bpm).toBe(97.25)
    expect(playback.ideas).toEqual([])
    expect(playback.guidance).toEqual({ open: false, step: 0, experience: 'new' })
    expect(playback.name).toBe('Shared checkpoint')
  })

  it('detaches the shared data and each playback copy from all later changes', () => {
    const project = fixture(), shared = createCheckpoint(project), frozen = structuredClone(shared)
    const first = checkpointToProject(shared), second = checkpointToProject(shared)
    project.patterns[0].notes[0].pitch = 72
    project.tracks[0].expression[0].value = 0.5
    first.patterns[0].notes[0].pitch = 81
    first.tracks[0].expression[0].value = 0.8
    expect(shared).toEqual(frozen)
    expect(second.patterns[0].notes[0].pitch).toBe(60)
    expect(second.tracks[0].expression[0].value).toBe(0.23)
  })

  it('supports a truly empty arrangement without leaking unplaced material', () => {
    const project = fixture()
    project.clips = []
    const shared = createCheckpoint(project)
    expect(shared.tracks).toEqual([])
    expect(shared.patterns).toEqual([])
    expect(compileArrangement(checkpointToProject(shared))).toEqual([])
  })

  it.each(['ideas', 'guidance', 'id', 'revision', 'name', 'recordings'])('rejects unexpected private top-level field %s', key => {
    expect(validateCheckpoint({ ...createCheckpoint(fixture()), [key]: [] }).length).toBeGreaterThan(0)
  })

  it('rejects nested unknown fields rather than stripping them', () => {
    const shared = createCheckpoint(fixture())
    Object.assign(shared.patterns[0].notes[0], { recording: 'private' })
    expect(validateCheckpoint(shared).length).toBeGreaterThan(0)
    expect(() => checkpointToProject(shared)).toThrow(TypeError)
  })

  it('rejects unused source parts and tracks on externally supplied checkpoints', () => {
    const project = fixture(), shared = createCheckpoint(project)
    shared.patterns.push(project.patterns[1])
    expect(validateCheckpoint(shared).join(' ')).toContain('only parts and tracks placed')
    const other = createCheckpoint(project)
    other.tracks.push(project.tracks[1])
    expect(validateCheckpoint(other).length).toBeGreaterThan(0)
  })

  it.each([null, [], {}, { format: 'nadi-checkpoint' }])('rejects malformed input %j without throwing', value => {
    expect(validateCheckpoint(value).length).toBeGreaterThan(0)
  })

  it('rejects wrong versions, invalid references, unknown sounds and out-of-bounds tails', () => {
    const shared = createCheckpoint(fixture())
    expect(validateCheckpoint({ ...shared, projectVersion: 4 }).length).toBeGreaterThan(0)
    expect(validateCheckpoint({ ...shared, version: 2 }).length).toBeGreaterThan(0)
    const badReference = structuredClone(shared)
    badReference.clips[0].patternId = 'missing'
    expect(validateCheckpoint(badReference).length).toBeGreaterThan(0)
    const badSound = structuredClone(shared)
    Object.assign(badSound.tracks[0], { soundId: 'unregistered' })
    expect(validateCheckpoint(badSound).length).toBeGreaterThan(0)
    const badTail = structuredClone(shared)
    badTail.patterns[0].notes[0].durationTicks = shared.bars * TICKS_PER_BAR
    expect(validateCheckpoint(badTail).length).toBeGreaterThan(0)
  })

  it('rejects expanded arrangements beyond the existing musical capacity', () => {
    const shared = createCheckpoint(fixture())
    shared.clips = Array.from({ length: MAX_NOTES / 2 + 1 }, (_, index) => ({ ...shared.clips[0], id: `clip-${index}` }))
    expect(validateCheckpoint(shared).length).toBeGreaterThan(0)
  })

  it('rejects invalid source projects without modifying them', () => {
    const project = fixture()
    project.bpm = Number.NaN
    expect(() => createCheckpoint(project)).toThrow(TypeError)
    expect(Number.isNaN(project.bpm)).toBe(true)
  })
})
