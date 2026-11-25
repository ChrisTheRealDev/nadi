import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PianoRoll } from './PianoRoll'
import type { Note } from './model'

describe('piano roll accessible surface', () => {
  it('exposes an explicit cursor placement action and disables it with the editor', () => {
    const change = vi.fn()
    const normal = renderToStaticMarkup(<PianoRoll notes={[]} bars={4} selectedBar={0} selectedId={null} onChange={change} onSelection={vi.fn()} />)
    expect(normal).toContain('>Place C4 at bar 1 beat 1</button>')
    const disabled = renderToStaticMarkup(<PianoRoll notes={[]} bars={4} selectedBar={0} selectedId={null} disabled onChange={change} onSelection={vi.fn()} />)
    expect(disabled).toMatch(/<button[^>]*disabled=""[^>]*>Place C4 at bar 1 beat 1<\/button>/)
    expect(change).not.toHaveBeenCalled()
  })

  it('targets the selected note body and real right-edge handle in the intended part', () => {
    const note: Note = { id: 'chosen', instrument: 'piano', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }
    const html = renderToStaticMarkup(<PianoRoll notes={[note]} bars={4} selectedBar={0} selectedId={note.id} helpDestination={{ trackId: 'piano-track', clipId: 'opening' }} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(html).toContain('data-help-target="note-body"')
    expect(html).toContain('data-help-target="note-resize"')
    expect(html).toContain('data-help-track-id="piano-track" data-help-clip-id="opening"')
    const continuation = renderToStaticMarkup(<PianoRoll notes={[{ ...note, durationTicks: 4000 }]} bars={4} selectedBar={0} visibleBars={1} selectedId={note.id} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(continuation).not.toContain('data-help-target="note-resize"')
  })
  it('offers all 128 MIDI pitches rather than hiding notes outside a beginner keyboard', () => {
    const change = vi.fn()
    const html = renderToStaticMarkup(<PianoRoll notes={[]} bars={4} selectedBar={0} selectedId={null} onChange={change} onSelection={vi.fn()} />)
    expect(html.match(/class="roll-placement"/g)).toHaveLength(128)
    expect(html).toContain('Place C-1 in bar 1')
    expect(html).toContain('Place G9 in bar 1')
    expect(html).toContain('data-help-target="piano-roll"')
    const placements = html.match(/<button[^>]*class="roll-placement"[^>]*>/g) ?? []
    expect(placements.filter(button => button.includes('tabindex="0"'))).toHaveLength(1)
    expect(placements.find(button => button.includes('tabindex="0"'))).toContain('data-placement-pitch="60"')
    expect(html).toContain('Enter places')
    expect(html).toContain('Selected notes:')
    expect(change).not.toHaveBeenCalled()
  })
  it('shows sustained notes in subsequent bars without rewriting their absolute timing', () => {
    const note: Note = { id: 'sustain', instrument: 'piano', pitch: 20, startTick: 137, durationTicks: 2401, velocity: 87 }
    const original = structuredClone(note), notes = [note], change = vi.fn()
    const html = renderToStaticMarkup(<PianoRoll notes={notes} bars={4} selectedBar={1} selectedId={null} onChange={change} onSelection={vi.fn()} />)
    expect(html).toContain('Select G#0, tick 137, length 2401, velocity 87')
    expect(notes).toEqual([original])
    expect(change).not.toHaveBeenCalled()
  })
  it('keeps the actual inspector selection on a fresh mount when parent selection is retained', () => {
    const note: Note = { id: 'retained', instrument: 'piano', pitch: 60, startTick: 137, durationTicks: 480, velocity: 90 }
    const mount = () => renderToStaticMarkup(<PianoRoll notes={[note]} bars={4} selectedBar={0} selectedId={note.id} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(mount()).toContain('Selected note start tick')
    // Each server render is a separate component mount, as when switching editors.
    expect(mount()).toContain('Selected note start tick')
    const removed = renderToStaticMarkup(<PianoRoll notes={[]} bars={4} selectedBar={0} selectedId={note.id} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(removed).not.toContain('Selected note start tick')
    const differentBar = renderToStaticMarkup(<PianoRoll notes={[note]} bars={4} selectedBar={1} selectedId={note.id} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(differentBar).not.toContain('Selected note start tick')
  })

  it('renders four-bar composing controls, stable gesture hooks, and playhead', () => {
    const notes: Note[] = [
      { id: 'overlap-a', instrument: 'piano', pitch: 60, startTick: 1910, durationTicks: 900, velocity: 90 },
      { id: 'overlap-b', instrument: 'piano', pitch: 60, startTick: 1910, durationTicks: 900, velocity: 70 },
    ]
    const html = renderToStaticMarkup(<PianoRoll notes={notes} bars={8} selectedBar={1} startBar={1} visibleBars={4} selectedId="overlap-a" playhead={2400} playing onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(html).toContain('aria-label="Note tools"')
    expect(html).toContain('aria-pressed="true">Draw')
    expect(html).toContain('<option value="120" selected="">¼ beat</option>')
    expect(html).toContain('B2 · 1')
    expect(html).toContain('B5 · 4')
    expect(html).toContain('class="roll-playhead is-playing"')
    expect(html.match(/data-note-id="overlap-/g)).toHaveLength(2)
    expect(html).toContain('data-resize-note="overlap-a"')
    expect(html).toContain('Delete selected')
    expect(html).toContain('Select chord')
    expect(html).toContain('Select all')
    expect(html).toContain('Ctrl/Cmd+A in the editor')
    expect(html).toContain('Drag any selected note to move the group')
    expect(html).toContain('Advanced · exact ticks')
  })

  it('marks sustained edges without placing them over pitch labels or exposing an off-window resize edge', () => {
    const before: Note = { id: 'before', instrument: 'piano', pitch: 60, startTick: 120, durationTicks: 2200, velocity: 90 }
    const after: Note = { id: 'after', instrument: 'piano', pitch: 61, startTick: 3600, durationTicks: 1000, velocity: 90 }
    const html = renderToStaticMarkup(<PianoRoll notes={[before, after]} bars={4} selectedBar={1} startBar={1} visibleBars={1} selectedId={null} onChange={vi.fn()} onSelection={vi.fn()} />)
    expect(html).toContain('data-continues-before="true"')
    expect(html).toContain('data-continues-after="true"')
    expect(html).not.toContain('data-resize-note="after"')
    expect(html).toContain('left:0%')
  })
})
