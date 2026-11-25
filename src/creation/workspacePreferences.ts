export interface WorkspacePreferences {
  version: 1
  browser: boolean
  mira: boolean
  playlist: boolean
  mixer: boolean
  keyboard: boolean
  browserSide: 'left' | 'right'
  miraSide: 'left' | 'right'
  playlistPosition: 'top' | 'bottom'
  editor: 'piano' | 'drums'
}

export const WORKSPACE_STORAGE_KEY = 'nadi.workspace.v1'
export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = Object.freeze({
  version: 1, browser: false, mira: false, playlist: false, mixer: false,
  keyboard: true, browserSide: 'left', miraSide: 'right',
  playlistPosition: 'top', editor: 'piano',
})

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export function validateWorkspacePreferences(value: unknown): value is WorkspacePreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(DEFAULT_WORKSPACE_PREFERENCES)
  return Object.keys(candidate).length === keys.length && keys.every(key => Object.hasOwn(candidate, key))
    && candidate.version === 1
    && ['browser', 'mira', 'playlist', 'mixer', 'keyboard'].every(key => typeof candidate[key] === 'boolean')
    && (candidate.browserSide === 'left' || candidate.browserSide === 'right')
    && (candidate.miraSide === 'left' || candidate.miraSide === 'right')
    && (candidate.playlistPosition === 'top' || candidate.playlistPosition === 'bottom')
    && (candidate.editor === 'piano' || candidate.editor === 'drums')
}

function safeStorage(): PreferenceStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

export function loadWorkspacePreferences(storage: PreferenceStorage | undefined = safeStorage()): {
  preferences: WorkspacePreferences
  configured: boolean
} {
  try {
    const raw = storage?.getItem(WORKSPACE_STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (validateWorkspacePreferences(parsed)) return { preferences: { ...parsed }, configured: true }
    }
  } catch { /* A blocked or invalid preference must not prevent opening the studio. */ }
  return { preferences: { ...DEFAULT_WORKSPACE_PREFERENCES }, configured: false }
}

export function saveWorkspacePreferences(
  preferences: WorkspacePreferences,
  storage: PreferenceStorage | undefined = safeStorage(),
): boolean {
  if (!storage || !validateWorkspacePreferences(preferences)) return false
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(preferences))
    return true
  } catch { return false }
}
