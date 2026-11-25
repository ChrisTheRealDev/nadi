import { describe, expect, it } from 'vitest'
import { createStudioProject, validateStudioProject } from './model'
import { defaultNotation } from './notationModel'
import { applyScoreCommand } from './notationCommands'

function restProject(startTick: number, durationTicks: number) {
  const project = createStudioProject()
  project.version = 6
  project.notation = defaultNotation()
  project.patterns[0].notes = []
  project.notation.rests = [{ id: 'rest', trackId: project.tracks[0].id, voice: 2, startTick, durationTicks }]
  return project
}

describe('score measure edits preserve rest boundaries', () => {
  it('shortens a rest crossing the removed measure and preserves its remaining tail', () => {
    const source = restProject(1440, 3360)
    const next = applyScoreCommand(source, { type: 'delete-measure', index: 1 })
    expect(next.notation!.rests).toMatchObject([{ startTick: 1440, durationTicks: 1440, voice: 2 }])
    expect(source.notation!.rests[0].durationTicks).toBe(3360)
    expect(validateStudioProject(next)).toBe(true)
  })
  it('retains the portion after a deleted measure when the rest starts inside it', () => {
    const next = applyScoreCommand(restProject(2400, 2400), { type: 'delete-measure', index: 1 })
    expect(next.notation!.rests).toMatchObject([{ startTick: 1920, durationTicks: 960 }])
  })
  it('extends a spanning rest when a measure is inserted and round-trips on deletion', () => {
    const source = restProject(1440, 960)
    const inserted = applyScoreCommand(source, { type: 'insert-measure', index: 1 })
    expect(inserted.notation!.rests).toMatchObject([{ startTick: 1440, durationTicks: 2880 }])
    const restored = applyScoreCommand(inserted, { type: 'delete-measure', index: 1 })
    expect(restored.notation!.rests).toEqual(source.notation!.rests)
  })
  it('removes a rest wholly inside a deleted measure', () => {
    const next = applyScoreCommand(restProject(2400, 480), { type: 'delete-measure', index: 1 })
    expect(next.notation!.rests).toEqual([])
  })
})
