export const helpTopics = ['start', 'tick', 'beat', 'bar', 'velocity', 'sound-choice', 'sound', 'chord', 'note', 'note-delete', 'note-move', 'note-resize', 'note-listen', 'drums', 'repeat', 'mix', 'export'] as const
export type HelpTopic = typeof helpTopics[number]
export type HelpAction = 'sound-tested' | 'note-played' | 'record-started' | 'note-changed' | 'drum-hit-changed' | 'bar-duplicated' | 'mix-changed' | 'project-saved' | 'project-exported'
export interface CreationWorkspace {
  projectId: string; revision: number; editor: 'piano' | 'drums'; selectedBar: number
  hasPianoNotes: boolean; hasDrumHits: boolean; selectedNote: boolean
  visibleDrumRows: string[]; mutedInstruments: string[]; saved: boolean
}
export interface CreationMiraRequest { version: 1; question: string; workspace: CreationWorkspace }
export interface CreationMiraSelection { topic: HelpTopic | null; stepIds: string[] }
export interface CreationMiraResponse {
  version: 1; projectId: string; revision: number; source: 'authored' | 'live'
  reason: string; selection: CreationMiraSelection; transmission: 'not-sent' | 'sent'
}
const workspaceKeys = ['projectId', 'revision', 'editor', 'selectedBar', 'hasPianoNotes', 'hasDrumHits', 'selectedNote', 'visibleDrumRows', 'mutedInstruments', 'saved']
export function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
export function parseCreationRequest(value: unknown): CreationMiraRequest | null {
  if (!exactObject(value, ['version', 'question', 'workspace']) || value.version !== 1 || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 500) return null
  const w = value.workspace
  if (!exactObject(w, workspaceKeys) || typeof w.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(w.projectId) ||
      !Number.isSafeInteger(w.revision) || Number(w.revision) < 0 || !Number.isSafeInteger(w.selectedBar) || Number(w.selectedBar) < 0 || Number(w.selectedBar) > 10000 ||
      typeof w.editor !== 'string' || !['piano', 'drums'].includes(w.editor) || ['hasPianoNotes', 'hasDrumHits', 'selectedNote', 'saved'].some(key => typeof w[key] !== 'boolean')) return null
  for (const key of ['visibleDrumRows', 'mutedInstruments']) {
    const list = w[key]
    if (!Array.isArray(list) || list.length > 4 || new Set(list).size !== list.length || list.some(item => typeof item !== 'string' || !['piano', 'kick', 'snare', 'hat'].includes(item))) return null
  }
  return value as unknown as CreationMiraRequest
}
export const CREATION_SELECTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['topic', 'stepIds'], properties: {
    topic: { type: ['string', 'null'], enum: [...helpTopics, null] },
    stepIds: { type: 'array', items: { type: 'string', enum: ['start-play', 'term-tick', 'term-beat', 'term-bar', 'term-velocity', 'sound-clarify', 'sound-test', 'piano-editor', 'chord-play', 'chord-record', 'note-select', 'note-change', 'note-delete', 'note-move', 'note-resize', 'note-listen', 'drum-editor', 'drum-change', 'repeat-bar', 'mix-piano', 'save-project', 'export-project'] } },
  },
} as const
