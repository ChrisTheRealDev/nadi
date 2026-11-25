import { describe, expect, it } from 'vitest'
import { patchNotesPanelView, type NotesPanelView } from './notesPanelState'

describe('same-event note destination updates', () => {
  it('retains bar and cursor when selection changes before a render', () => {
    let views: Record<string, NotesPanelView> = {}
    views = patchNotesPanelView(views, 'project:part', { bar: 2 }).views
    views = patchNotesPanelView(views, 'project:part', { cursor: 3960 }).views
    views = patchNotesPanelView(views, 'project:part', { primary: 'chord-root' }).views
    expect(views['project:part']).toEqual({ bar: 2, visible: 4, primary: 'chord-root', cursor: 3960 })
  })
  it('preserves another part and treats explicit selection clearing as a change', () => {
    const first = patchNotesPanelView({}, 'one', { bar: 3, primary: 'one-note' }).views
    const second = patchNotesPanelView(first, 'two', { bar: 7, cursor: 13440 }).views
    const third = patchNotesPanelView(second, 'one', { primary: null }).views
    expect(third.one).toEqual({ bar: 3, visible: 4, primary: null, cursor: 0 })
    expect(third.two).toEqual(second.two)
    expect(first.one.primary).toBe('one-note')
  })
})
