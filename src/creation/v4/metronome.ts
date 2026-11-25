import { scoreMeterAtTick, type NotatedProject } from './notationModel'

export interface MetronomeSettings { volume: number; accent: boolean; countInBars: 0 | 1 | 2 }
export const DEFAULT_METRONOME: MetronomeSettings = { volume: 0.7, accent: true, countInBars: 1 }
export function pulseAt(project: NotatedProject, tick: number) {
  const meter = scoreMeterAtTick(project, Math.max(0, tick))
  const group = meter.beatType === 8 && meter.beats > 3 && meter.beats % 3 === 0 ? 3 : 1
  const pulseTicks = 1920 / meter.beatType * group
  return { ...meter, pulseTicks, pulses: meter.beats / group, beat: Math.floor((tick - meter.startTick) / pulseTicks) }
}
/** Audio-clock windows are half-open, so adjacent pumps never schedule a click twice. */
export function metronomeWindow(project: NotatedProject, from: number, to: number, range: { startTick: number; endTick: number }, loop: boolean, loopOffset = 0): { tick: number; accent: boolean }[] {
  const result: { tick: number; accent: boolean }[] = []
  const length = range.endTick - range.startTick
  if (!Number.isFinite(from + to + length + loopOffset) || length <= 0 || from < 0 || to <= from) return result
  let cursor = from
  while (cursor < to) {
    const phase = loop ? (cursor + loopOffset) % length : cursor
    if (!loop && phase >= length) break
    const absolute = range.startTick + phase
    const boundary = Math.min(to, cursor + length - phase)
    const meter = pulseAt(project, absolute)
    const first = meter.startTick + Math.ceil((absolute - meter.startTick) / meter.pulseTicks) * meter.pulseTicks
    const segmentEnd = Math.min(boundary, cursor + meter.endTick - absolute)
    for (let at = first; at < meter.endTick && cursor + at - absolute < segmentEnd; at += meter.pulseTicks) {
      result.push({ tick: cursor + at - absolute, accent: at === meter.startTick })
    }
    if (segmentEnd <= cursor) break
    cursor = segmentEnd
  }
  return result
}
export function countInSchedule(project: NotatedProject, tick: number, bars: 0 | 1 | 2) {
  const meter = pulseAt(project, tick)
  return { durationTicks: (meter.endTick - meter.startTick) * bars, pulses: Array.from({ length: meter.pulses * bars }, (_, i) => ({ tick: i * meter.pulseTicks, accent: i % meter.pulses === 0 })), pulseTicks: meter.pulseTicks }
}
