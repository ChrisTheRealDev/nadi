import { describe, expect, it } from 'vitest'
import { acceptedEditObservations } from './editObservations'
import { createStudioProject } from './model'
import { addTrack, deleteClip, duplicateClip, makeIndependent, removeUnusedPatterns, updatePatternNotes } from './operations'

const note = (id: string, pitch = 60) => ({ id, pitch, startTick: 0, durationTicks: 120, velocity: 90 })

describe('accepted-edit observations', () => {
  it('never treats tempo-only edits as note or drum changes', () => {
    const before = createStudioProject(), after = { ...before, bpm: before.bpm + 1 }
    expect(acceptedEditObservations(before, after)).toEqual([])
  })
  it('scopes actual changed notes and deletions to the changed pattern and requested linked clip', () => {
    let before = createStudioProject()
    const first = before.clips[0]
    before = updatePatternNotes(before, first.patternId, [note('kept'), note('removed')])
    before = duplicateClip(before, first.id, true)
    const linked = before.clips.at(-1)!
    const after = updatePatternNotes(before, first.patternId, [note('kept', 61)])
    const events = acceptedEditObservations(before, after, { label: 'Edit notes', context: { panel: 'notes', trackId: first.trackId, clipId: linked.id } })
    expect(events).toEqual([
      { type: 'note-changed', projectId: after.id, trackId: first.trackId, clipId: linked.id },
      { type: 'note-deleted', projectId: after.id, trackId: first.trackId, clipId: linked.id },
    ])
  })
  it('scopes drum hits separately and does not count drum erase as a melodic note deletion', () => {
    const before = addTrack(createStudioProject(), 'kick'), clip = before.clips.at(-1)!
    const withHit = updatePatternNotes(before, clip.patternId, [note('hit', 36)])
    expect(acceptedEditObservations(before, withHit, { label: 'Add drum hit', context: { panel: 'drums', trackId: clip.trackId, clipId: clip.id } })).toEqual([{ type: 'drum-hit-changed', projectId: before.id, trackId: clip.trackId, clipId: clip.id }])
    expect(acceptedEditObservations(withHit, before).map(event => event.type)).toEqual(['drum-hit-changed'])
  })
  it('observes the actual mixer tracks, not a stale selection in metadata', () => {
    const before = addTrack(createStudioProject(), 'kick'), after = structuredClone(before)
    after.tracks[0].level = 42; after.tracks[1].muted = true
    const events = acceptedEditObservations(before, after, { label: 'Change volume', context: { panel: 'mixer', trackId: 'wrong', clipId: before.clips[0].id } })
    expect(events.map(event => [event.type, event.trackId])).toEqual([['mix-changed', before.tracks[0].id], ['mix-changed', before.tracks[1].id]])
    expect(events[1].clipId).toBe(before.clips[1].id)
  })
  it('does not invent note changes or deletions for independent copies or unused-part cleanup', () => {
    const before = createStudioProject(), withNote = updatePatternNotes(before, before.patterns[0].id, [note('saved')])
    const independent = makeIndependent(withNote, withNote.clips[0].id)
    expect(acceptedEditObservations(withNote, independent)).toEqual([])
    const unplaced = deleteClip(withNote, withNote.clips[0].id)
    const cleaned = removeUnusedPatterns(unplaced, [withNote.patterns[0].id])
    expect(acceptedEditObservations(unplaced, cleaned)).toEqual([])
  })
})
