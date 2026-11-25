export const A_MINOR_PITCH_CLASSES = [0, 4, 9] as const
export const A_MAJOR_PITCH_CLASSES = [1, 4, 9] as const

export function pitchClass(note: number): number {
  return ((Math.round(note) % 12) + 12) % 12
}

export function uniquePitchClasses(notes: readonly number[]): number[] {
  return [...new Set(notes.map(pitchClass))].sort((a, b) => a - b)
}

export function chordMatches(
  notes: readonly number[],
  expected: readonly number[],
): boolean {
  const actualClasses = uniquePitchClasses(notes)
  const expectedClasses = uniquePitchClasses(expected)
  return (
    actualClasses.length === expectedClasses.length &&
    actualClasses.every((value, index) => value === expectedClasses[index])
  )
}

export function isAMinor(notes: readonly number[]): boolean {
  return chordMatches(notes, A_MINOR_PITCH_CLASSES)
}

export function addCapturedNote(
  notes: readonly number[],
  note: number,
  limit = 4,
): number[] {
  const next = [...notes]
  const existing = next.findIndex(
    (candidate) => pitchClass(candidate) === pitchClass(note),
  )
  if (existing >= 0) {
    next[existing] = note
    return next
  }
  return [...next, note].slice(-limit)
}

export function sortedChordNames(notes: readonly number[]): string[] {
  const names: Record<number, string> = {
    0: 'C',
    1: 'C♯',
    2: 'D',
    3: 'D♯',
    4: 'E',
    5: 'F',
    6: 'F♯',
    7: 'G',
    8: 'G♯',
    9: 'A',
    10: 'A♯',
    11: 'B',
  }
  return uniquePitchClasses(notes).map((note) => names[note])
}
