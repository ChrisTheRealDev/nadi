import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_PREFERENCES, WORKSPACE_STORAGE_KEY, loadWorkspacePreferences, saveWorkspacePreferences, validateWorkspacePreferences } from './workspacePreferences'

describe('workspace preferences (separate from song data)', () => {
  it('starts with just the editor and keyboard, returning independent drafts', () => {
    const storage = { getItem: () => null, setItem: vi.fn() }
    const first = loadWorkspacePreferences(storage)
    expect(first).toEqual({ preferences: DEFAULT_WORKSPACE_PREFERENCES, configured: false })
    first.preferences.browser = true
    expect(loadWorkspacePreferences(storage).preferences.browser).toBe(false)
  })

  it('round trips a strictly valid workspace only under the preference key', () => {
    let saved = ''
    const storage = { getItem: vi.fn(() => saved), setItem: vi.fn((_key: string, value: string) => { saved = value }) }
    const preferences = { ...DEFAULT_WORKSPACE_PREFERENCES, editor: 'drums' as const, browser: true, miraSide: 'left' as const }
    expect(saveWorkspacePreferences(preferences, storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(WORKSPACE_STORAGE_KEY, JSON.stringify(preferences))
    expect(loadWorkspacePreferences(storage)).toEqual({ preferences, configured: true })
  })

  it.each([
    null, [], {}, { ...DEFAULT_WORKSPACE_PREFERENCES, version: 2 },
    { ...DEFAULT_WORKSPACE_PREFERENCES, browser: 'true' },
    { ...DEFAULT_WORKSPACE_PREFERENCES, miraSide: 'middle' },
    { ...DEFAULT_WORKSPACE_PREFERENCES, editor: 'guitar' },
    { ...DEFAULT_WORKSPACE_PREFERENCES, playlistPosition: 'left' },
    { ...DEFAULT_WORKSPACE_PREFERENCES, song: {} },
  ])('rejects malformed preferences without changing storage: %j', value => {
    expect(validateWorkspacePreferences(value)).toBe(false)
    const storage = { getItem: () => JSON.stringify(value), setItem: vi.fn() }
    expect(loadWorkspacePreferences(storage).configured).toBe(false)
    expect(saveWorkspacePreferences(value as typeof DEFAULT_WORKSPACE_PREFERENCES, storage)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('handles malformed JSON, unavailable reads, and quota failures', () => {
    const storage = { getItem: () => '{', setItem: () => { throw new Error('quota') } }
    expect(loadWorkspacePreferences(storage).configured).toBe(false)
    expect(saveWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES, storage)).toBe(false)
    expect(loadWorkspacePreferences({ ...storage, getItem: () => { throw new Error('blocked') } }).configured).toBe(false)
    expect(loadWorkspacePreferences().configured).toBe(false)
    expect(saveWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES)).toBe(false)
  })
})
