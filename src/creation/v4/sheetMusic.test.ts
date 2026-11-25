import { describe, expect, it } from 'vitest'
import { createStudioProject, defaultTrackProduction } from './model'
import { createSheetMusic } from './sheetMusic'
import { defaultNotation, DEFAULT_MEASURE } from './notationModel'

function fixture() {
  const p = createStudioProject()
  p.name = 'A < B & music'
  p.patterns[0].notes = [
    { id: 'a', pitch: 60, startTick: 0, durationTicks: 2400, velocity: 90 },
    { id: 'b', pitch: 64, startTick: 0, durationTicks: 2400, velocity: 90 },
    { id: 'c', pitch: 48, startTick: 0, durationTicks: 960, velocity: 90 },
    { id: 'd', pitch: 67, startTick: 480, durationTicks: 480, velocity: 90 },
  ]
  return p
}
describe('sheet music projection', () => {
  it('preserves the source, escapes titles, emits piano staves, chords, independent voices and cross-bar ties', () => {
    const p = fixture(), before = structuredClone(p), s = createSheetMusic(p)
    expect(p).toEqual(before)
    expect(s).toMatchObject({ bars: 2, noteCount: 4, roundedNotes: 0, partCount: 1 })
    expect(s.xml).toContain('A &lt; B &amp; music')
    expect(s.xml).toContain('<staves>2</staves>')
    expect(s.xml).toContain('<chord/>')
    expect(s.xml).toContain('<backup><duration>1920</duration></backup>')
    expect(s.xml).toContain('<tie type="start"/>')
    expect(s.xml).toContain('<tie type="stop"/>')
  })
  it('expands repeated clips and ignores unplaced patterns and private originals', () => {
    const p = fixture(); p.patterns[0].lengthTicks = 3840
    p.clips.push({ ...p.clips[0], id: 'repeat', startTick: 3840 })
    p.patterns.push({ ...p.patterns[0], id: 'unplaced', notes: [{ id: 'private', pitch: 90, startTick: 0, durationTicks: 120, velocity: 90 }] })
    const s = createSheetMusic(p)
    expect(s.noteCount).toBe(8); expect(s.bars).toBe(4)
    expect(s.xml).not.toContain('private')
  })
  it('quantizes tiny off-grid notes without losing them or exceeding the project', () => {
    const p = fixture(); p.patterns[0].notes = [{ id: 'tiny', pitch: 61, startTick: 7679, durationTicks: 1, velocity: 90 }]
    const s = createSheetMusic(p, { grid: 60, spelling: 'flats' })
    expect(s.roundedNotes).toBe(1); expect(s.bars).toBe(4)
    expect(s.xml).toContain('<step>D</step><alter>-1</alter>')
    expect(s.xml).toContain('<type>32nd</type>')
  })
  it('includes muted tracks and provides individual concert-pitch parts and percussion', () => {
    const p = fixture()
    p.tracks.push({ id: 'drums', name: 'Hi-hat', color: '#ffffff', soundId: 'hat', soundVersion: 1, level: 100, muted: true, hidden: false, ...defaultTrackProduction() })
    p.patterns.push({ id: 'drumpart', trackId: 'drums', name: 'drums', lengthTicks: 1920, notes: [{ id: 'hit', pitch: 42, startTick: 0, durationTicks: 120, velocity: 90 }] })
    p.clips.push({ id: 'drumclip', trackId: 'drums', patternId: 'drumpart', startTick: 0 })
    expect(createSheetMusic(p).partCount).toBe(2)
    const s = createSheetMusic(p, { trackId: 'drums', grid: 120, spelling: 'sharps' })
    expect(s.noteCount).toBe(1); expect(s.xml).toContain('<unpitched>'); expect(s.xml).toContain('<notehead>x</notehead>')
  })
  it('writes meter and key only initially or when they change', () => {
    const p = fixture()
    p.version = 6; p.notation = defaultNotation()
    p.notation.measures = [{ ...DEFAULT_MEASURE }, { ...DEFAULT_MEASURE }]
    const unchanged = createSheetMusic(p).xml
    expect(unchanged.match(/<time>/g)).toHaveLength(1)
    expect(unchanged.match(/<key>/g)).toHaveLength(1)
    p.notation.measures[1] = { ...DEFAULT_MEASURE, beats: 3, keyFifths: 2 }
    const changed = createSheetMusic(p).xml
    expect(changed.match(/<time>/g)).toHaveLength(2)
    expect(changed.match(/<key>/g)).toHaveLength(2)
    expect(changed).toContain('<beats>3</beats>')
    expect(changed).toContain('<fifths>2</fifths>')
  })
  it('rejects an empty score with an actionable message', () => {
    expect(() => createSheetMusic(createStudioProject())).toThrow('no arranged notes')
  })
})

