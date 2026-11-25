import type { Clip, Pattern } from './model'
const BAR = 1920

/** Stack intersecting clips rather than concealing whichever happened to render first. */
export function stackClips(clips: Clip[], patterns: Pattern[]): { clip: Clip; row: number; length: number }[] {
  const ends: number[] = []
  const lengths = new Map(patterns.map(pattern => [pattern.id, pattern.lengthTicks]))
  return [...clips].sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id)).map(clip => {
    const length = lengths.get(clip.patternId) ?? BAR
    let row = ends.findIndex(end => end <= clip.startTick)
    if (row < 0) row = ends.length
    ends[row] = clip.startTick + length
    return { clip, row, length }
  })
}

/** Snapped movement preserves an existing clip's fractional placement offset. */
export function moveClipTick(original: number, delta: number, snap: number, length: number): number {
  return Math.max(0, Math.min(256 * BAR - length, original + (snap ? Math.round(delta / snap) * snap : Math.round(delta))))
}
