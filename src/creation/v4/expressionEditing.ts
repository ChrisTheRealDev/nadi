import type { ExpressionPoint } from './model'

export function putExpressionPoint(points: readonly ExpressionPoint[], point: ExpressionPoint): ExpressionPoint[] {
  return [...points.filter(item => item.tick !== point.tick), point].sort((a, b) => a.tick - b.tick)
}

export function expressionAt(points: readonly ExpressionPoint[], tick: number): number {
  if (!points.length) return 1
  if (tick <= points[0].tick) return points[0].value
  for (let i = 1; i < points.length; i++) if (tick <= points[i].tick) {
    const a = points[i - 1], b = points[i]
    return a.value + (b.value - a.value) * (tick - a.tick) / (b.tick - a.tick)
  }
  return points[points.length - 1].value
}

/** Reject stale numeric drafts after a length change; never relocate them silently. */
export function expressionEntryPoint(bar: number, beat: number, strength: number, bars: number): ExpressionPoint {
  if (!Number.isSafeInteger(bar) || bar < 1 || bar > bars || !Number.isFinite(beat) || beat < 1 || beat >= 5 || !Number.isSafeInteger(strength) || strength < 0 || strength > 100) {
    throw new RangeError('Choose a song bar inside this project, a beat from 1 to below 5, and a whole-number gain from 0 to 100%.')
  }
  return { tick: Math.round((bar - 1) * 1920 + (beat - 1) * 480), value: strength / 100 }
}
