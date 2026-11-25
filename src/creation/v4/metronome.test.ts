import { describe, expect, it } from 'vitest'
import { defaultNotation, DEFAULT_MEASURE } from './notationModel'
import { countInSchedule, metronomeWindow, pulseAt } from './metronome'
const project = { bars: 4 }
describe('meter-aware audio-clock clicks', () => {
  it('does not duplicate clicks at adjacent scheduling windows', () => {
    const range = { startTick: 0, endTick: 3840 }
    expect([...metronomeWindow(project, 0, 480, range, false), ...metronomeWindow(project, 480, 1921, range, false)]).toEqual([{ tick: 0, accent: true }, { tick: 480, accent: false }, { tick: 960, accent: false }, { tick: 1440, accent: false }, { tick: 1920, accent: true }])
  })
  it('groups compound meter and counts complete bars', () => {
    const p = { bars: 4, notation: { ...defaultNotation(), measures: [{ ...DEFAULT_MEASURE, beats: 6, beatType: 8 as const }] } }
    expect(countInSchedule(p, 0, 2)).toMatchObject({ durationTicks: 2880, pulseTicks: 720, pulses: [{ tick: 0, accent: true }, { tick: 720, accent: false }, { tick: 1440, accent: true }, { tick: 2160, accent: false }] })
    expect(pulseAt(p, 800).beat).toBe(1)
    expect(countInSchedule(p, 0, 0).pulses).toEqual([])
  })
  it('retains absolute accent phase at partial-bar loop boundaries', () => {
    expect(metronomeWindow(project, 0, 2000, { startTick: 480, endTick: 1920 }, true, 480)).toEqual([{ tick: 0, accent: false }, { tick: 480, accent: false }, { tick: 960, accent: false }, { tick: 1440, accent: false }, { tick: 1920, accent: false }])
  })
  it('follows a meter change without an extra click past the range', () => {
    const p = { bars: 4, notation: { ...defaultNotation(), measures: [DEFAULT_MEASURE, { ...DEFAULT_MEASURE, beats: 3 }] } }
    expect(metronomeWindow(p, 1800, 4000, { startTick: 0, endTick: 3360 }, false)).toEqual([{ tick: 1920, accent: true }, { tick: 2400, accent: false }, { tick: 2880, accent: false }])
  })
})
