import { describe, expect, it } from 'vitest'
import { createStudioProject } from './model'
import { emptyEditingViews, noteView, patchNoteView, resolvePlayback } from './editingContext'
describe('authoritative editor context and transport', () => {
  const project = () => { const p = createStudioProject(); p.bars = 12; p.clips[0].startTick = 3840; p.patterns[0].lengthTicks = 8 * 1920; return p }
  it('restores the exact cursor after choosing another destination, including off-grid timing', () => {
    const p = project(), id = p.clips[0].id
    const views = patchNoteView(p, id, emptyEditingViews(), { bar: 5, cursor: 9701, visible: 2 })
    expect(noteView(p, undefined, views).cursor).toBe(0)
    expect(noteView(p, id, views)).toMatchObject({ bar: 5, cursor: 9701, visible: 2 })
  })
  it('converts Notes local bars once, independent of a conflicting manual range', () => {
    const p = project(), id = p.clips[0].id
    const views = patchNoteView(p, id, emptyEditingViews(), { bar: 4 })
    const r = resolvePlayback(p, views, { mode: 'song', cursor: 0, range: { startTick: 0, endTick: 1920 }, loop: { panel: 'notes', clipId: id } })
    expect(r.loopRange).toEqual({ startTick: 11520, endTick: 19200 })
    expect(r.label).toBe('Loop: Notes · song bars 7–10')
  })
  it('uses absolute drum range regardless of the selected melodic clip', () => {
    const p = project(), views = { ...emptyEditingViews(), drums: { bar: 4, visible: 2 as const } }
    const r = resolvePlayback(p, views, { mode: 'part', clipId: p.clips[0].id, cursor: 0, loop: { panel: 'drums' } })
    expect(r.loopRange).toEqual({ startTick: 7680, endTick: 11520 }); expect(r.clipIds).toBeUndefined()
  })
  it('resumes inside a pinned loop without changing the stop return position', () => {
    const p = project(), r = resolvePlayback(p, emptyEditingViews(), { mode: 'song', cursor: 0, loop: { panel: 'drums' }, resume: 123 })
    expect(r.startTick).toBe(123); expect(r.returnTick).toBe(0)
  })
  it('clamps remembered note cursor after shortening a part', () => {
    const p = project(), views = patchNoteView(p, p.clips[0].id, emptyEditingViews(), { bar: 7, cursor: 14000 })
    p.patterns[0].lengthTicks = 1920
    expect(noteView(p, p.clips[0].id, views)).toMatchObject({ bar: 0, cursor: 1919 })
  })
  it('rejects invalid explicit ranges and missing part destinations', () => {
    const p = project()
    expect(() => resolvePlayback(p, emptyEditingViews(), { mode: 'song', cursor: 0, range: { startTick: 1920, endTick: 0 } })).toThrow()
    expect(() => resolvePlayback(p, emptyEditingViews(), { mode: 'part', cursor: 0, clipId: 'missing' })).toThrow()
  })
})
