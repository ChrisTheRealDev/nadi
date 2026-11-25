import { describe, expect, it } from 'vitest'
import { createStudioProject } from './model'
import { addTrack, duplicateClip } from './operations'
import { advanceFirstSongGuide, confirmFirstSongListening, createFirstSongGuide, FIRST_SONG_PHASES, FIRST_SONG_STEPS, FIRST_SONG_STEP_IDS, observeFirstSongGuide, resolveFirstSongStep, retargetFirstSongGuide, type FirstSongStepId } from './firstSongGuide'

function fixture(step: FirstSongStepId = 'grid-draw') {
  const project = createStudioProject(), trackId = project.tracks[0].id, clipId = project.clips[0].id
  project.patterns[0].notes.push({ id: 'note', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 })
  const session = { ...createFirstSongGuide(project.id, 'A gentle first song', 10, trackId, clipId), currentStep: step }
  return { project, trackId, clipId, session, action: { sequence: 11, type: 'note-changed', projectId: project.id, trackId, clipId } }
}

describe('authored first song guide', () => {
  it('keeps the musical goal user-chosen and explains copy editing without prescribing notes', () => {
    expect(createFirstSongGuide('project', '  ').goal).toBe('')
    expect(createFirstSongGuide('project', ' My horn layer ').goal).toBe('My horn layer')
    expect(FIRST_SONG_STEPS['variation-change'].differently).toContain('You choose')
    expect(FIRST_SONG_STEPS['variation-change'].differently).not.toMatch(/higher final note|longer ending|small pause/)
    expect(FIRST_SONG_STEPS['layers-edit'].differently).toContain('does not choose notes')
  })
  it('covers each phase with granular steps and real completion actions', () => {
    expect([...new Set(FIRST_SONG_STEP_IDS.map(id => FIRST_SONG_STEPS[id].phase))]).toEqual(FIRST_SONG_PHASES)
    for (const id of FIRST_SONG_STEP_IDS) {
      const step = FIRST_SONG_STEPS[id]
      expect(step.action.length).toBeGreaterThan(15)
      expect(step.acceptedActions).not.toContain('next')
      expect(step.acceptedActions).not.toContain('panel-opened')
    }
    expect(FIRST_SONG_STEPS['correct-edit'].acceptedActions).not.toContain('undo')
    expect(FIRST_SONG_STEPS['variation-change'].acceptedActions).not.toContain('clips-duplicate')
    expect(FIRST_SONG_STEPS['finish-save'].acceptedActions).not.toContain('project-exported')
  })

  it('rejects stale, unscoped and wrong destination actions', () => {
    const { project, session, action } = fixture()
    for (const patch of [{ sequence: 10 }, { projectId: 'other' }, { trackId: 'other' }, { clipId: 'other' }, { type: 'next' }, { type: 'panel-opened' }, { type: 'clip-select' }, { projectId: undefined }]) {
      expect(observeFirstSongGuide(session, { ...action, ...patch }, project)).toBe(session)
    }
    expect(observeFirstSongGuide(session, action, project).completed).toEqual(['grid-draw'])
    expect(observeFirstSongGuide(session, action, { ...project, id: 'other' })).toBe(session)
  })

  it('cannot progress with Next; distinguishes skipped work from completed work', () => {
    const { session, project, action, trackId, clipId } = fixture()
    expect(advanceFirstSongGuide(session, 11, trackId, clipId)).toBe(session)
    const skipped = advanceFirstSongGuide(session, 11, trackId, clipId, true)
    expect(skipped.currentStep).toBe('listen-play'); expect(skipped.completed).toEqual([]); expect(skipped.skipped).toEqual(['grid-draw'])
    const done = observeFirstSongGuide(session, action, project)
    const next = advanceFirstSongGuide(done, 11, trackId, clipId)
    expect(next.currentStep).toBe('listen-play'); expect(next.completed).toEqual(['grid-draw'])
    expect(observeFirstSongGuide(next, { ...action, type: 'song-played' }, project)).toBe(next)
  })

  it('requires explicit user listening confirmation independently of playback', () => {
    const { session, action, project, trackId, clipId } = fixture('listen-play')
    expect(confirmFirstSongListening(session)).toBe(session)
    const played = observeFirstSongGuide(session, { ...action, type: 'song-played' }, project)
    const confirmation = advanceFirstSongGuide(played, 11, trackId, clipId)
    expect(confirmation.currentStep).toBe('listen-confirm')
    expect(observeFirstSongGuide(confirmation, { ...action, sequence: 12, type: 'song-played' }, project)).toBe(confirmation)
    expect(confirmFirstSongListening(confirmation).completed).toEqual(['listen-play', 'listen-confirm'])
  })

  it('binds each step to its intended clip and explicitly retargets without claiming progress', () => {
    const { session, project, trackId, clipId } = fixture('variation-change')
    const blocked = resolveFirstSongStep(session, project, trackId, 'another')
    expect(blocked.ready).toBe(false); expect(blocked.target).toBe('pattern-playlist')
    expect(resolveFirstSongStep(session, project, trackId, clipId).ready).toBe(true)
    const rebound = retargetFirstSongGuide(session, 20, trackId, 'another')
    expect(rebound.completed).toEqual([]); expect(rebound.startSequence).toBe(20)
    expect(resolveFirstSongStep(rebound, project, trackId, 'another').ready).toBe(false)
  })

  it('binds a variation to the created copy even after the user selects the original', () => {
    const { session, project, action, trackId, clipId } = fixture('variation-duplicate')
    const next = duplicateClip(project, clipId, false), copy = next.clips.at(-1)!
    const done = observeFirstSongGuide(session, { ...action, type: 'clip-duplicated-independent', resultTrackId: copy.trackId, resultClipId: copy.id }, next)
    const change = advanceFirstSongGuide(done, 12, trackId, clipId)
    expect(change.clipId).toBe(copy.id)
    expect(resolveFirstSongStep(change, next, trackId, clipId).ready).toBe(false)
    expect(observeFirstSongGuide(change, { ...action, sequence: 13 }, next)).toBe(change)
    const complete = observeFirstSongGuide(change, { ...action, sequence: 13, clipId: copy.id }, next)
    const rebound = retargetFirstSongGuide(complete, 14, trackId, clipId)
    expect(rebound.completed).not.toContain('variation-change')
  })

  it('does not complete correction Undo from another destination', () => {
    const { project, session, action } = fixture('correct-undo')
    expect(observeFirstSongGuide(session, { ...action, type: 'undo', clipId: 'another' }, project)).toBe(session)
    expect(observeFirstSongGuide(session, { ...action, type: 'undo', trackId: undefined, clipId: undefined }, project)).toBe(session)
  })

  it('routes missing destinations, missing notes, percussion and unavailable Undo to usable prerequisites', () => {
    const { project, trackId, clipId, session } = fixture()
    const noDestination = createFirstSongGuide(project.id, '')
    expect(resolveFirstSongStep(noDestination, project).target).toBe('pattern-playlist')
    expect(resolveFirstSongStep(session, project, trackId, clipId, { activeTool: 'erase' }).action).toContain('Choose Draw')
    expect(resolveFirstSongStep({ ...session, currentStep: 'correct-undo' }, project, trackId, clipId, { canUndo: false }).ready).toBe(false)
    const empty = structuredClone(project); empty.patterns[0].notes = []
    expect(resolveFirstSongStep({ ...session, currentStep: 'correct-edit' }, empty, trackId, clipId).precondition).toContain('Add a note')
    const drums = addTrack(project, 'kick'), drumTrack = drums.tracks.at(-1)!, drumClip = drums.clips.find(item => item.trackId === drumTrack.id)!
    const drumSession = retargetFirstSongGuide(session, 20, drumTrack.id, drumClip.id)
    expect(resolveFirstSongStep(drumSession, drums, drumTrack.id, drumClip.id).ready).toBe(false)
    expect(resolveFirstSongStep({ ...drumSession, currentStep: 'layers-edit' }, drums, drumTrack.id, drumClip.id).target).toBe('drum-timeline')
  })

  it('does not mutate or serialize guide progress into the project and finishes only after the final decision', () => {
    const { session, project, action, trackId, clipId } = fixture('finish-export'), before = JSON.stringify(project)
    const completed = observeFirstSongGuide(session, { ...action, type: 'project-exported' }, project)
    const finished = advanceFirstSongGuide(completed, 11, trackId, clipId)
    expect(finished.finished).toBe(true)
    expect(advanceFirstSongGuide(finished, 12)).toBe(finished)
    expect(JSON.stringify(project)).toBe(before)
    expect(project).not.toHaveProperty('firstSongGuide')
  })
})
