import { describe, expect, it } from 'vitest'
import { createStudioProject } from './model'
import { studioQuestionAnswer, studioQuestionClarification, routeStudioQuestion, observedStudioStep, studioHelpAnswer } from './studioHelp'
import { studioStepIds, studioTopicsForVersion } from './miraContract'

describe('production intent rather than instrument keywords', () => {
  it.each(['horn', 'trumpet please', 'I want brass', 'bass', 'strings', 'What is a chord?', 'Explain these notes'])('does not invent an operation for %s', question => {
    expect(routeStudioQuestion(question)).toBeNull()
  })
  it.each([
    ["I can't hear the horn", 'listen'], ['my trumpet is silent', 'listen'],
    ['horn sound failed', 'missing-sound'], ['horn is too loud', 'volume'],
    ['I want a horn underneath my piano', 'add'], ['add French Horn', 'add'],
    ['change my piano to trumpet', 'sound'], ['switch the instrument', 'sound'],
  ])('distinguishes %s', (question, topic) => expect(routeStudioQuestion(question)).toBe(topic))
  it('clarifies an ambiguous instrument request without a target or musical data', () => {
    expect(studioQuestionClarification('I want a horn')).toContain('add another instrument track')
    expect(studioQuestionClarification('I want a horn')).toContain('change an existing')
    expect(studioQuestionClarification('What is a horn?')).toBeNull()
    expect(studioQuestionClarification("I can't hear the horn")).toBeNull()
  })
  it.each(['Write me a tune', 'Generate a chord progression', 'Suggest a variation', 'How could this continue?', 'What notes should I add?', 'Give me chords', 'Make me a beat'])('does not route composition requests into editing steps: %s', question => {
    expect(routeStudioQuestion(question)).toBeNull()
    expect(studioQuestionClarification(question)).toContain('do not create')
  })
})

describe('contextual chord guidance readiness', () => {
  it('points at the grid until a note is selected, then at Select chord', () => {
    const p = createStudioProject(), question = 'How do I move these chord notes together?'
    for (const noteSelection of ['none', 'unknown'] as const) {
      const answer = studioQuestionAnswer(question, 'notes', p, p.tracks[0].id, p.clips[0].id, { noteSelection })
      expect(answer.target).toBe('piano-roll'); expect(answer.action).toContain('Click one note')
    }
    expect(studioQuestionAnswer(question, 'notes', p, p.tracks[0].id, p.clips[0].id, { noteSelection: 'one' }).target).toBe('select-chord')
  })
})

describe('precise note guidance', () => {
  it('routes selection, movement and length as different tasks', () => {
    expect(routeStudioQuestion('How do I select my chord?')).toBe('select-chord')
    expect(routeStudioQuestion('Move these notes together')).toBe('move-notes')
    expect(routeStudioQuestion('Make this note longer')).toBe('resize-notes')
    expect(routeStudioQuestion('Delete these notes')).toBe('delete-note')
  })
  it('requires a selection before pointing to the actual note or handle', () => {
    const p = createStudioProject()
    for (const [topic, target] of [['move-notes', 'note-body'], ['resize-notes', 'note-resize'], ['select-chord', 'select-chord']] as const) {
      expect(studioQuestionAnswer('', topic, p, p.tracks[0].id, p.clips[0].id, { noteSelection: 'none' }).target).toBe('piano-roll')
      expect(studioQuestionAnswer('', topic, p, p.tracks[0].id, p.clips[0].id, { noteSelection: 'one' }).target).toBe(target)
    }
  })
  it('cannot complete a move on a resize, generic edit or a different part', () => {
    const destination = { projectId: 'project', trackId: 'track', clipId: 'clip' }
    const event = { sequence: 2, ...destination, type: 'notes-moved' }
    expect(observedStudioStep('move-notes', 1, event, destination)).toBe(true)
    expect(observedStudioStep('resize-notes', 1, event, destination)).toBe(false)
    expect(observedStudioStep('move-notes', 1, { ...event, type: 'note-changed' }, destination)).toBe(false)
    expect(observedStudioStep('move-notes', 1, { ...event, clipId: 'other' }, destination)).toBe(false)
    expect(observedStudioStep('move-notes', 2, event, destination)).toBe(false)
  })
})

describe('production controls without composition', () => {
  it.each([['add oboe', 'add'], ['change piano to ancient reed', 'sound'], ['add Vocal Air', 'add'], ['my bronze resonance is silent', 'listen'], ['pan my oboe left', 'pan'], ['add reverb', 'space'], ['draw a swell', 'expression']])('routes %s', (question, topic) => {
    expect(routeStudioQuestion(question)).toBe(topic)
  })
  it('requires a track and only observes the matching accepted production action', () => {
    const p = createStudioProject(), destination = { projectId: p.id, trackId: p.tracks[0].id, clipId: p.clips[0].id }
    for (const topic of ['pan', 'space', 'expression'] as const) {
      expect(studioHelpAnswer(topic, p, destination.trackId).target).toBe(`track-${topic}`)
      expect(studioHelpAnswer(topic, p).target).toBe('pattern-playlist')
      expect(studioStepIds(topic, { trackKind: 'none', hasClip: false, hasNotes: false, linkedUses: 0, canUndo: false, saved: false })).toEqual(['choose-track'])
      const action = { ...destination, sequence: 2, type: `${topic}-changed` }
      expect(observedStudioStep(topic, 1, action, destination)).toBe(true)
      expect(observedStudioStep(topic, 1, { ...action, trackId: 'other' }, destination)).toBe(false)
      expect(observedStudioStep(topic, 1, { ...action, type: 'mix-changed' }, destination)).toBe(false)
      expect(observedStudioStep(topic, 1, { ...action, type: 'panel-opened' }, destination)).toBe(false)
    }
  })
  it('does not advertise new controls to old help clients', () => {
    for (const version of [2, 3, 4, 5] as const) {
      expect(studioTopicsForVersion(version)).not.toHaveProperty('space')
      expect(studioTopicsForVersion(version)).not.toHaveProperty('expression')
    }
    expect(studioTopicsForVersion(6)).toHaveProperty('pan')
  })
})
