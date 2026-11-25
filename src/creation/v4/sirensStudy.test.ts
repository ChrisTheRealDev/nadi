import { describe, it, expect } from 'vitest'
import { createSirensStudy } from './sirensStudy'
import { compileArrangement, validateStudioProject } from './model'
import { packStudioProject, unpackStudioProject } from './archive'
import { putExpressionPoint, expressionAt } from './expressionEditing'
import { updateTrackProduction } from './operations'
import { StudioHistory } from './history'

describe('Sirens empty study and expression editing', () => {
  it('creates a separate empty, correctly sized editable study without musical content', () => {
    const project = createSirensStudy(), other = createSirensStudy()
    expect(validateStudioProject(project)).toBe(true)
    expect(project.id).not.toBe(other.id)
    expect(project).toMatchObject({ name: 'Sirens — study', bars: 80, bpm: 120 })
    expect(project.tracks.map(track => track.soundId)).toEqual(['ancient-reed','oboe','vocal-air','bronze-resonance'])
    expect(compileArrangement(project)).toEqual([])
    expect(project.ideas).toEqual([])
    expect(unpackStudioProject(packStudioProject(project))).toEqual(project)
  })
  it('inserts or replaces one exact expression tick without rewriting other points', () => {
    const points = [{ tick: 13, value: .2 }, { tick: 1920, value: .8 }]
    expect(putExpressionPoint(points, { tick: 13, value: .5 })).toEqual([{ tick: 13, value: .5 }, points[1]])
    expect(points[0].value).toBe(.2)
    expect(expressionAt([], 600)).toBe(1)
    expect(expressionAt(points, 0)).toBe(.2)
    expect(expressionAt(points, 3000)).toBe(.8)
    expect(expressionAt([{ tick: 0, value: 0 }, { tick: 1920, value: 1 }], 960)).toBe(.5)
  })
  it('production commands undo without altering notes or originals', () => {
    const project = createSirensStudy(), history = new StudioHistory()
    history.push(project, { label: 'Draw expression', context: { panel: 'mixer', trackId: project.tracks[0].id } })
    const next = updateTrackProduction(project, project.tracks[0].id, { pan: -.4, space: .3, expression: [{ tick: 0, value: .2 }, { tick: 1920, value: 1 }] })
    const restored = history.undo(next)!
    expect(restored.tracks).toEqual(project.tracks)
    expect(restored.patterns).toEqual(project.patterns)
    expect(history.redo(restored)!.tracks).toEqual(next.tracks)
  })
})
