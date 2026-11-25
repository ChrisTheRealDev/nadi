import { describe, expect, it } from 'vitest'
import { consumePianoRollRestore, initialPianoRollScrollTop, pianoRollPreferences, readPianoRollView, savePianoRollView, setPianoRollPreferences, type PianoRollViewState } from './pianoRollViewState'

const view = (): PianoRollViewState => ({ cursor: { pitch: 64, tick: 1920 }, primary: 'c', selectedIds: ['c', 'e', 'g'], rowHeight: 16, scrollTop: 123, scrollLeft: 4 })
describe('piano roll view state outside panel lifecycles', () => {
  it('defers hidden initialization, then centres an empty part on C4', () => {
    expect(initialPianoRollScrollTop(undefined, [], 22, 0)).toBeUndefined()
    const top = initialPianoRollScrollTop(undefined, [], 22, 360)!
    expect(top).toBe((127 - 60 + .5) * 22 - 180)
    expect((127 - 60) * 22 - top).toBeGreaterThan(0)
    expect((127 - 60) * 22 - top).toBeLessThan(360)
  })
  it('uses existing phrase pitches only without a saved scroll, including an intentional top position', () => {
    expect(initialPianoRollScrollTop(undefined, [48, 60], 22, 360)).toBe((127 - 54 + .5) * 22 - 180)
    expect(initialPianoRollScrollTop(0, [48, 60], 22, 360)).toBe(0)
    expect(initialPianoRollScrollTop(421, [], 16, 600)).toBe(421)
    expect(initialPianoRollScrollTop(undefined, [127], 22, 360)).toBe(0)
    expect(initialPianoRollScrollTop(undefined, [0], 22, 360)).toBe(128 * 22 - 360)
  })
  it('preserves selection and viewport without sharing mutable sets or cursors', () => {
    const original = view(); savePianoRollView('project:part', original)
    original.selectedIds.pop(); original.cursor.pitch = 80
    const restored = readPianoRollView('project:part')!
    expect(restored.selectedIds).toEqual(['c', 'e', 'g']); expect(restored.cursor.pitch).toBe(64)
    restored.selectedIds.pop(); expect(readPianoRollView('project:part')?.selectedIds).toHaveLength(3)
  })
  it('keeps unrelated project/part views independent', () => {
    savePianoRollView('other:part', { ...view(), scrollTop: 456 })
    expect(readPianoRollView('other:part')?.scrollTop).toBe(456)
    expect(readPianoRollView('project:part')?.scrollTop).toBe(123)
    expect(readPianoRollView()).toBeUndefined()
  })
  it('shares explicit editing preferences independently of note selection', () => {
    setPianoRollPreferences({ tool: 'erase', snap: null, hintVisible: false })
    expect(pianoRollPreferences()).toEqual({ tool: 'erase', snap: null, hintVisible: false })
    setPianoRollPreferences({ tool: 'draw', snap: 120, hintVisible: true })
  })
  it('does not replay a consumed undo selection on panel remount', () => {
    expect(consumePianoRollRestore('restore:part', 7)).toBe(true)
    expect(consumePianoRollRestore('restore:part', 7)).toBe(false)
    expect(consumePianoRollRestore('restore:part', 8)).toBe(true)
  })
})
