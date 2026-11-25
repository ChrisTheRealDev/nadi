import {
  MAX_BARS,
  MAX_NOTES,
  TICKS_PER_BAR,
  validateProject,
  type CreationProject,
  type Note,
} from './model'

export type DuplicateNoteIdFactory = (source: Readonly<Note>, copyIndex: number) => string

/**
 * Copies every note whose start is in `sourceBar` to the old project end.
 *
 * The source bar is zero-based. Note durations are kept intact, so a copied
 * tail may extend the arrangement by more than one bar. Invalid or oversized
 * operations throw and never mutate the supplied project.
 */
export function duplicateBarToEnd(
  project: CreationProject,
  sourceBar: number,
  idFactory: DuplicateNoteIdFactory = () => makeId(),
): CreationProject {
  return copyBar(project, sourceBar, project.bars, idFactory)
}

/** Copy into the immediately following bar without shifting or overwriting any music. */
export function repeatBarNext(project: CreationProject, sourceBar: number, idFactory: DuplicateNoteIdFactory = () => makeId()): CreationProject {
  if (!validateProject(project)) throw new TypeError('Cannot repeat a bar in an invalid creation project.')
  const target = sourceBar + 1
  if (project.notes.some(note => note.startTick >= target * TICKS_PER_BAR && note.startTick < (target + 1) * TICKS_PER_BAR)) {
    throw new RangeError(`Bar ${target + 1} already has notes. Nothing changed. Choose an empty destination or use Duplicate bar to end.`)
  }
  if (!project.notes.some(note => note.startTick >= sourceBar * TICKS_PER_BAR && note.startTick < target * TICKS_PER_BAR)) throw new RangeError('This bar has no new notes to repeat. Choose a bar containing notes.')
  return copyBar(project, sourceBar, target, idFactory)
}

function copyBar(project: CreationProject, sourceBar: number, targetBar: number, idFactory: DuplicateNoteIdFactory): CreationProject {
  if (!validateProject(project)) throw new TypeError('Cannot duplicate a bar in an invalid creation project.')
  if (!Number.isSafeInteger(sourceBar) || sourceBar < 0 || sourceBar >= project.bars) {
    throw new RangeError('The source bar must be an existing zero-based bar index.')
  }

  const sourceStart = sourceBar * TICKS_PER_BAR
  const sourceEnd = sourceStart + TICKS_PER_BAR
  const targetStart = targetBar * TICKS_PER_BAR
  const sources = project.notes.filter((note) => note.startTick >= sourceStart && note.startTick < sourceEnd)
  if (!sources.length) throw new RangeError('This bar has no new notes to duplicate. Choose a bar containing notes.')
  if (project.notes.length + sources.length > MAX_NOTES) {
    throw new RangeError('Duplicating this bar would exceed the 10,000-note project limit.')
  }

  const occupiedIds = new Set(project.notes.map((note) => note.id))
  const copies = sources.map((note, copyIndex): Note => {
    const id = idFactory(note, copyIndex)
    if (typeof id !== 'string' || occupiedIds.has(id)) {
      throw new TypeError('Duplicated notes must receive fresh, unique IDs.')
    }
    occupiedIds.add(id)
    return {
      ...note,
      id,
      startTick: targetStart + note.startTick - sourceStart,
    }
  })

  const farthestEnd = copies.reduce(
    (maximum, note) => Math.max(maximum, note.startTick + note.durationTicks),
    targetStart + TICKS_PER_BAR,
  )
  const bars = Math.max(project.bars, Math.ceil(farthestEnd / TICKS_PER_BAR))
  if (bars > MAX_BARS) throw new RangeError(`Duplicating this bar would exceed the ${MAX_BARS}-bar project limit.`)

  const result: CreationProject = {
    ...structuredClone(project),
    bars,
    notes: [...structuredClone(project.notes), ...copies],
  }
  if (!validateProject(result)) throw new TypeError('The duplicated bar would create an invalid project.')
  return result
}

function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
