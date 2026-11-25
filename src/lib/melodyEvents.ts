export const TICKS_PER_BEAT = 480
export const BEATS_PER_BAR = 4
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR
export const EIGHTH_NOTE_TICKS = TICKS_PER_BEAT / 2

export type MelodyPatternId = 'melody-a' | 'melody-b'
export type MelodyEventSource = 'draw' | 'screen' | 'computer' | 'midi' | 'duplicate' | 'legacy'

export interface MelodyNoteEvent {
  id: string
  pitch: number
  startTick: number
  durationTicks: number
  velocity: number
  trackId: 'melody'
  patternId: MelodyPatternId
  source: MelodyEventSource
  originId?: string
  timingInferred?: boolean
}

export const melodyDurationChoices = [240, 480, 960, 1920] as const
export const scaleNoteNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const

const noteMidi: Record<string, number> = {
  A: 69,
  B: 71,
  C: 72,
  D: 74,
  E: 76,
  F: 77,
  G: 79,
}

const pitchClasses = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const

export function midiForNoteName(note: string): number {
  return noteMidi[note] ?? 69
}

export function midiForNoteNameNear(note: string, currentPitch: number): number {
  const targetClass = ((midiForNoteName(note) % 12) + 12) % 12
  const candidates = Array.from({ length: 128 }, (_, pitch) => pitch)
    .filter((pitch) => pitch % 12 === targetClass)
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate - currentPitch) < Math.abs(closest - currentPitch) ? candidate : closest,
  candidates[0])
}

export function noteNameFromMidi(pitch: number): string {
  return pitchClasses[((Math.round(pitch) % 12) + 12) % 12]
}

export function eventBar(event: MelodyNoteEvent): number {
  return Math.floor(event.startTick / TICKS_PER_BAR)
}

export function tickWithinBar(event: MelodyNoteEvent): number {
  return event.startTick - eventBar(event) * TICKS_PER_BAR
}

export function eventsForBar(events: readonly MelodyNoteEvent[], bar: number): MelodyNoteEvent[] {
  return sortMelodyEvents(events.filter((event) => eventBar(event) === bar))
}

export function eventsForPattern(events: readonly MelodyNoteEvent[], patternId: MelodyPatternId): MelodyNoteEvent[] {
  return sortMelodyEvents(events.filter((event) => event.patternId === patternId))
}

export function sortMelodyEvents(events: readonly MelodyNoteEvent[]): MelodyNoteEvent[] {
  return [...events].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.id.localeCompare(b.id))
}

export function firstAvailableTick(events: readonly MelodyNoteEvent[], bar: number): number | undefined {
  const barStart = bar * TICKS_PER_BAR
  return Array.from({ length: 8 }, (_, index) => barStart + index * EIGHTH_NOTE_TICKS)
    .find((tick) => !events.some((event) => event.startTick === tick))
}

export function clampMelodyEvent(event: MelodyNoteEvent): MelodyNoteEvent {
  const bar = Math.max(0, Math.min(7, eventBar(event)))
  const barStart = bar * TICKS_PER_BAR
  const snapped = Math.round((event.startTick - barStart) / EIGHTH_NOTE_TICKS) * EIGHTH_NOTE_TICKS
  const startTick = barStart + Math.max(0, Math.min(TICKS_PER_BAR - EIGHTH_NOTE_TICKS, snapped))
  const maxDuration = barStart + TICKS_PER_BAR - startTick
  const requestedDuration = Math.round(event.durationTicks / EIGHTH_NOTE_TICKS) * EIGHTH_NOTE_TICKS
  return {
    ...event,
    pitch: Math.max(0, Math.min(127, Math.round(event.pitch))),
    startTick,
    durationTicks: Math.max(EIGHTH_NOTE_TICKS, Math.min(maxDuration, requestedDuration || EIGHTH_NOTE_TICKS)),
    velocity: Math.max(1, Math.min(127, Math.round(event.velocity))),
    patternId: bar < 4 ? 'melody-a' : 'melody-b',
  }
}

export function eventPropertiesChanged(first: MelodyNoteEvent | undefined, second: MelodyNoteEvent | undefined): boolean {
  if (!first || !second) return first !== second
  if (first.timingInferred && second.timingInferred) return first.pitch !== second.pitch
  return (
    first.pitch !== second.pitch ||
    tickWithinBar(first) !== tickWithinBar(second) ||
    first.durationTicks !== second.durationTicks
  )
}

export function melodyPropertyChanges(events: readonly MelodyNoteEvent[]): number {
  const first = eventsForPattern(events, 'melody-a')
  const second = eventsForPattern(events, 'melody-b')
  const firstById = new Map(first.map((event) => [event.id, event]))
  const claimedOrigins = new Set<string>()
  const byOrigin = new Map<string, MelodyNoteEvent>()
  const unlinkedSecond: MelodyNoteEvent[] = []
  for (const event of second) {
    const origin = event.originId ? firstById.get(event.originId) : undefined
    const validOrigin = origin && eventBar(origin) === eventBar(event) - 4 && !claimedOrigins.has(origin.id)
    if (!validOrigin) {
      unlinkedSecond.push(event)
      continue
    }
    claimedOrigins.add(origin.id)
    byOrigin.set(origin.id, event)
  }
  const unmatchedFirst: MelodyNoteEvent[] = []
  let changes = 0
  for (const event of first) {
    const partner = byOrigin.get(event.id)
    if (!partner) unmatchedFirst.push(event)
    else if (eventPropertiesChanged(event, partner)) changes += 1
  }
  for (const event of unlinkedSecond) {
    const replacementIndex = unmatchedFirst.findIndex((candidate) =>
      eventBar(candidate) % 4 === eventBar(event) % 4 && tickWithinBar(candidate) === tickWithinBar(event))
    if (replacementIndex >= 0) {
      const [replacement] = unmatchedFirst.splice(replacementIndex, 1)
      if (eventPropertiesChanged(replacement, event)) changes += 1
    } else {
      changes += 1
    }
  }
  changes += unmatchedFirst.length
  return changes
}

export function hasOverlappingEvents(events: readonly MelodyNoteEvent[]): boolean {
  const sorted = sortMelodyEvents(events)
  return sorted.some((event, index) => {
    const next = sorted[index + 1]
    return Boolean(next && event.startTick + event.durationTicks > next.startTick)
  })
}

export function beatLabelFromTick(tick: number): string {
  const inBar = ((tick % TICKS_PER_BAR) + TICKS_PER_BAR) % TICKS_PER_BAR
  const eighthPosition = inBar / EIGHTH_NOTE_TICKS
  if (!Number.isInteger(eighthPosition)) {
    const beatPosition = inBar / TICKS_PER_BEAT
    return `${Math.floor(beatPosition) + 1} + ${(beatPosition % 1).toFixed(1)}`
  }
  const eighth = eighthPosition
  return `${Math.floor(eighth / 2) + 1}${eighth % 2 ? ' &' : ''}`
}

export function durationLabel(ticks: number): string {
  const beats = ticks / TICKS_PER_BEAT
  return `${Number.isInteger(beats) ? beats : beats.toFixed(1)} beat${beats === 1 ? '' : 's'}`
}
