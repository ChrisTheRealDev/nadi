import { describe, expect, it } from 'vitest'
import { createStudioProject } from './model'
import { defaultNotation, DEFAULT_NOTE } from './notationModel'
import { createSheetMusic, scoreSourceLookup } from './sheetMusic'

function unisons(separateVoices: boolean) {
  const project = createStudioProject()
  project.version = 6
  project.notation = defaultNotation()
  project.patterns[0].notes = [
    { id: 'first', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 },
    { id: 'second', pitch: 60, startTick: 0, durationTicks: 480, velocity: 80 },
  ]
  if (separateVoices) project.notation.notes.second = { ...DEFAULT_NOTE, voice: 2 }
  return project
}

describe('score source selection identity', () => {
  it('distinguishes two unisons at the same time on the same staff by exported voice', () => {
    const score = createSheetMusic(unisons(true), { grid: 1, spelling: 'sharps' })
    const lookup = scoreSourceLookup(score.mapping)
    expect(lookup.get('0:1:0:60')?.noteId).toBe('first')
    expect(lookup.get('0:2:0:60')?.noteId).toBe('second')
    expect(score.xml).toContain('<voice>2</voice>')
  })
  it('does not silently pick the last source for ambiguous same-voice unisons', () => {
    const score = createSheetMusic(unisons(false), { grid: 1, spelling: 'sharps' })
    expect(score.mapping).toHaveLength(2)
    expect(scoreSourceLookup(score.mapping).get('0:1:0:60')).toBeNull()
  })
  it('keeps individual source identity on tied segments crossing a measure', () => {
    const project = unisons(true)
    project.patterns[0].notes[0].durationTicks = 2400
    const score = createSheetMusic(project, { grid: 1, spelling: 'sharps' })
    const lookup = scoreSourceLookup(score.mapping)
    expect(lookup.get('0:1:0:60')?.noteId).toBe('first')
    expect(lookup.get('0:1:1920:60')?.noteId).toBe('first')
  })
})
