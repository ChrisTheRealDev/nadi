import { describe, expect, it } from 'vitest'
import { createStudioProject } from './model'
import { createSheetMusic } from './sheetMusic'

function score(notes: { startTick: number; durationTicks: number; pitch?: number }[]) {
  const project = createStudioProject()
  project.tracks[0].soundId = 'flute'
  project.patterns[0].notes = notes.map((note, i) => ({ id: `n${i}`, pitch: 60, velocity: 90, ...note }))
  return createSheetMusic(project, { grid: 1, spelling: 'sharps' }).xml
}
function notes(xml: string) { return [...xml.matchAll(/<note>(.*?)<\/note>/g)].map(match => match[1]) }
function duration(note: string) { return Number(note.match(/<duration>(\d+)<\/duration>/)?.[1]) }

describe('score rhythm spelling', () => {
  it('shows the beat after an opening eighth instead of an offbeat dotted-half rest', () => {
    const output = notes(score([{ startTick: 0, durationTicks: 240 }]))
    expect(output.map(duration)).toEqual([240, 240, 480, 960])
    expect(output.slice(1).every(note => note.includes('<rest/>') && !note.includes('<dot/>'))).toBe(true)
  })
  it('spells the silence before an offbeat note with aligned rests', () => {
    const output = notes(score([{ startTick: 1680, durationTicks: 240 }]))
    expect(output.map(duration)).toEqual([960, 480, 240, 240])
  })
  it('preserves quarter, eighth and dotted-quarter note durations and pitches', () => {
    const output = notes(score([{ startTick: 0, durationTicks: 480, pitch: 60 }, { startTick: 480, durationTicks: 240, pitch: 64 }, { startTick: 720, durationTicks: 720, pitch: 67 }])).filter(note => !note.includes('<rest/>'))
    expect(output.map(duration)).toEqual([480, 240, 720])
    expect(output.map(note => note.match(/<step>(.)<\/step>/)?.[1])).toEqual(['C', 'E', 'G'])
    expect(output[2]).toContain('<type>quarter</type><dot/>')
  })
  it('ties a sustained note across the bar without changing its total duration', () => {
    const output = notes(score([{ startTick: 1680, durationTicks: 480 }])).filter(note => !note.includes('<rest/>'))
    expect(output.map(duration)).toEqual([240, 240])
    expect(output[0]).toContain('<tie type="start"/>')
    expect(output[1]).toContain('<tie type="stop"/>')
  })
})
