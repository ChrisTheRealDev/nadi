import { describe, expect, it } from 'vitest'
import { createProject, MAX_PROJECT_BYTES, validateProject } from './model'
import { copyMidiIdea, createAudioIdea, createMidiIdea, createTextIdea, ideaToNotes, MAX_AUDIO_BYTES, preservesOriginalIdeas, validateIdeaOriginal, validateIdeas, type RawIdeaEvent } from './ideas'

const events: RawIdeaEvent[] = [
  { type: 'note-on', pitch: 60, velocity: 93, atMs: 25.5, order: 0, channel: 0, source: 'midi' },
  { type: 'controller', controller: 64, value: 127, atMs: 80, order: 1, channel: 0, source: 'midi' },
  { type: 'note-off', pitch: 60, velocity: 28, atMs: 100, order: 2, channel: 0, source: 'midi' },
  { type: 'pitch-bend', value: 9238, atMs: 150, order: 3, channel: 0, source: 'midi' },
  { type: 'controller', controller: 64, value: 0, atMs: 500, order: 4, channel: 0, source: 'midi' },
]

describe('immutable Idea Pad sources and explicit copy', () => {
  it('preserves exact original text and copies incoming MIDI events', () => {
    const text = '\r\n  A thought\twith space  \n'
    expect(createTextIdea(text).original).toEqual({ kind: 'text', text })
    const incoming = structuredClone(events), idea = createMidiIdea(incoming, 800)
    incoming[0].atMs = 50
    expect(idea.original).toEqual({ kind: 'midi', durationMs: 800, events })
    expect(() => createTextIdea('x'.repeat(12001))).toThrow()
  })

  it('validates exact schemas, canonical audio and raw-event ordering', () => {
    expect(validateIdeaOriginal({ kind: 'audio', base64: 'AAH+/w==', mimeType: 'audio/webm;codecs=opus', byteLength: 4, durationMs: 1000 })).toBe(true)
    for (const patch of [{ byteLength: 3 }, { base64: 'AAH+/x==' }, { mimeType: 'text/html' }, { durationMs: Infinity }, { durationMs: 60001 }, { unexpected: true }]) {
      expect(validateIdeaOriginal({ kind: 'audio', base64: 'AAH+/w==', mimeType: 'audio/webm', byteLength: 4, durationMs: 1000, ...patch })).toBe(false)
    }
    expect(() => createMidiIdea([...events].reverse(), 800)).toThrow()
    expect(() => createMidiIdea([{ ...events[0], atMs: NaN }], 800)).toThrow()
    expect(() => createMidiIdea([{ ...events[0], atMs: 801 }], 800)).toThrow()
    const idea = createTextIdea('hello')
    expect(validateIdeas([idea, idea], 1920)).toBe(false)
    expect(validateIdeas([{ ...idea, attachedTick: 1921 }], 1920)).toBe(false)
    expect(validateIdeas([{ ...idea, attachedTick: 1920 }], 1920)).toBe(true)
  })

  it('bounds total audio and serialized project size so every accepted project can be packaged', () => {
    const full = createAudioIdea(btoa('\0'.repeat(MAX_AUDIO_BYTES)), 'audio/webm', MAX_AUDIO_BYTES, 60000)
    const project = createProject()
    project.ideas = [full, { ...full, id: 'second' }]
    expect(validateProject(project)).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(project)).length).toBeLessThan(MAX_PROJECT_BYTES)
    project.ideas.push(createAudioIdea('AA==', 'audio/ogg', 1, 1))
    expect(validateProject(project)).toBe(false)
    project.ideas.pop()
    // Escaped text can exceed the byte budget even when character/count limits fit.
    for (let index = 0; index < 22; index++) project.ideas.push(createTextIdea('\0'.repeat(12000)))
    expect(validateProject(project)).toBe(false)
  })

  it('copies at current tempo with fresh IDs, extends arrangement and retains raw pedal/bend events', () => {
    const project = createProject(); project.bpm = 120; project.ideas = [createMidiIdea(events, 800)]
    const before = structuredClone(project)
    const next = copyMidiIdea(project, project.ideas[0].id, 7680)
    expect(next.notes).toHaveLength(1)
    expect(next.notes[0]).toMatchObject({ pitch: 60, velocity: 93, startTick: 7704, durationTicks: 456 })
    expect(next.bars).toBe(5)
    expect(next.ideas).toEqual(before.ideas)
    expect(project).toEqual(before)
    expect(copyMidiIdea(next, project.ideas[0].id, 0).notes[1].id).not.toBe(next.notes[0].id)
    next.notes[0].pitch = 72
    expect(project.ideas).toEqual(before.ideas)
  })

  it('keeps sustain channels separate and finishes open keys at original duration', () => {
    const original = { kind: 'midi' as const, durationMs: 1000, events: [
      { type: 'controller' as const, controller: 64, value: 127, atMs: 0, order: 0, channel: 0, source: 'midi' as const },
      { type: 'note-on' as const, pitch: 60, velocity: 90, atMs: 0, order: 1, channel: 1, source: 'midi' as const },
      { type: 'note-off' as const, pitch: 60, velocity: 0, atMs: 100, order: 2, channel: 1, source: 'midi' as const },
      { type: 'note-on' as const, pitch: 62, velocity: 90, atMs: 200, order: 3, channel: 0, source: 'screen' as const },
    ] }
    expect(ideaToNotes(original, 120).map(note => note.durationTicks)).toEqual([96, 768])
  })

  it('sorts only the derived notes when original timestamps arrive out of order', () => {
    const original = createMidiIdea([
      { type: 'note-off', pitch: 60, velocity: 17, atMs: 300, order: 0, channel: 0, source: 'midi' },
      { type: 'note-on', pitch: 60, velocity: 80, atMs: 100, order: 1, channel: 0, source: 'midi' },
    ], 400).original
    if (original.kind !== 'midi') throw new Error('Expected MIDI')
    const before = structuredClone(original)
    expect(ideaToNotes(original, 120)[0]).toMatchObject({ startTick: 96, durationTicks: 192 })
    expect(original).toEqual(before)
  })

  it.each([120, 123])('B12: channel controller %i ends only its own raw-source voices', controller => {
    const events: RawIdeaEvent[] = [
      { type: 'controller', controller: 64, value: 127, atMs: 0, order: 0, channel: 0, source: 'midi' },
      { type: 'note-on', pitch: 60, velocity: 90, atMs: 0, order: 1, channel: 0, source: 'midi' },
      { type: 'note-off', pitch: 60, velocity: 0, atMs: 100, order: 2, channel: 0, source: 'midi' },
      { type: 'note-on', pitch: 62, velocity: 90, atMs: 0, order: 3, channel: 1, source: 'midi' },
      { type: 'note-on', pitch: 64, velocity: 90, atMs: 0, order: 4, channel: 0, source: 'screen' },
      { type: 'note-on', pitch: 65, velocity: 90, atMs: 0, order: 5, channel: 0, source: 'midi' },
      { type: 'controller', controller, value: 0, atMs: 200, order: 6, channel: 0, source: 'midi' },
    ]
    const original = { kind: 'midi' as const, durationMs: 1000, events }, snapshot = structuredClone(original)
    const notes = ideaToNotes(original, 120)
    expect(notes.filter(note => [60, 65].includes(note.pitch)).map(note => note.durationTicks)).toEqual([192, 192])
    expect(notes.filter(note => [62, 64].includes(note.pitch)).map(note => note.durationTicks)).toEqual([960, 960])
    expect(original).toEqual(snapshot)
  })

  it('permits metadata changes and explicit undo removal but refuses rewriting a source', () => {
    const project = createProject(); project.ideas = [createTextIdea('Keep this exact')]
    const renamed = structuredClone(project); renamed.ideas[0].name = 'New name'; renamed.ideas[0].attachedTick = 400
    expect(preservesOriginalIdeas(project, renamed)).toBe(true)
    renamed.ideas[0].original = { kind: 'text', text: 'replacement' }
    expect(preservesOriginalIdeas(project, renamed)).toBe(false)
    expect(preservesOriginalIdeas(project, { ...project, ideas: [] })).toBe(true)
  })
})
