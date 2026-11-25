import { describe, expect, it } from 'vitest'
import { createTextIdea } from '../ideas'
import { applyEditorProjection, editorProjection } from './editorAdapter'
import { StudioHistory } from './history'
import { compileArrangement, createStudioProject, decodeStudioProject, validateStudioProject, type StudioProject } from './model'
import { addPattern, deleteClip, duplicateClip, fitProjectLength, moveClip, updatePatternNotes, updateTrackProduction } from './operations'
import { createCleanContinuation, decodeRecovery } from './recovery'

const seed = 0x15c0ffee
function random(seedValue: number) { let state = seedValue; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 } }
const weird = [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, -1, .5]
const music = (project: StudioProject) => JSON.stringify({ name: project.name, bpm: project.bpm, bars: project.bars, tracks: project.tracks, patterns: project.patterns, clips: project.clips })

describe('v015 bounded deterministic adversarial state stress', () => {
  it('rejects malformed editor metadata even when no notes changed', () => {
    const project = createStudioProject(), before = editorProjection(project)
    for (const bpm of weird) expect(() => applyEditorProjection(project, undefined, before, { ...before, bpm })).toThrow()
    expect(() => applyEditorProjection(project, undefined, before, { ...before, name: '' })).toThrow()
  })

  it('runs 12,000 mixed commands with input immutability, independent music expansion and undo/redo oracles', () => {
    const rng = random(seed), pick = (n: number) => Math.floor(rng() * n)
    let successful = 0, rejected = 0
    for (let batch = 0; batch < 120; batch++) {
      let project = createStudioProject()
      project.ideas = [createTextIdea('immutable original')]
      const history = new StudioHistory(12, 128 * 1024), past: string[] = [], future: string[] = []
      for (let step = 0; step < 100; step++) {
        const before = structuredClone(project), beforeMusic = music(project), operation = pick(12)
        const clip = project.clips[pick(project.clips.length)], pattern = project.patterns[pick(project.patterns.length)]
        let next: StudioProject | undefined
        try {
          if (operation === 0) next = moveClip(project, clip?.id ?? 'absent', pick(16) * 120)
          if (operation === 1) next = moveClip(project, clip?.id ?? 'absent', weird[pick(weird.length)])
          if (operation === 2) next = updatePatternNotes(project, pattern.id, [{ id: `n-${batch}-${step}`, pitch: pick(128), velocity: 1 + pick(127), startTick: pick(8) * 120, durationTicks: 1 + pick(1920) }])
          if (operation === 3) next = updatePatternNotes(project, pattern.id, [{ id: `bad-${step}`, pitch: weird[pick(weird.length)], velocity: 90, startTick: 0, durationTicks: 120 }])
          if (operation === 4) next = duplicateClip(project, clip?.id ?? 'absent', true, pick(16) * 120)
          if (operation === 5) next = deleteClip(project, clip?.id ?? 'absent')
          if (operation === 6) next = updateTrackProduction(project, project.tracks[0].id, { pan: pick(3) - 1, space: pick(2) })
          if (operation === 7) next = addPattern(project, project.tracks[0].id, 0, 1920)
          if (operation === 8) next = fitProjectLength(project)
          if (operation === 9) {
            next = history.undo(project)
            if (past.length) { expect(music(next!)).toBe(past.pop()); future.push(beforeMusic) }
            else expect(next).toBeUndefined()
          }
          if (operation === 10) {
            next = history.redo(project)
            if (future.length) { expect(music(next!)).toBe(future.pop()); past.push(beforeMusic) }
            else expect(next).toBeUndefined()
          }
          if (operation === 11) {
            const projection = editorProjection(project, project.tracks[0].id, pattern.id)
            next = applyEditorProjection(project, pattern.id, projection, { ...projection, bpm: 30 + pick(271), name: `seed ${seed} step ${step}` })
          }
        } catch (error) {
          // Assertion failures must never be counted as expected command rejection.
          if (!(error instanceof TypeError || error instanceof RangeError)) throw error
          if (![0, 1, 3, 4, 5].includes(operation)) throw error
          rejected++
        }
        expect(project).toEqual(before)
        if (next) {
          expect(validateStudioProject(next), `seed=${seed} batch=${batch} step=${step} operation=${operation}`).toBe(true)
          if (operation !== 9 && operation !== 10) { history.push(project); past.push(beforeMusic); future.length = 0; if (past.length > 12) past.shift() }
          project = next; successful++
        }
        const actual = compileArrangement(project).map(note => [note.clipId, note.sourceNoteId, note.startTick, note.durationTicks, note.pitch, note.velocity])
        const expected = project.clips.flatMap(c => project.patterns.find(p => p.id === c.patternId)!.notes.map(n => [c.id, n.id, c.startTick + n.startTick, n.durationTicks, n.pitch, n.velocity])).sort((a, b) => Number(a[2]) - Number(b[2]))
        expect(actual).toEqual(expected)
        expect(project.ideas[0].original).toEqual(before.ideas[0].original)
        expect(history.size).toBeLessThanOrEqual(12)
        expect(history.bytes).toBeLessThanOrEqual(128 * 1024)
      }
    }
    expect(successful).toBeGreaterThan(7000)
    expect(rejected).toBeGreaterThan(1000)
  }, 30_000)

  it('rejects malformed nested imports and recovery without changing source; clones valid recovery', () => {
    const rng = random(seed), base = createStudioProject()
    base.ideas = [createTextIdea('preserved across recovery')]
    const mutations: ((p: StudioProject) => void)[] = [
      p => { p.tracks[0].expression = [{ tick: 0, value: NaN }] },
      p => { p.patterns[0].notes = [null as never] },
      p => { p.clips[0].patternId = 'missing' },
      p => { p.ideas[0].original = { kind: 'midi', events: [null] } as never },
      p => { p.guidance = [] as never },
      p => { p.tracks[0].pan = Infinity },
      p => { p.patterns[0].lengthTicks = -Infinity },
      p => { p.clips[0].startTick = Number.MAX_VALUE },
      p => { p.revision = Number.MAX_SAFE_INTEGER + 1 },
      p => { p.bars = .5 },
    ]
    for (let i = 0; i < 1000; i++) {
      const raw = structuredClone(base); mutations[Math.floor(rng() * mutations.length)](raw)
      const before = structuredClone(raw)
      expect(validateStudioProject(raw)).toBe(false)
      expect(() => decodeStudioProject(raw)).toThrow()
      expect(() => decodeRecovery(JSON.stringify(raw))).toThrow()
      expect(raw).toEqual(before)
    }
    for (const bytes of [new Uint8Array(), new Uint8Array([0xff]), new Uint8Array([0x50, 0x4b, 0, 1]), new TextEncoder().encode('[[[[null]]]]')]) expect(() => decodeRecovery(bytes)).toThrow()
    const restored = decodeRecovery(JSON.stringify(base))
    expect(restored.kind).toBe('project')
    if (restored.kind !== 'project') throw new Error('Expected project')
    restored.project.tracks[0].name = 'independent'
    expect(base.tracks[0].name).toBe('Piano')
    const continued = createCleanContinuation(base)
    expect(continued.id).not.toBe(base.id)
    expect(continued.ideas).toEqual([])
    expect(base.ideas).toHaveLength(1)
  })
})
