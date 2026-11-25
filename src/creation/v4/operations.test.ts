import { describe, expect, it } from 'vitest'
import { addPattern, addTrack, deleteClip, deleteTrack, duplicateClip, makeIndependent, moveClip, pastePattern, placePattern, updatePatternNotes, moveClips, deleteClips, duplicateClips, createClipClipboard, pasteClips, removeUnusedPatterns, fitProjectLength, projectCapacity, updateTrackProduction } from './operations'
import { createTextIdea } from '../ideas'
import { compileArrangement, createStudioProject, MAX_BARS, TICKS_PER_BAR, validateStudioProject } from './model'

const phrase = () => {
  const project = createStudioProject()
  return updatePatternNotes(project, project.patterns[0].id, [{ id: 'original-note', pitch: 60, startTick: 73, durationTicks: 901, velocity: 83 }])
}
describe('v4 pure arrangement operations', () => {
  it('updates production settings as one immutable atomic operation without changing notes', () => {
    const project = phrase(), before = structuredClone(project), id = project.tracks[0].id
    const patch = { pan: -.25, space: .35, spaceBypass: false, expression: [{ tick: 0, value: .2 }, { tick: 900, value: .9 }] }
    const next = updateTrackProduction(project, id, patch)
    expect(next.tracks[0]).toMatchObject(patch)
    expect(compileArrangement(next)).toEqual(compileArrangement(project))
    patch.expression[0].value = 0
    expect(next.tracks[0].expression[0].value).toBe(.2)
    expect(() => updateTrackProduction(project, id, { pan: .4, space: 2 })).toThrow()
    expect(() => updateTrackProduction(project, id, { pan: .4, expression: [{ tick: 0, value: 1 }, { tick: 0, value: .2 }] })).toThrow()
    expect(() => updateTrackProduction(project, 'absent', { pan: 0 })).toThrow()
    expect(() => updateTrackProduction(project, id, { level: 0 } as never)).toThrow()
    expect(project).toEqual(before)
    expect(updateTrackProduction(project, id, {})).toEqual(project)
  })
  it('new sounds start neutral and fit length preserves the last expression point', () => {
    let project = phrase()
    for (const sound of ['oboe', 'ancient-reed', 'vocal-air', 'bronze-resonance'] as const) project = addTrack(project, sound)
    expect(project.tracks.every(track => track.pan === 0 && track.space === 0 && !track.spaceBypass && track.expression.length === 0)).toBe(true)
    project.bars = 80
    project = updateTrackProduction(project, project.tracks[0].id, { expression: [{ tick: 70 * 1920, value: .1 }] })
    expect(fitProjectLength(project).bars).toBe(70)
    expect(fitProjectLength(project).tracks[0].expression).toEqual(project.tracks[0].expression)
  })
  it('moves and duplicates multitrack groups atomically with exact relative timing', () => {
    let project = addTrack(phrase(), 'strings')
    project = moveClip(project, project.clips[1].id, 73)
    const ids = project.clips.map(clip => clip.id), original = structuredClone(project)
    const moved = moveClips(project, ids, 1920)
    expect(moved.clips.map(clip => clip.startTick)).toEqual([1920, 1993])
    expect(() => moveClips(project, ids, -1)).toThrow()
    expect(() => moveClips(project, ids, 256 * 1920)).toThrow()
    expect(() => deleteClips(project, [ids[0], 'missing'])).toThrow()
    expect(project).toEqual(original)
    const copies = duplicateClips(project, ids, 10000)
    expect(copies.clips.slice(2).map(clip => clip.startTick)).toEqual([10000, 10073])
    expect(copies.patterns).toHaveLength(4)
    expect(copies.patterns[2].notes[0].id).not.toBe('original-note')
    const linked = duplicateClips(project, ids, 10000, true)
    expect(linked.patterns).toHaveLength(2)
    expect(linked.clips[2].patternId).toBe(project.clips[0].patternId)
    expect(deleteClips(copies, copies.clips.slice(2).map(clip => clip.id)).patterns).toHaveLength(4)
  })
  it('clipboard freezes music and validates every destination before committing', () => {
    const project = addTrack(phrase(), 'strings'), before = structuredClone(project)
    const clipboard = createClipClipboard(project, project.clips.map(clip => clip.id))
    clipboard.entries[0].pattern.notes[0].pitch = 72
    expect(project).toEqual(before)
    const pasted = pasteClips(project, clipboard, 8000)
    expect(pasted.patterns[2].notes[0].pitch).toBe(72)
    expect(() => pasteClips(project, clipboard, 0, { [project.tracks[1].id]: 'missing' })).toThrow()
    expect(() => duplicateClips(project, [project.clips[0].id, project.clips[0].id])).toThrow()
    expect(project).toEqual(before)
  })
  it('cleans only unused parts and conservatively fits stored tails and original attachments', () => {
    let project = phrase()
    project = duplicateClip(project, project.clips[0].id)
    const unused = project.patterns[1].id
    project = deleteClip(project, project.clips[1].id)
    project.patterns[1].lengthTicks = 9 * 1920; project.bars = 256
    const idea = createTextIdea('exact original'); idea.attachedTick = 12 * 1920; project.ideas.push(idea)
    expect(projectCapacity(project)).toMatchObject({ storedNotes: 2, expandedNotes: 1, originals: 1, unusedPatterns: [{ id: unused, notes: 1 }] })
    expect(() => removeUnusedPatterns(project, [project.patterns[0].id])).toThrow()
    const cleaned = removeUnusedPatterns(project, [unused])
    expect(cleaned.patterns).toHaveLength(1)
    expect(fitProjectLength(cleaned).bars).toBe(12)
    expect(fitProjectLength({ ...project, ideas: [] }).bars).toBe(9)
    expect(fitProjectLength({ ...cleaned, ideas: [] }).bars).toBe(4)
    expect(project.bars).toBe(256)
  })
  it('rejects an entire group duplication when expanded notes exceed capacity', () => {
    const project = phrase()
    project.patterns[0].notes = Array.from({ length: 5001 }, (_, i) => ({ id: `n${i}`, pitch: 60, startTick: 0, durationTicks: 1, velocity: 80 }))
    const before = structuredClone(project)
    expect(() => duplicateClips(project, [project.clips[0].id])).toThrow()
    expect(() => duplicateClips(project, [project.clips[0].id], undefined, true)).toThrow()
    expect(project).toEqual(before)
  })
  it('adds independently mixed repeated sounds without touching the source', () => {
    const project = phrase(), before = structuredClone(project), next = addTrack(project, 'piano')
    next.tracks[1].level = 20
    expect(project).toEqual(before)
    expect(next.tracks[0].level).toBe(100)
    expect(next.tracks[1].id).not.toBe(next.tracks[0].id)
    expect(next.patterns).toHaveLength(2)
    expect(next.clips).toHaveLength(2)
  })
  it('duplicates independent data by default, with fresh note and part IDs', () => {
    const project = phrase(), next = duplicateClip(project, project.clips[0].id)
    expect(next.bars).toBe(8)
    expect(next.patterns[1].id).not.toBe(next.patterns[0].id)
    expect(next.patterns[1].notes[0].id).not.toBe('original-note')
    const edited = updatePatternNotes(next, next.patterns[1].id, [{ ...next.patterns[1].notes[0], pitch: 67 }])
    expect(edited.patterns[0].notes[0].pitch).toBe(60)
    expect(compileArrangement(edited).map(note => [note.pitch, note.startTick, note.durationTicks])).toEqual([[60, 73, 901], [67, 7753, 901]])
    expect(project.patterns).toHaveLength(1)
  })
  it('explicitly links repeats and separates only the selected occurrence', () => {
    const project = phrase(), linked = duplicateClip(project, project.clips[0].id, true)
    expect(linked.patterns).toHaveLength(1)
    const changed = updatePatternNotes(linked, linked.patterns[0].id, [{ ...linked.patterns[0].notes[0], pitch: 65 }])
    expect(compileArrangement(changed).map(note => note.pitch)).toEqual([65, 65])
    const independent = makeIndependent(changed, changed.clips[1].id)
    const edited = updatePatternNotes(independent, independent.clips[1].patternId, [])
    expect(compileArrangement(edited)).toHaveLength(1)
    expect(edited.clips[0].patternId).toBe(changed.clips[0].patternId)
  })
  it('moves without quantizing exact timing and grows bars to include sustained tails', () => {
    const project = phrase()
    const long = updatePatternNotes(project, project.patterns[0].id, [{ id: 'sustain', pitch: 60, startTick: 73, durationTicks: 9000, velocity: 90 }], 1920)
    expect(long.bars).toBe(5)
    const moved = moveClip(long, long.clips[0].id, 113)
    expect(compileArrangement(moved)[0]).toMatchObject({ startTick: 186, durationTicks: 9000 })
    expect(moved.patterns[0].lengthTicks).toBe(1920)
  })
  it('deleting a placement preserves its part, deleting a track removes only its graph', () => {
    const project = addTrack(phrase(), 'strings'), withoutClip = deleteClip(project, project.clips[0].id)
    expect(withoutClip.patterns).toEqual(project.patterns)
    const withoutTrack = deleteTrack(project, project.tracks[0].id)
    expect(withoutTrack.tracks).toHaveLength(1)
    expect(withoutTrack.patterns.map(part => part.trackId)).toEqual([project.tracks[1].id])
    expect(withoutTrack.clips.map(clip => clip.trackId)).toEqual([project.tracks[1].id])
    expect(validateStudioProject(deleteTrack(withoutTrack, withoutTrack.tracks[0].id))).toBe(true)
  })
  it('places retained library parts after their last clip was deleted', () => {
    const original = phrase(), library = deleteClip(original, original.clips[0].id)
    const placed = placePattern(library, library.patterns[0].id, 731)
    expect(placed.clips).toHaveLength(1)
    expect(placed.patterns).toHaveLength(2)
    expect(compileArrangement(placed)[0].startTick).toBe(804)
    const linked = placePattern(library, library.patterns[0].id, 731, true)
    expect(linked.patterns).toHaveLength(1)
    expect(linked.clips[0].patternId).toBe(library.patterns[0].id)
  })
  it('pastes immutable snapshots onto another track with entirely fresh identities', () => {
    const source = phrase(), destination = addTrack(createStudioProject(), 'strings')
    const snapshot = structuredClone(source.patterns[0])
    const pasted = pastePattern(destination, destination.tracks[1].id, snapshot, 59)
    const part = pasted.patterns.at(-1)!
    expect(part.trackId).toBe(destination.tracks[1].id)
    expect(part.id).not.toBe(snapshot.id)
    expect(part.notes[0].id).not.toBe(snapshot.notes[0].id)
    expect(compileArrangement(pasted)[0]).toMatchObject({ pitch: 60, startTick: 132, soundId: 'strings' })
    expect(snapshot).toEqual(source.patterns[0])
    expect(() => pastePattern(destination, destination.tracks[1].id, { ...snapshot, lengthTicks: -1 }, 0)).toThrow()
  })
  it('fails invalid operations atomically and rejects tails beyond the song limit', () => {
    const project = phrase(), before = structuredClone(project)
    const failures = [
      () => moveClip(project, project.clips[0].id, -1),
      () => moveClip(project, project.clips[0].id, .5),
      () => moveClip(project, project.clips[0].id, (MAX_BARS - 1) * TICKS_PER_BAR),
      () => deleteClip(project, 'missing'),
      () => addPattern(project, 'missing'),
      () => updatePatternNotes(project, project.patterns[0].id, [{ id: 'invalid', pitch: 128, startTick: 0, durationTicks: 1, velocity: 80 }]),
    ]
    for (const fail of failures) { expect(fail).toThrow(); expect(project).toEqual(before) }
  })
  it('enforces 15 melodic channels and 16 total tracks', () => {
    let project = createStudioProject()
    for (let index = 1; index < 15; index++) project = addTrack(project, 'soft-pad')
    expect(() => addTrack(project, 'piano')).toThrow()
    project = addTrack(project, 'kick')
    expect(project.tracks).toHaveLength(16)
    expect(() => addTrack(project, 'hat')).toThrow()
  })
})
