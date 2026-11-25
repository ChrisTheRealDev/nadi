import { describe, expect, it } from 'vitest'
import { addTrack, duplicateClip, moveClip, updatePatternNotes } from './operations'
import { createStudioProject } from './model'
import { applyDrumClip, drumClipsInRange, projectDrumClip } from './combinedDrumEdits'

function example() {
  let project = addTrack(createStudioProject(), 'kick')
  const clip = project.clips.at(-1)!, pattern = project.patterns.at(-1)!
  project = updatePatternNotes(project, pattern.id, [{ id: 'hit', pitch: 36, startTick: 137, durationTicks: 60, velocity: 77 }, { id: 'later', pitch: 36, startTick: 4000, durationTicks: 79, velocity: 82 }])
  project = moveClip(project, clip.id, 1937)
  return { project, clip: project.clips.at(-1)! }
}
describe('song-aligned drum editing', () => {
  it('keeps fractional clip offsets exact and preserves notes outside the shown view', () => {
    const { project, clip } = example(), notes = projectDrumClip(project, clip.id)
    expect(notes.map(note => note.startTick)).toEqual([2074, 5937])
    const next = applyDrumClip(project, clip.id, notes.filter(note => note.id !== 'hit'))
    expect(next.patterns.at(-1)!.notes).toEqual([{ id: 'later', pitch: 36, startTick: 4000, durationTicks: 79, velocity: 82 }])
    expect(project.patterns.at(-1)!.notes).toHaveLength(2)
  })
  it('rejects an entire batch outside the selected placement instead of clamping it', () => {
    const { project, clip } = example(), notes = projectDrumClip(project, clip.id)
    expect(() => applyDrumClip(project, clip.id, [...notes, { ...notes[0], id: 'too-early', startTick: 1920 }])).toThrow('outside this part')
    expect(() => applyDrumClip(project, clip.id, [...notes, { ...notes[0], id: 'too-late', startTick: clip.startTick + 7680 }])).toThrow('outside this part')
    expect(project.patterns.at(-1)!.notes).toHaveLength(2)
  })
  it('returns every overlapping candidate and linked edits propagate intentionally', () => {
    const { project, clip } = example(), next = duplicateClip(project, clip.id, true, 2100)
    expect(drumClipsInRange(next, clip.trackId, 1, 4)).toHaveLength(2)
    const edited = applyDrumClip(next, clip.id, [])
    expect(edited.clips.filter(item => item.patternId === clip.patternId)).toHaveLength(2)
    expect(projectDrumClip(edited, next.clips.at(-1)!.id)).toEqual([])
  })
})
