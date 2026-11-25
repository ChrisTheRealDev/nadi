import { MAX_IDEA_DURATION_MS, MAX_IDEA_EVENTS, type MidiOriginal, type RawIdeaEvent } from './ideas'
import { TICKS_PER_BAR, validateProject, type CreationProject } from './model'

export type StudioRawInput = RawIdeaEvent extends infer Event ? Event extends RawIdeaEvent ? Omit<Event, 'atMs' | 'order'> : never : never
export interface StudioOriginalBuffer { startedAtMs: number; events: RawIdeaEvent[] }

/** Preserve incoming events before sustain processing or note editing. Count-in is not a performance. */
export function appendStudioOriginal(buffer: StudioOriginalBuffer, input: StudioRawInput, atMs: number): 'kept' | 'before-start' | 'limit' {
  const relative = atMs - buffer.startedAtMs
  if (!Number.isFinite(relative) || relative < 0) return 'before-start'
  if (relative > MAX_IDEA_DURATION_MS || buffer.events.length >= MAX_IDEA_EVENTS) return 'limit'
  // Preserve both exact timestamps and delivery order, including late arrivals.
  buffer.events.push({ ...input, atMs: relative, order: buffer.events.length } as RawIdeaEvent)
  return 'kept'
}

export function finishStudioOriginal(buffer: StudioOriginalBuffer, atMs: number): MidiOriginal {
  const lastEventMs = buffer.events.reduce((latest, event) => Math.max(latest, event.atMs), 0)
  const durationMs = Math.max(1, Math.min(MAX_IDEA_DURATION_MS, Math.max(atMs - buffer.startedAtMs, lastEventMs)))
  return { kind: 'midi', durationMs, events: structuredClone(buffer.events) }
}

/** Undo edits music/metadata, never silently discards a later original capture. */
export function restoreStudioHistory(snapshot: CreationProject, current: CreationProject): CreationProject {
  if (snapshot.id !== current.id) throw new TypeError('History belongs to a different project.')
  const known = new Set(snapshot.ideas.map(idea => idea.id))
  const ideas = [...structuredClone(snapshot.ideas), ...structuredClone(current.ideas.filter(idea => !known.has(idea.id)))]
  const attachedEnd = ideas.reduce((end, idea) => Math.max(end, idea.attachedTick ?? 0), 0)
  const next = {
    ...structuredClone(snapshot), ideas,
    bars: Math.max(snapshot.bars, Math.ceil(attachedEnd / TICKS_PER_BAR)),
    revision: current.revision + 1, guidance: structuredClone(current.guidance),
  }
  if (!validateProject(next)) throw new TypeError('That history state cannot safely retain every captured original. No change was made.')
  return next
}
