import { describe, expect, it } from 'vitest'
import { CREATION_SELECTION_SCHEMA, helpTopics, parseCreationRequest, type CreationMiraRequest } from './contracts'
import { authoredResponse, helpSteps, stepCompleted, targetInContext, validateCreationResponse, validateSelection } from './registry'
export const request = (): CreationMiraRequest => ({ version: 1, question: 'How do I change a note?', workspace: { projectId: 'project-test', revision: 2, editor: 'piano', selectedBar: 0, hasPianoNotes: true, hasDrumHits: false, selectedNote: false, visibleDrumRows: ['kick', 'snare', 'hat'], mutedInstruments: [], saved: true } })
describe('bounded creation help', () => {
  it('answers the exact audited beginner questions with useful authored routes', () => {
    const start = authoredResponse({ ...request(), question: "I don't know where to start" })
    expect(start.selection).toEqual({ topic: 'start', stepIds: ['start-play'] })
    expect(helpSteps['start-play'].action).toContain('If you like')
    expect(helpSteps['start-play'].action).toContain('Choose any key yourself')
    const tick = authoredResponse({ ...request(), question: 'What is a tick?' })
    expect(tick.selection).toEqual({ topic: 'tick', stepIds: ['term-tick'] })
    expect(helpSteps['term-tick'].idea).toContain('480 ticks for one beat')
    const sound = authoredResponse({ ...request(), question: 'I want to change this sound' })
    expect(sound.selection).toEqual({ topic: 'sound-choice', stepIds: ['sound-clarify'] })
    expect(helpSteps['sound-clarify'].idea).toContain('different instrument')
    expect(helpSteps['sound-clarify'].idea).toContain('pitch')
    expect(helpSteps['sound-clarify'].idea).toContain('volume')
    expect(helpSteps['sound-clarify'].idea).toContain('cannot hear')
    expect(helpSteps['sound-clarify'].target).toBeUndefined()
    expect(helpSteps['sound-clarify'].action).not.toContain('Press Test sound')
    for (const answer of [start, tick, sound]) expect(validateCreationResponse(answer, request().workspace)).toBe(true)
  })
  it('explains beats, bars and velocity without requiring editing or completing a course', () => {
    for (const term of ['beat', 'bar', 'velocity'] as const) {
      expect(authoredResponse({ ...request(), question: `What is a ${term}?` }).selection).toEqual({ topic: term, stepIds: [`term-${term}`] })
      expect(helpSteps[`term-${term}`].observes).toBeUndefined()
      expect(stepCompleted(helpSteps[`term-${term}`], request().workspace, { sequence: 1, type: 'note-changed' }, 0)).toBe(false)
    }
    expect(helpSteps['term-beat'].idea).toContain('steady pulse')
    expect(helpSteps['term-bar'].idea).toContain('four beats')
    expect(helpSteps['term-velocity'].idea).toContain('not how fast')
  })
  it('keeps specific sound questions on their actual control route', () => {
    for (const [question, topic] of [['I want to change the sound volume', 'mix'], ['change the sound pitch', 'note'], ['I cannot hear any sound', 'sound'], ['add a drum beat', 'drums']]) {
      expect(authoredResponse({ ...request(), question }).selection.topic).toBe(topic)
    }
    expect(authoredResponse({ ...request(), question: 'where do I start?', workspace: { ...request().workspace, editor: 'drums' } }).selection.stepIds).toEqual(['piano-editor', 'start-play'])
  })
  it('routes delete, move, resize and listening questions to exact registered controls', () => {
    const selected = { ...request().workspace, selectedNote: true }
    for (const [question, topic, step, target] of [
      ['How do I delete this note?', 'note-delete', 'note-delete', 'delete-notes'],
      ['Move my selected note later', 'note-move', 'note-move', 'note-tools'],
      ['How can I make a note shorter?', 'note-resize', 'note-resize', 'selected-note'],
      ['Can I preview note edits?', 'note-listen', 'note-listen', 'preview-notes'],
    ] as const) {
      const answer = authoredResponse({ ...request(), question, workspace: selected })
      expect(answer.selection).toEqual({ topic, stepIds: [step] })
      expect(helpSteps[step].target).toBe(target)
      expect(validateCreationResponse(answer, selected)).toBe(true)
    }
    expect(helpSteps['note-change'].action).toContain('Position (Bar/Beat)')
    expect(helpSteps['note-change'].action).toContain('Length (beats)')
    expect(helpSteps['note-change'].action).toContain('Strength')
  })
  it('does not treat an unrelated note edit as completion of deletion help', () => {
    const selected = { ...request().workspace, selectedNote: true }
    expect(helpSteps['note-delete'].observes).toBeUndefined()
    expect(stepCompleted(helpSteps['note-delete'], selected, { sequence: 2, type: 'note-changed' }, 1)).toBe(false)
  })
  it('keeps the registered strict schema aligned with every authored route', () => {
    const registeredIds = CREATION_SELECTION_SCHEMA.properties.stepIds.items.enum as readonly string[]
    expect([...registeredIds].sort()).toEqual(Object.keys(helpSteps).sort())
    expect(CREATION_SELECTION_SCHEMA.additionalProperties).toBe(false)
    for (const topic of helpTopics) {
      const selection = { topic, stepIds: topic === 'start' ? ['start-play'] : topic === 'sound-choice' ? ['sound-clarify'] : ['tick', 'beat', 'bar', 'velocity'].includes(topic) ? [`term-${topic}`] : authoredResponse({ ...request(), question: topic }).selection.stepIds }
      expect(validateSelection(selection, request().workspace)).toBe(true)
    }
  })
  it('does not mistake Test sound or an old key event for the user trying their own chord', () => {
    const step = helpSteps['chord-play'], w = request().workspace
    expect(stepCompleted(step, w, { sequence: 2, type: 'sound-tested' }, 1)).toBe(false)
    expect(stepCompleted(step, w, { sequence: 1, type: 'note-played' }, 1)).toBe(false)
    expect(stepCompleted(step, w, { sequence: 2, type: 'note-played' }, 1)).toBe(true)
    expect(stepCompleted(helpSteps['sound-test'], w, { sequence: 2, type: 'sound-tested' }, 1)).toBe(true)
  })
  it('guides next-bar repetition and explains independent copies and conflict safety', () => {
    expect(helpSteps['repeat-bar'].target).toBe('repeat-next-bar')
    expect(helpSteps['repeat-bar'].label).toBe('Repeat in next bar')
    expect(helpSteps['repeat-bar'].idea).toContain('independent copy')
    expect(helpSteps['repeat-bar'].action).toContain('not overwritten')
    expect(helpSteps['repeat-bar'].differently).toContain('refused')
  })
  it('recognizes the visible workspace panel names', () => {
    for (const [question, topic] of [['Channel rack', 'drums'], ['Playlist', 'repeat'], ['Mixer', 'mix'], ['Piano roll', 'note']]) {
      expect(authoredResponse({ ...request(), question }).selection.topic).toBe(topic)
    }
    expect(helpSteps['piano-editor'].label).toBe('Piano roll')
    expect(helpSteps['drum-editor'].label).toBe('Channel rack')
  })
  it('supports all seven topics locally with registered controls and no edit payload', () => {
    for (const question of ['no sound', 'record a chord', 'change a note', 'add drums', 'repeat passage', 'balance volume', 'save and export']) {
      const dto = { ...request(), question }, answer = authoredResponse(dto)
      expect(answer.source).toBe('authored'); expect(answer.transmission).toBe('not-sent')
      expect(answer.selection.topic).not.toBeNull()
      expect(answer.selection.stepIds.every(id => !!helpSteps[id])).toBe(true)
      expect(validateCreationResponse(answer, dto.workspace)).toBe(true)
      expect(answer).not.toHaveProperty('proposal')
    }
  })
  it('rejects extra project data and unknown facts', () => {
    expect(parseCreationRequest({ ...request(), notes: [] })).toBeNull()
    expect(parseCreationRequest({ ...request(), workspace: { ...request().workspace, recordings: [] } })).toBeNull()
    expect(parseCreationRequest({ ...request(), question: 'x'.repeat(501) })).toBeNull()
    expect(parseCreationRequest({ ...request(), workspace: { ...request().workspace, editor: ['piano'] } })).toBeNull()
  })
  it('rejects invented, reordered and stale responses', () => {
    const dto = request(), answer = authoredResponse(dto)
    expect(validateSelection({ topic: 'note', stepIds: ['delete-all'] }, dto.workspace)).toBe(false)
    expect(validateSelection({ topic: 'note', stepIds: ['note-change', 'note-select'] }, dto.workspace)).toBe(false)
    expect(validateCreationResponse(answer, { ...dto.workspace, revision: 3 })).toBe(false)
    expect(validateCreationResponse(answer, { ...dto.workspace, projectId: 'other' })).toBe(false)
  })
  it('validates visible editor and selected-note context before highlight', () => {
    const w = request().workspace
    expect(targetInContext(helpSteps['note-change'], w)).toBe(false)
    expect(targetInContext(helpSteps['drum-change'], w)).toBe(false)
    expect(targetInContext(helpSteps['note-change'], { ...w, selectedNote: true })).toBe(true)
  })
  it('honestly declines unsupported questions', () => {
    for (const question of ['Install a synthesizer plugin', 'Install a sound plugin', 'Import an mp3 sample', 'Import a sound sample', 'Write lyrics for me']) {
      expect(authoredResponse({ ...request(), question }).selection).toEqual({ topic: null, stepIds: [] })
    }
  })
  it('advises about controls without supplying a musical part or playback action', () => {
    expect(helpSteps['chord-play'].action).toContain('your own notes')
    expect(Object.values(helpSteps).some(step => 'example' in step)).toBe(false)
    const dto = request(), answer = authoredResponse(dto)
    expect(validateCreationResponse({ ...answer, edit: { notes: [] } }, dto.workspace)).toBe(false)
    expect(validateCreationResponse({ ...answer, play: 'generated-chord' }, dto.workspace)).toBe(false)
    expect(validateSelection({ topic: 'sound-choice', stepIds: ['sound-clarify'], execute: 'replace-instrument' }, dto.workspace)).toBe(false)
    expect(validateCreationResponse({ ...answer, source: ['authored'] }, dto.workspace)).toBe(false)
    expect(validateCreationResponse({ ...answer, transmission: ['not-sent'] }, dto.workspace)).toBe(false)
  })
})
