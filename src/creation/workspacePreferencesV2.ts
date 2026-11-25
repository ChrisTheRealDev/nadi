import { WORKSPACE_STORAGE_KEY, validateWorkspacePreferences } from './workspacePreferences'

export const STUDIO_PANELS = ['notes', 'arrangement', 'drums', 'mixer', 'sounds', 'keyboard', 'ideas'] as const
export type StudioPanelId = typeof STUDIO_PANELS[number]
export interface WorkspacePreferencesV2 {
  version: 2
  slots: StudioPanelId[]
  active: StudioPanelId | null
  split: number
  mira: boolean
}
export const WORKSPACE_V2_STORAGE_KEY = 'nadi.workspace.v2'
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
export const defaultWorkspaceV2 = (mira = false): WorkspacePreferencesV2 => ({ version: 2, slots: ['notes'], active: 'notes', split: .5, mira })
export function validateWorkspaceV2(value: unknown): value is WorkspacePreferencesV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 5 && v.version === 2 && Array.isArray(v.slots) && v.slots.length <= 2
    && v.slots.every(id => STUDIO_PANELS.includes(id as StudioPanelId)) && new Set(v.slots).size === v.slots.length
    && (v.slots.length ? v.slots.includes(v.active) : v.active === null)
    && typeof v.split === 'number' && Number.isFinite(v.split) && v.split >= .1 && v.split <= .9 && typeof v.mira === 'boolean'
}
function browserStorage(): PreferenceStorage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
export function loadWorkspaceV2(storage: PreferenceStorage | undefined = browserStorage(), legacyMira = false): WorkspacePreferencesV2 {
  try {
    const raw = storage?.getItem(WORKSPACE_V2_STORAGE_KEY)
    if (raw) { const value: unknown = JSON.parse(raw); return validateWorkspaceV2(value) ? value : defaultWorkspaceV2(legacyMira) }
    const legacy = storage?.getItem(WORKSPACE_STORAGE_KEY)
    if (legacy) { const value: unknown = JSON.parse(legacy); if (validateWorkspacePreferences(value)) legacyMira = value.mira }
  } catch { /* Corrupt or blocked preferences never prevent composition. */ }
  return defaultWorkspaceV2(legacyMira)
}
export function saveWorkspaceV2(value: WorkspacePreferencesV2, storage: PreferenceStorage | undefined = browserStorage()): boolean {
  if (!storage || !validateWorkspaceV2(value)) return false
  try { storage.setItem(WORKSPACE_V2_STORAGE_KEY, JSON.stringify(value)); return true } catch { return false }
}
export type WorkspaceAction = { type: 'open'; panel: StudioPanelId; alongside?: boolean } | { type: 'close'; panel: StudioPanelId } | { type: 'activate'; panel: StudioPanelId } | { type: 'split'; split: number } | { type: 'mira'; open: boolean } | { type: 'reset' }
export function workspaceReducer(state: WorkspacePreferencesV2, action: WorkspaceAction): WorkspacePreferencesV2 {
  if (action.type === 'reset') return defaultWorkspaceV2(state.mira)
  if (action.type === 'mira') return state.mira === action.open ? state : { ...state, mira: action.open }
  if (action.type === 'split') return Number.isFinite(action.split) ? { ...state, split: Math.min(.9, Math.max(.1, action.split)) } : state
  if (action.type === 'activate') return state.slots.includes(action.panel) && state.active !== action.panel ? { ...state, active: action.panel } : state
  if (action.type === 'close') { const slots = state.slots.filter(id => id !== action.panel); return { ...state, slots, active: state.active === action.panel ? slots[0] ?? null : state.active } }
  if (state.slots.includes(action.panel)) return { ...state, active: action.panel }
  const slots = !state.slots.length ? [action.panel] : action.alongside && state.slots.length === 1 ? [...state.slots, action.panel] : state.slots.map(id => id === state.active ? action.panel : id)
  return { ...state, slots, active: action.panel }
}
export function clampWorkspaceSplit(split: number, width: number, minimum = 420): number {
  if (width < minimum * 2 + 8) return .5
  const fraction = minimum / (width - 8)
  return Math.max(fraction, Math.min(1 - fraction, split))
}
