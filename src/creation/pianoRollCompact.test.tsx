import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PianoRoll } from './PianoRoll'
import { savePianoRollView } from './pianoRollViewState'
import type { Note } from './model'

const notes: Note[] = [60, 64, 67].map((pitch, i) => ({ id: `compact-${i}`, instrument: 'piano', pitch, startTick: 0, durationTicks: 480, velocity: 90 }))
describe('compact note editor', () => {
  it('exposes note actions inline while keeping detailed properties collapsed', () => {
    const html = renderToStaticMarkup(<PianoRoll compact notes={[]} bars={4} selectedBar={0} selectedId={null} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(html).not.toContain('<summary>More</summary>')
    expect(html).toContain('Select all')
    expect(html).toContain('Octave −')
    expect(html).toContain('<details class="note-properties is-compact"><summary>Note properties</summary>')
    expect(html).not.toContain('compact-selection-actions')
    expect(html).toContain('data-help-target="piano-roll"')
  })
  it('restores the complete chord and separates group movement from individual pitch', () => {
    savePianoRollView('compact-test:chord', { cursor: { pitch: 60, tick: 0 }, primary: notes[0].id, selectedIds: notes.map(note => note.id), rowHeight: 22, scrollTop: 1386, scrollLeft: 0 })
    const change = vi.fn()
    const html = renderToStaticMarkup(<PianoRoll compact stateKey="compact-test:chord" notes={notes} bars={4} selectedBar={0} selectedId={notes[0].id} onChange={change} onSelection={vi.fn()} />)
    expect(html.match(/class="roll-note is-selected"/g)).toHaveLength(3)
    expect(html).toContain('Move all selected')
    expect(html).toContain('Length (beats) · all selected')
    expect(html).toContain('Strength · all selected')
    expect(html).toContain('<details class="individual-note"><summary>Individual note')
    expect(html).not.toContain('>Delete note</button>')
    expect(change).not.toHaveBeenCalled()
  })
})
