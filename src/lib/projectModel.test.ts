import { describe, expect, it } from 'vitest'
import { courseReducer, createInitialCourseProgress, normalizeCourseProgress } from './courseProgress'
import { TICKS_PER_BAR } from './melodyEvents'
import { buildProjectPlayback } from './projectAudio'
import {
  applyProjectGraphEdit,
  createProjectContent,
  isValidCommandHistory,
  isValidProjectContent,
  projectProjectionFromContent,
} from './projectModel'

describe('canonical project v3', () => {
  it('keeps lanes organizational while note channels own routing', () => {
    let content = createProjectContent({ chords: [], melodyEvents: [], chordLevel: 72, melodyLevel: 78, reverb: 12 })
    content = applyProjectGraphEdit(content, { type: 'add-note', event: { id: 'note-1', pitch: 69, startTick: 0, durationTicks: 480, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' } })
    content.clips[0].laneId = 'lane-chords'
    expect(isValidProjectContent(content)).toBe(true)
    expect(projectProjectionFromContent(content).melodyEvents).toHaveLength(1)
  })

  it('rejects malformed graphs without throwing', () => {
    const valid = createProjectContent()
    const cases: unknown[] = [
      { ...valid, lanes: { foo: valid.lanes['lane-chords'], bar: valid.lanes['lane-melody'] } },
      { ...valid, channels: { ...valid.channels, 'channel-chords': { ...valid.channels['channel-chords'], gain: Number.NaN } } },
      { ...valid, patterns: { bad: { id: 7, name: {}, notes: [] } } },
      { ...valid, lengthTicks: String(TICKS_PER_BAR * 8) },
    ]
    cases.forEach((value) => expect(() => isValidProjectContent(value)).not.toThrow())
    cases.forEach((value) => expect(isValidProjectContent(value)).toBe(false))
  })

  it('shares a duplicated pattern until explicit Make Unique, then preserves origins', () => {
    let progress = createInitialCourseProgress('t0')
    progress.sessions['6'].stage = 'make'
    progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'A' })
    progress.sessions['7'].stage = 'make'
    progress = courseReducer(progress, { type: 'DUPLICATE_MELODY' })
    const first = progress.project.content.clips.find((clip) => clip.id === 'clip-melody-a')!
    const second = progress.project.content.clips.find((clip) => clip.id === 'clip-melody-b')!
    expect(second.patternId).toBe(first.patternId)
    progress = courseReducer(progress, { type: 'MAKE_UNIQUE_CLIP', clipId: second.id })
    const unique = progress.project.content.clips.find((clip) => clip.id === second.id)!
    expect(unique.patternId).not.toBe(first.patternId)
    expect(progress.project.content.patterns[unique.patternId].notes[0].originNoteId).toBe('note-1')
  })

  it('undoes and redoes exact content with monotonic revisions and no stranded duplicate flag', () => {
    let progress = createInitialCourseProgress('t0')
    progress.sessions['6'].stage = 'make'
    progress = courseReducer(progress, { type: 'ADD_MELODY_NOTE', half: 'A', bar: 0, note: 'A' })
    progress.sessions['7'].stage = 'make'
    progress = courseReducer(progress, { type: 'DUPLICATE_MELODY' })
    const afterDuplicate = JSON.stringify(progress.project.content)
    const duplicateRevision = progress.project.revision
    progress = courseReducer(progress, { type: 'UNDO_PROJECT' })
    expect(progress.project.revision).toBe(duplicateRevision + 1)
    expect(progress.project.content.clips.some((clip) => clip.id === 'clip-melody-b')).toBe(false)
    expect(progress.sessions['7'].made).not.toContain('duplicated-phrase')
    progress = courseReducer(progress, { type: 'REDO_PROJECT' })
    expect(progress.project.revision).toBe(duplicateRevision + 2)
    expect(JSON.stringify(progress.project.content)).toBe(afterDuplicate)
    expect(isValidCommandHistory(progress.history, progress.project.content)).toBe(true)
  })

  it('keeps leading rests and crops notes crossing the requested range', () => {
    const progress = createInitialCourseProgress('t0')
    progress.project.content = applyProjectGraphEdit(progress.project.content, { type: 'add-note', event: { id: 'late', pitch: 69, startTick: 240, durationTicks: TICKS_PER_BAR, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' } })
    Object.assign(progress.project, projectProjectionFromContent(progress.project.content))
    const playback = buildProjectPlayback(progress.project, 0, 1)
    expect(playback.notes[0].at).toBeGreaterThan(0)
    expect(playback.notes[0].duration).toBeCloseTo((60 / 90) * 3.5)
  })

  it('allocates collision-free canonical IDs and maps unusual legacy origins', () => {
    const initial = createInitialCourseProgress('t0')
    const raw = {
      ...initial,
      project: {
        ...initial.project,
        content: undefined,
        melodyEvents: [
          { id: 'a/b', pitch: 69, startTick: 0, durationTicks: 240, velocity: 72, trackId: 'melody', source: 'draw' },
          { id: 'a@b', pitch: 72, startTick: 240, durationTicks: 240, velocity: 72, trackId: 'melody', source: 'draw' },
          { id: 'b?', pitch: 69, startTick: TICKS_PER_BAR * 4, durationTicks: 240, velocity: 72, trackId: 'melody', source: 'duplicate', originId: 'a/b' },
        ],
      },
    }
    const normalized = normalizeCourseProgress(raw)
    expect(isValidProjectContent(normalized.project.content)).toBe(true)
    expect(new Set(normalized.project.melodyEvents.map((event) => event.id)).size).toBe(3)
    expect(normalized.project.melodyEvents.at(-1)?.originId).toContain('a-2f-b')
  })

  it('accepts a separate two-bar transfer graph without changing the eight-bar course graph', () => {
    const course = createInitialCourseProgress('t0')
    const transfer = createProjectContent()
    transfer.lengthTicks = TICKS_PER_BAR * 2
    expect(isValidProjectContent(transfer)).toBe(true)
    expect(course.project.content.lengthTicks).toBe(TICKS_PER_BAR * 8)
  })

  it('retains ordered channel-addressed CC64 events and clones them only on Make Unique', () => {
    const content = createProjectContent()
    content.patterns['pattern-control'] = {
      id: 'pattern-control', channelId: 'channel-melody', name: 'Recorded sustain', lengthTicks: TICKS_PER_BAR,
      notes: [],
      controllerEvents: [
        { id: 'pedal-down', channelId: 'channel-melody', controller: 64, startTick: 120, value: 127, source: 'midi', termination: 'observed' },
        { id: 'pedal-up', channelId: 'channel-melody', controller: 64, startTick: TICKS_PER_BAR, value: 0, source: 'derived', termination: 'record-stop' },
      ],
    }
    content.clips.push({ id: 'clip-control', patternId: 'pattern-control', laneId: 'lane-chords', startTick: 0, lengthTicks: TICKS_PER_BAR, offsetTick: 0 })
    content.clips.push({ id: 'clip-control-copy', patternId: 'pattern-control', laneId: 'lane-melody', startTick: TICKS_PER_BAR, lengthTicks: TICKS_PER_BAR, offsetTick: 0, originClipId: 'clip-control' })
    expect(isValidProjectContent(content)).toBe(true)

    const unique = applyProjectGraphEdit(content, { type: 'make-unique', clipId: 'clip-control' })
    const uniquePattern = unique.patterns[unique.clips.find((clip) => clip.id === 'clip-control')!.patternId]
    expect(uniquePattern.controllerEvents?.map((event) => event.originControllerEventId)).toEqual(['pedal-down', 'pedal-up'])
    expect(content.patterns['pattern-control'].controllerEvents?.map((event) => event.id)).toEqual(['pedal-down', 'pedal-up'])
  })

  it('moves, resizes, and duplicates clips without changing their channel routing or shared pattern', () => {
    let content = createProjectContent({ chords: [], melodyEvents: [], chordLevel: 72, melodyLevel: 78, reverb: 12 })
    content = applyProjectGraphEdit(content, { type: 'add-note', event: { id: 'note-a', pitch: 69, startTick: 0, durationTicks: 480, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' } })
    content = applyProjectGraphEdit(content, { type: 'resize-clip', clipId: 'clip-melody-a', lengthTicks: TICKS_PER_BAR * 2, offsetTick: 120 })
    content = applyProjectGraphEdit(content, { type: 'move-clip', clipId: 'clip-melody-a', startTick: TICKS_PER_BAR, laneId: 'lane-chords' })
    content = applyProjectGraphEdit(content, { type: 'duplicate-clip', sourceClipId: 'clip-melody-a', newClipId: 'clip-copy', startTick: TICKS_PER_BAR * 4, laneId: 'lane-melody' })
    const moved = content.clips.find((clip) => clip.id === 'clip-melody-a')!
    const copy = content.clips.find((clip) => clip.id === 'clip-copy')!
    expect(moved).toMatchObject({ startTick: TICKS_PER_BAR, lengthTicks: TICKS_PER_BAR * 2, offsetTick: 120, laneId: 'lane-chords' })
    expect(copy.patternId).toBe(moved.patternId)
    expect(copy.originClipId).toBe(moved.id)
    expect(content.patterns[moved.patternId].notes[0].channelId).toBe('channel-melody')
    expect(isValidProjectContent(content)).toBe(true)

    const unchanged = applyProjectGraphEdit(content, { type: 'move-clip', clipId: moved.id, startTick: content.lengthTicks })
    expect(unchanged).toEqual(content)
  })
})
