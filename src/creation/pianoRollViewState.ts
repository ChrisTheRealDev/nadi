import type { PianoRollSnap } from './pianoRollMath'

/** Do not initialize scrolling while a retained panel has no visible geometry. */
export function initialPianoRollScrollTop(saved: number | undefined, pitches: readonly number[], rowHeight: number, viewportHeight: number): number | undefined {
  if (viewportHeight <= 0 || !Number.isFinite(viewportHeight)) return undefined
  if (saved !== undefined) return saved
  const pitch = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 60
  const centre = (127 - pitch + .5) * rowHeight
  return Math.max(0, Math.min(128 * rowHeight - viewportHeight, centre - viewportHeight / 2))
}

export type PianoRollTool = 'draw' | 'select' | 'erase'
export interface PianoRollCommand { label: string; affectedIds: string[] }
export interface PianoRollViewState {
  cursor: { pitch: number; tick: number }
  primary: string | null
  selectedIds: string[]
  rowHeight: number
  scrollTop: number
  scrollLeft: number
}
const views = new Map<string, PianoRollViewState>()
const restores = new Map<string, number>()
const preferences: { tool: PianoRollTool; snap: PianoRollSnap; hintVisible: boolean } = { tool: 'draw', snap: 120, hintVisible: true }
export const pianoRollPreferences = () => ({ ...preferences })
export function setPianoRollPreferences(value: Partial<typeof preferences>) { Object.assign(preferences, value) }
export function readPianoRollView(key?: string): PianoRollViewState | undefined {
  const value = key ? views.get(key) : undefined
  return value ? { ...value, cursor: { ...value.cursor }, selectedIds: [...value.selectedIds] } : undefined
}
export function savePianoRollView(key: string, value: PianoRollViewState) {
  views.delete(key)
  views.set(key, { ...value, cursor: { ...value.cursor }, selectedIds: [...value.selectedIds] })
  // View caches contain no music. Bound memory in long sessions with many projects.
  if (views.size > 128) views.delete(views.keys().next().value!)
}
/** A past history request must not replay merely because its panel remounts. */
export function consumePianoRollRestore(key: string | undefined, sequence: number): boolean {
  if (!key) return true
  if (restores.get(key) === sequence) return false
  restores.delete(key); restores.set(key, sequence)
  if (restores.size > 128) restores.delete(restores.keys().next().value!)
  return true
}
