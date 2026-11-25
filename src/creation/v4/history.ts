import type { IdeaOriginal } from '../ideas'
import { restoreGraphHistory } from './editorAdapter'
import { assertStudioProject, type StudioProject } from './model'

export const HISTORY_COMMAND_LIMIT = 100
export const HISTORY_BYTE_LIMIT = 32 * 1024 * 1024
export interface HistoryContext { panel?: 'notes' | 'drums' | 'arrangement' | 'mixer' | 'sounds' | 'keyboard' | 'ideas'; trackId?: string; clipId?: string; noteIds?: string[] }
export interface HistoryDescription { label: string; affectedIds?: string[]; context?: HistoryContext }
export interface HistoryCommand extends HistoryDescription { id: string }
interface Entry { snapshot: StudioProject; command: HistoryCommand; bytes: number }

const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

function freezePayload<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezePayload); Object.freeze(value) }
  return value
}

/** Session-only bounded graph snapshots. Immutable originals are interned, not multiplied per edit. */
export class StudioHistory {
  private past: Entry[] = []
  private future: Entry[] = []
  lastTravel?: HistoryCommand
  private originals = new Map<string, IdeaOriginal>()
  private originalBytes = new Map<string, number>()
  private projectId?: string
  constructor(private readonly commandLimit = HISTORY_COMMAND_LIMIT, private readonly byteLimit = HISTORY_BYTE_LIMIT) {
    if (!Number.isSafeInteger(commandLimit) || commandLimit < 1 || !Number.isSafeInteger(byteLimit) || byteLimit < 1) throw new TypeError('History limits must be positive integers.')
  }
  get availability() { return { undo: this.past.length > 0, redo: this.future.length > 0 } }
  get size() { return this.past.length + this.future.length }
  get undoCommand() { return this.past.at(-1)?.command }
  get redoCommand() { return this.future.at(-1)?.command }
  get recent() { return this.past.slice(-12).reverse().map(entry => entry.command) }
  get bytes() {
    const retained = new Set<string>()
    let total = 0
    for (const entry of [...this.past, ...this.future]) {
      total += entry.bytes
      entry.snapshot.ideas.forEach(idea => retained.add(idea.id))
    }
    for (const id of retained) total += this.originalBytes.get(id) ?? 0
    return total
  }
  clear() { this.past = []; this.future = []; this.originals.clear(); this.originalBytes.clear(); this.projectId = undefined; this.lastTravel = undefined }
  push(snapshot: StudioProject, description: HistoryDescription = { label: 'Edit music' }) {
    const frozen = this.capture(snapshot)
    const command = { ...structuredClone(description), id: crypto.randomUUID() }
    this.past.push({ snapshot: frozen, command, bytes: this.entryBytes(frozen, command) }); this.future = []; this.trim()
  }
  undo(current: StudioProject): StudioProject | undefined { return this.travel(current, this.past, this.future) }
  redo(current: StudioProject): StudioProject | undefined { return this.travel(current, this.future, this.past) }
  private travel(current: StudioProject, source: Entry[], target: Entry[]) {
    const entry = source.at(-1)
    if (!entry) return undefined
    const restored = restoreGraphHistory(entry.snapshot, current), captured = this.capture(current)
    source.pop(); target.push({ snapshot: captured, command: entry.command, bytes: this.entryBytes(captured, entry.command) }); this.lastTravel = entry.command; this.trim()
    return restored
  }
  private capture(project: StudioProject) {
    assertStudioProject(project)
    if (this.projectId !== undefined && this.projectId !== project.id) throw new TypeError('Clear history before opening another project.')
    // Reject rewritten originals before changing the intern pool or history stacks.
    for (const idea of project.ideas) {
      const existing = this.originals.get(idea.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(idea.original)) throw new TypeError('History cannot rewrite an original capture.')
    }
    const snapshot = structuredClone(project)
    snapshot.ideas.forEach(idea => {
      let original = this.originals.get(idea.id)
      if (!original) { original = freezePayload(idea.original); this.originals.set(idea.id, original); this.originalBytes.set(idea.id, encodedBytes(original)) }
      idea.original = original
    })
    this.projectId = project.id
    return snapshot
  }
  private entryBytes(snapshot: StudioProject, command: HistoryCommand) {
    return encodedBytes(command) + encodedBytes({ ...snapshot, ideas: snapshot.ideas.map(idea => Object.fromEntries(Object.entries(idea).filter(([key]) => key !== 'original'))) })
  }
  private trim() {
    while (this.size > this.commandLimit || this.bytes > this.byteLimit) {
      if (this.past.length) this.past.shift()
      else if (this.future.length) this.future.shift()
      else break
    }
    const retained = new Set([...this.past, ...this.future].flatMap(entry => entry.snapshot.ideas.map(idea => idea.id)))
    for (const id of this.originals.keys()) if (!retained.has(id)) { this.originals.delete(id); this.originalBytes.delete(id) }
  }
}
