import { TICKS_PER_BAR, type PatternNote } from './model'
export function practiceProgress(notes: Pick<PatternNote, 'startTick'>[]) {
  const targets = [0, 1, 2, 3].map(beat => beat * TICKS_PER_BAR / 4)
  const firstBar = notes.filter(note => note.startTick >= 0 && note.startTick < TICKS_PER_BAR)
  const matched = targets.filter(tick => firstBar.some(note => note.startTick === tick)).length
  const extra = firstBar.length - matched
  return { matched, extra, complete: matched === 4 && extra === 0 }
}
