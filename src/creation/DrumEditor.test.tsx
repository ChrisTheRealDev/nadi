import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { addDrumHit, drumEditorStateSignature, DrumEditor, eraseDrumHits, removeDrumHit, visibleDrumHits } from './DrumEditor'
import type { Note } from './model'

const hit = (id: string, instrument: 'kick' | 'snare' | 'hat', startTick: number): Note => ({
  id, instrument, startTick, pitch: instrument === 'kick' ? 36 : instrument === 'snare' ? 38 : 42, durationTicks: 60, velocity: 90,
})

describe('drum editor operations', () => {
  it('adds a 120-tick-grid hit without changing existing notes and grows the project only when needed', () => {
    const original = [hit('existing', 'snare', 120)]
    const snapshot = structuredClone(original)
    const first = addDrumHit(original, 4, 'kick', 240, 'new-hit')
    expect(first.note).toEqual({ id: 'new-hit', instrument: 'kick', pitch: 36, startTick: 240, durationTicks: 60, velocity: 90 })
    expect(first.bars).toBe(4)
    expect(original).toEqual(snapshot)
    expect(addDrumHit(original, 4, 'hat', 4 * 1920, 'later').bars).toBe(5)
  })

  it('removes only the addressed hit when exact-time hits overlap', () => {
    const notes = [hit('one', 'kick', 0), hit('two', 'kick', 0), hit('three', 'snare', 0)]
    expect(removeDrumHit(notes, 'one').map(note => note.id)).toEqual(['two', 'three'])
    expect(notes).toHaveLength(3)
  })

  it('batches a swept erase set into one pure result and retains hidden or unrelated notes', () => {
    const piano: Note = { id: 'piano', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }
    const notes = [hit('visible-a', 'kick', 0), hit('visible-b', 'hat', 137), hit('outside', 'snare', 9000), piano]
    const erased = eraseDrumHits(notes, new Set(['visible-a', 'visible-b']))
    expect(erased.map(note => note.id)).toEqual(['outside', 'piano'])
    expect(notes).toHaveLength(4)
    expect(eraseDrumHits(notes, new Set())).toBe(notes)
  })

  it('selects visible exact starts without quantizing off-grid timing', () => {
    const notes = [hit('before', 'kick', 1919), hit('at-start', 'kick', 1920), hit('off-grid', 'hat', 2057), hit('at-end', 'snare', 3840)]
    expect(visibleDrumHits(notes, 1, 1).map(note => [note.id, note.startTick])).toEqual([['at-start', 1920], ['off-grid', 2057]])
  })

  it('rejects invalid placement ticks at the pure operation boundary', () => {
    expect(() => addDrumHit([], 1, 'kick', -1, 'bad')).toThrow(RangeError)
    expect(() => addDrumHit([], 1, 'kick', 1.5, 'bad')).toThrow(RangeError)
  })

  it('invalidates an erase snapshot after any note field or shown-range change', () => {
    const notes = [hit('kick', 'kick', 0), { ...hit('piano', 'kick', 120), instrument: 'piano' as const, pitch: 60 }]
    const baseline = drumEditorStateSignature(notes, 4, 0, 4)
    expect(drumEditorStateSignature(notes.map(note => note.id === 'piano' ? { ...note, pitch: 61 } : note), 4, 0, 4)).not.toBe(baseline)
    expect(drumEditorStateSignature(notes, 4, 1, 2)).not.toBe(baseline)
    expect(drumEditorStateSignature(notes, 5, 0, 4)).not.toBe(baseline)
  })
})

describe('drum editor surface', () => {
  const renderEditor = (notes: Note[] = []) => renderToStaticMarkup(<DrumEditor
    notes={notes}
    bars={4}
    startBar={0}
    visibleBars={4}
    playhead={0}
    playing={false}
    previewEnabled
    onChange={vi.fn()}
    onPreview={vi.fn()}
    onMessage={vi.fn()}
    onUndo={vi.fn()}
  />)

  it('renders a four-bar ruler with four beats per bar and compatible first-bar step names', () => {
    const html = renderEditor()
    expect(html.match(/<em>Bar [1-4]<\/em>/g)).toHaveLength(4)
    expect(html.match(/<b>Beat [1-4]<\/b>/g)).toHaveLength(16)
    expect(html).toContain('aria-label="Kick step 1"')
    expect(html).toContain('aria-label="Snare step 1"')
    expect(html).toContain('aria-label="Hi-hat step 1"')
    expect(html).toContain('data-help-target="drum-tools"')
    expect(html).toContain('data-help-target="drum-timeline"')
  })

  it('renders off-grid and overlapping hits as separate exact-time controls', () => {
    const html = renderEditor([hit('off-grid', 'hat', 137), hit('overlap-a', 'kick', 0), hit('overlap-b', 'kick', 0)])
    expect(html).toContain('data-drum-note-id="off-grid"')
    expect(html).toContain('Hi-hat off-grid hit at bar 1, beat 1 + 137 ticks')
    expect(html).toContain('data-drum-note-id="overlap-a"')
    expect(html).toContain('data-drum-note-id="overlap-b"')
    expect(html).toContain('Kick overlapping hit 2 at bar 1, beat 1')
    expect(html.match(/data-drum-note-id=/g)).toHaveLength(3)
  })
})
