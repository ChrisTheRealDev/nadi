import { validateIdeas, type Idea } from './ideas'

export const TICKS_PER_BEAT = 480
export const TICKS_PER_BAR = TICKS_PER_BEAT * 4

export type Instrument = 'piano' | 'kick' | 'snare' | 'hat'

export interface InstrumentMix {
  level: number
  muted: boolean
}

export type CreationMix = Record<Instrument, InstrumentMix>

export interface Note {
  id: string
  instrument: Instrument
  pitch: number
  startTick: number
  durationTicks: number
  velocity: number
}

export interface CreationProject {
  format: 'nadi-creation'
  version: 3
  id: string
  revision: number
  name: string
  bpm: number
  bars: number
  notes: Note[]
  ideas: Idea[]
  mix: CreationMix
  guidance: {
    open: boolean
    step: number
    experience: 'new' | 'player' | 'producer'
  }
}

const INSTRUMENTS = new Set<Instrument>(['piano', 'kick', 'snare', 'hat'])
const INSTRUMENT_KEYS: readonly Instrument[] = ['piano', 'kick', 'snare', 'hat']
const EXPERIENCES = new Set<CreationProject['guidance']['experience']>(['new', 'player', 'producer'])
export const MAX_BARS = 256
// Keeps validation and dependency-free archive import comfortably resource-bounded.
export const MAX_NOTES = 10_000
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024
const MAX_TEXT_LENGTH = 120

export const DEFAULT_MIX: Readonly<CreationMix> = Object.freeze({
  piano: Object.freeze({ level: 100, muted: false }),
  kick: Object.freeze({ level: 100, muted: false }),
  snare: Object.freeze({ level: 100, muted: false }),
  hat: Object.freeze({ level: 100, muted: false }),
})

interface CreationProjectV1 extends Omit<CreationProject, 'version' | 'mix' | 'ideas'> {
  version: 1
}

export function createDefaultMix(): CreationMix {
  return {
    piano: { ...DEFAULT_MIX.piano },
    kick: { ...DEFAULT_MIX.kick },
    snare: { ...DEFAULT_MIX.snare },
    hat: { ...DEFAULT_MIX.hat },
  }
}

export function createProject(): CreationProject {
  return {
    format: 'nadi-creation',
    version: 3,
    id: makeId(),
    revision: 0,
    name: 'Untitled project',
    bpm: 90,
    bars: 4,
    notes: [],
    ideas: [],
    mix: createDefaultMix(),
    guidance: { open: false, step: 0, experience: 'new' },
  }
}

export function validateProject(value: unknown): value is CreationProject {
  return validateProjectBase(value, 3, true)
}

/**
 * Decodes a persisted project at a trust boundary. V1 is migrated in memory and
 * is upgraded durably only by the caller's next successful save.
 */
export function decodeProject(value: unknown): CreationProject {
  if (validateProject(value)) return structuredClone(value)
  if (validateProjectBase(value, 2, true)) return { ...structuredClone(value as Omit<CreationProject, 'version' | 'ideas'>), version: 3, ideas: [] }
  if (!validateProjectBase(value, 1, false)) throw new TypeError('The creation project schema is invalid or unsupported.')
  const legacy = value as unknown as CreationProjectV1
  return {
    ...structuredClone(legacy),
    version: 3,
    mix: createDefaultMix(),
    ideas: [],
  }
}

export function validateMix(value: unknown): value is CreationMix {
  if (!isRecord(value) || !hasOnlyKeys(value, INSTRUMENT_KEYS)) return false
  return INSTRUMENT_KEYS.every((instrument) => {
    const channel = value[instrument]
    return isRecord(channel)
      && hasOnlyKeys(channel, ['level', 'muted'])
      && safeIntegerInRange(channel.level, 0, 100)
      && typeof channel.muted === 'boolean'
  })
}

function validateProjectBase(value: unknown, version: 1 | 2 | 3, includesMix: boolean): boolean {
  const keys = includesMix
    ? ['format', 'version', 'id', 'revision', 'name', 'bpm', 'bars', 'notes', 'mix', 'guidance']
    : ['format', 'version', 'id', 'revision', 'name', 'bpm', 'bars', 'notes', 'guidance']
  if (version === 3) keys.push('ideas')
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return false
  if (value.format !== 'nadi-creation' || value.version !== version) return false
  if (!validText(value.id) || !validText(value.name)) return false
  if (!safeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)) return false
  if (!finiteInRange(value.bpm, 30, 300) || !safeIntegerInRange(value.bars, 1, MAX_BARS)) return false
  if (!Array.isArray(value.notes) || value.notes.length > MAX_NOTES) return false
  if (includesMix && !validateMix(value.mix)) return false
  if (!isRecord(value.guidance) || !hasOnlyKeys(value.guidance, ['open', 'step', 'experience'])) return false
  if (typeof value.guidance.open !== 'boolean' || !safeIntegerInRange(value.guidance.step, 0, 10_000) || !EXPERIENCES.has(value.guidance.experience as CreationProject['guidance']['experience'])) return false

  const projectTicks = Number(value.bars) * TICKS_PER_BAR
  if (version === 3 && !validateIdeas(value.ideas, projectTicks)) return false
  const ids = new Set<string>()
  for (const note of value.notes) {
    if (!isRecord(note) || !hasOnlyKeys(note, ['id', 'instrument', 'pitch', 'startTick', 'durationTicks', 'velocity'])) return false
    if (!validText(note.id) || ids.has(note.id)) return false
    ids.add(note.id)
    if (!INSTRUMENTS.has(note.instrument as Instrument)) return false
    if (!safeIntegerInRange(note.pitch, 0, 127) || !safeIntegerInRange(note.startTick, 0, projectTicks - 1)) return false
    if (!safeIntegerInRange(note.durationTicks, 1, projectTicks) || Number(note.startTick) + Number(note.durationTicks) > projectTicks) return false
    if (!safeIntegerInRange(note.velocity, 1, 127)) return false
  }
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PROJECT_BYTES }
  catch { return false }
}

export function noteName(pitch: number): string {
  if (!safeIntegerInRange(pitch, 0, 127)) throw new RangeError('MIDI pitch must be an integer from 0 to 127.')
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const random = Math.random().toString(36).slice(2)
  return `creation-${Date.now().toString(36)}-${random}`
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_TEXT_LENGTH && !hasControlCharacter(value)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function safeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}
