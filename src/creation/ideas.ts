import { MAX_BARS, MAX_NOTES, TICKS_PER_BAR, TICKS_PER_BEAT, validateProject, type CreationProject, type Note } from './model'

export const MAX_IDEAS = 100
export const MAX_IDEA_DURATION_MS = 60_000
export const MAX_AUDIO_BYTES = 1024 * 1024
export const MAX_TOTAL_AUDIO_BYTES = 2 * MAX_AUDIO_BYTES
export const MAX_IDEA_EVENTS = 10_000
export const MAX_IDEA_TEXT = 12_000

interface EventBase { atMs: number; order: number; channel: number; source: 'midi' | 'screen' }
export type RawIdeaEvent = EventBase & (
  | { type: 'note-on' | 'note-off'; pitch: number; velocity: number }
  | { type: 'controller'; controller: number; value: number }
  | { type: 'pitch-bend'; value: number }
)
export interface TextOriginal { kind: 'text'; text: string }
export interface AudioOriginal { kind: 'audio'; mimeType: string; byteLength: number; base64: string; durationMs: number }
export interface MidiOriginal { kind: 'midi'; durationMs: number; events: RawIdeaEvent[] }
export type IdeaOriginal = TextOriginal | AudioOriginal | MidiOriginal
export interface Idea { id: string; name: string; createdAt: string; attachedTick: number | null; original: IdeaOriginal }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && finite(value, min, max)
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 120 && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export function validateIdeaOriginal(value: unknown): value is IdeaOriginal {
  if (!record(value)) return false
  if (value.kind === 'text') return exact(value, ['kind', 'text']) && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_IDEA_TEXT
  if (value.kind === 'audio') {
    if (!exact(value, ['kind', 'mimeType', 'byteLength', 'base64', 'durationMs']) ||
      typeof value.mimeType !== 'string' || value.mimeType.length > 120 || !/^audio\/(?:webm|ogg|mp4|wav)(?:;\s*codecs=(?:"[A-Za-z0-9., -]+"|[A-Za-z0-9.,-]+))?$/i.test(value.mimeType) ||
      !integer(value.byteLength, 1, MAX_AUDIO_BYTES) || !finite(value.durationMs, 0, MAX_IDEA_DURATION_MS) ||
      typeof value.base64 !== 'string' || value.base64.length !== 4 * Math.ceil(value.byteLength / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) return false
    try { const decoded = atob(value.base64); return decoded.length === value.byteLength && btoa(decoded) === value.base64 }
    catch { return false }
  }
  if (value.kind !== 'midi' || !exact(value, ['kind', 'durationMs', 'events']) || !finite(value.durationMs, 0, MAX_IDEA_DURATION_MS) || !Array.isArray(value.events) || value.events.length > MAX_IDEA_EVENTS) return false
  let lastOrder = -1
  for (const event of value.events) {
    if (!record(event) || !finite(event.atMs, 0, value.durationMs) || !integer(event.order, 0, Number.MAX_SAFE_INTEGER) || event.order <= lastOrder || !integer(event.channel, 0, 15) || !['midi', 'screen'].includes(String(event.source))) return false
    const common = ['type', 'atMs', 'order', 'channel', 'source']
    if (event.type === 'note-on' || event.type === 'note-off') {
      if (!exact(event, [...common, 'pitch', 'velocity']) || !integer(event.pitch, 0, 127) || !integer(event.velocity, event.type === 'note-on' ? 1 : 0, 127)) return false
    } else if (event.type === 'controller') {
      if (!exact(event, [...common, 'controller', 'value']) || !integer(event.controller, 0, 127) || !integer(event.value, 0, 127)) return false
    } else if (event.type === 'pitch-bend') {
      if (!exact(event, [...common, 'value']) || !integer(event.value, 0, 16383)) return false
    } else return false
    lastOrder = event.order
  }
  return true
}

export function validateIdeas(value: unknown, projectTicks: number): value is Idea[] {
  if (!Array.isArray(value) || value.length > MAX_IDEAS) return false
  const ids = new Set<string>()
  let audioBytes = 0, events = 0
  for (const idea of value) {
    if (!record(idea) || !exact(idea, ['id', 'name', 'createdAt', 'attachedTick', 'original']) || !label(idea.id) || ids.has(idea.id) || !label(idea.name) ||
      typeof idea.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(idea.createdAt) || !Number.isFinite(Date.parse(idea.createdAt)) ||
      (idea.attachedTick !== null && !integer(idea.attachedTick, 0, projectTicks)) || !validateIdeaOriginal(idea.original)) return false
    ids.add(idea.id)
    if (idea.original.kind === 'audio') audioBytes += idea.original.byteLength
    if (idea.original.kind === 'midi') events += idea.original.events.length
    if (audioBytes > MAX_TOTAL_AUDIO_BYTES || events > MAX_IDEA_EVENTS) return false
  }
  return true
}

function createIdea(original: IdeaOriginal, name: string): Idea {
  if (!label(name) || !validateIdeaOriginal(original)) throw new TypeError('This idea is invalid or exceeds the capture limits. The original was not changed.')
  return { id: makeId(), name, createdAt: new Date().toISOString(), attachedTick: null, original: structuredClone(original) }
}
export function createTextIdea(text: string, name = 'Written idea'): Idea { return createIdea({ kind: 'text', text }, name) }
export function createMidiIdea(events: RawIdeaEvent[], durationMs: number, name = 'Keyboard idea'): Idea { return createIdea({ kind: 'midi', events, durationMs }, name) }
export function createAudioIdea(base64: string, mimeType: string, byteLength: number, durationMs: number, name = 'Audio idea'): Idea { return createIdea({ kind: 'audio', base64, mimeType, byteLength, durationMs }, name) }

/** Metadata changes and explicit removal are allowed; existing sources cannot be rewritten. */
export function preservesOriginalIdeas(before: CreationProject, after: CreationProject): boolean {
  const originals = new Map(before.ideas.map(idea => [idea.id, idea]))
  return after.ideas.every(idea => {
    const previous = originals.get(idea.id)
    return !previous || (previous.createdAt === idea.createdAt && JSON.stringify(previous.original) === JSON.stringify(idea.original))
  })
}

/** Converts a COPY of the performance. Raw source order/timestamps are never rewritten. */
export function ideaToNotes(original: MidiOriginal, bpm: number, startTick = 0): Note[] {
  if (!validateIdeaOriginal(original) || original.kind !== 'midi' || !finite(bpm, 30, 300) || !integer(startTick, 0, MAX_BARS * TICKS_PER_BAR - 1)) throw new TypeError('Cannot copy this MIDI idea at that tempo or position.')
  type Held = { pitch: number; velocity: number; atMs: number; channelKey: string }
  const held = new Map<string, Held[]>(), released: Held[] = [], pedal = new Set<string>(), notes: Note[] = []
  const scale = bpm * TICKS_PER_BEAT / 60_000
  const finish = (note: Held, endMs: number) => {
    const start = startTick + Math.round(note.atMs * scale)
    notes.push({ id: makeId(), instrument: 'piano', pitch: note.pitch, velocity: note.velocity, startTick: start, durationTicks: Math.max(1, startTick + Math.round(endMs * scale) - start) })
  }
  const releaseChannel = (channelKey: string, atMs: number) => {
    for (let index = released.length - 1; index >= 0; index--) if (released[index].channelKey === channelKey) finish(released.splice(index, 1)[0], atMs)
  }
  // Delivery order and exact source timestamps stay untouched in the original.
  // Only this derived playback/editing copy is ordered by musical time.
  for (const event of [...original.events].sort((a, b) => a.atMs - b.atMs || a.order - b.order)) {
    const channelKey = `${event.source}:${event.channel}`
    if (event.type === 'controller' && event.controller === 64) {
      if (event.value >= 64) pedal.add(channelKey)
      else { pedal.delete(channelKey); releaseChannel(channelKey, event.atMs) }
    } else if (event.type === 'controller' && (event.controller === 120 || event.controller === 123)) {
      // Channel mode panic is scoped to this source/channel, never another input.
      // End released sustain voices too: live monitoring uses this same safety rule.
      pedal.delete(channelKey); releaseChannel(channelKey, event.atMs)
      for (const [key, queue] of held) if (queue[0]?.channelKey === channelKey) {
        queue.forEach(note => finish(note, event.atMs)); held.delete(key)
      }
    } else if (event.type === 'note-on' || event.type === 'note-off') {
      const key = `${channelKey}:${event.pitch}`, queue = held.get(key) ?? []
      if (event.type === 'note-on') { queue.push({ pitch: event.pitch, velocity: event.velocity, atMs: event.atMs, channelKey }); held.set(key, queue) }
      else {
        const note = queue.shift()
        if (queue.length) held.set(key, queue); else held.delete(key)
        if (note) { if (pedal.has(channelKey)) released.push(note); else finish(note, event.atMs) }
      }
    }
  }
  held.forEach(queue => queue.forEach(note => finish(note, original.durationMs)))
  released.forEach(note => finish(note, original.durationMs))
  return notes.sort((a, b) => a.startTick - b.startTick)
}

export function copyMidiIdea(project: CreationProject, ideaId: string, startTick: number): CreationProject {
  if (!validateProject(project)) throw new TypeError('Cannot copy into an invalid project.')
  const idea = project.ideas.find(item => item.id === ideaId)
  if (!idea || idea.original.kind !== 'midi') throw new TypeError('Choose a captured keyboard idea to copy.')
  const copies = ideaToNotes(idea.original, project.bpm, startTick)
  if (copies.length === 0) throw new TypeError('This idea has no notes to copy. Its original controller events remain saved.')
  if (project.notes.length + copies.length > MAX_NOTES) throw new RangeError('Copying this idea would exceed the 10,000-note project limit.')
  const end = copies.reduce((maximum, note) => Math.max(maximum, note.startTick + note.durationTicks), project.bars * TICKS_PER_BAR)
  const next = { ...structuredClone(project), notes: [...structuredClone(project.notes), ...copies], bars: Math.ceil(end / TICKS_PER_BAR) }
  if (next.bars > MAX_BARS || !validateProject(next)) throw new RangeError('This copy would exceed the project size limit. Your original is unchanged.')
  return next
}
