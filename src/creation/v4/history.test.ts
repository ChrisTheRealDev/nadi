import { describe, expect, it } from 'vitest'
import { createTextIdea } from '../ideas'
import { createStudioProject } from './model'
import { StudioHistory } from './history'

describe('bounded original-preserving graph history', () => {
  it('matches an independent undo/redo name ledger across 600 deterministic edits and branches', () => {
    const history = new StudioHistory(12)
    let current = createStudioProject(), seed = 731
    const past: string[] = [], future: string[] = []
    for (let step = 0; step < 600; step++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const action = (seed >>> 16) % 4, oldRevision = current.revision
      if (action < 2) {
        history.push(current)
        past.push(current.name); future.length = 0
        if (past.length > 12) past.shift()
        current = { ...current, name: `Edit ${step}`, revision: oldRevision + 1 }
      } else {
        const from = action === 2 ? past : future, to = action === 2 ? future : past
        const expected = from.pop()
        const actual = action === 2 ? history.undo(current) : history.redo(current)
        if (expected === undefined) expect(actual).toBeUndefined()
        else {
          to.push(current.name)
          expect(actual?.name).toBe(expected)
          expect(actual?.revision).toBe(oldRevision + 1)
          current = actual!
        }
      }
      expect(history.availability).toEqual({ undo: past.length > 0, redo: future.length > 0 })
      expect(history.size).toBe(past.length + future.length)
    }
  })
  it('retains undo and redo stacks when rejected travel or push is followed by a valid branch', () => {
    const original = createStudioProject(), history = new StudioHistory()
    history.push(original, { label: 'First edit' })
    const first = { ...structuredClone(original), name: 'First', revision: 1 }
    history.push(first, { label: 'Second edit' })
    const second = { ...structuredClone(first), name: 'Second', revision: 2 }
    const undone = history.undo(second)!
    expect(undone.name).toBe('First')
    const bytes = history.bytes
    expect(() => history.redo(createStudioProject())).toThrow(/different project/)
    expect(() => history.push({ ...undone, bpm: NaN })).toThrow()
    expect(history.bytes).toBe(bytes)
    expect(history.availability).toEqual({ undo: true, redo: true })
    expect(history.redo(undone)?.name).toBe('Second')
    const branchBase = history.undo({ ...second, revision: 4 })!
    history.push(branchBase, { label: 'Branch edit' })
    const branch = { ...structuredClone(branchBase), name: 'Branch', revision: 6 }
    expect(history.redo(branch)).toBeUndefined()
    expect(history.undo(branch)?.name).toBe('First')
  })
  it('does not let mutation of a returned graph or rejected original rewrite poison later travel', () => {
    const original = createStudioProject(); original.ideas = [createTextIdea('Raw capture')]
    const history = new StudioHistory(); history.push(original)
    const edited = { ...structuredClone(original), name: 'Edited', revision: 1 }
    const undone = history.undo(edited)!
    undone.patterns[0].name = 'Mutated returned graph'
    const alteredOriginal = structuredClone(undone)
    alteredOriginal.ideas[0].original = { kind: 'text', text: 'Rewritten capture' }
    expect(() => history.redo(alteredOriginal)).toThrow(/original capture/)
    const redone = history.redo(undone)!
    expect(redone.patterns).toEqual(edited.patterns)
    expect(redone.ideas[0].original).toEqual(original.ideas[0].original)
    expect(history.undo(redone)?.patterns[0].name).toBe('Mutated returned graph')
  })
  it('undoes and redoes without deleting later originals or leaking mutable snapshots', () => {
    const before = createStudioProject(), current = structuredClone(before), history = new StudioHistory()
    history.push(before); before.name = 'mutated caller'
    current.name = 'edited'; current.revision = 3; current.ideas = [createTextIdea('kept capture')]
    const undone = history.undo(current)!
    expect(undone.name).not.toBe('mutated caller'); expect(undone.ideas).toEqual(current.ideas); expect(undone.revision).toBe(4)
    expect(history.availability).toEqual({ undo: false, redo: true })
    const redone = history.redo(undone)!
    expect(redone.name).toBe('edited'); expect(redone.ideas).toEqual(current.ideas)
    expect(history.undo(redone)?.name).toBe(undone.name)
  })
  it('limits whole snapshots by count and encoded byte budget', () => {
    const project = createStudioProject(), history = new StudioHistory(2)
    for (let i = 0; i < 4; i++) history.push({ ...project, name: `${i}` })
    expect(history.size).toBe(2)
    expect(history.undo(project)?.name).toBe('3')
    history.push(project); expect(history.availability.redo).toBe(false)
    const tiny = new StudioHistory(100, 1); tiny.push(project)
    expect(tiny.size).toBe(0); expect(tiny.bytes).toBe(0)
  })
  it('interns originals once while rejecting identity rewrites and other project histories', () => {
    const project = createStudioProject(); project.ideas = [createTextIdea('X'.repeat(12000))]
    const history = new StudioHistory(); history.push(project)
    const first = history.bytes
    history.push({ ...project, name: 'next' })
    expect(history.bytes - first).toBeLessThan(3000)
    const corrupt = structuredClone(project); corrupt.ideas[0].original = { kind: 'text', text: 'changed' }
    expect(() => history.push(corrupt)).toThrow(/rewrite/)
    expect(() => history.push(createStudioProject())).toThrow(/Clear/)
    expect(history.size).toBe(2)
    history.clear(); expect(history.size).toBe(0); expect(history.bytes).toBe(0)
  })
})
