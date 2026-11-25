import { describe, expect, it } from 'vitest'
import { nextWorkspaceMenu, nextWorkspaceTab } from './workspaceKeyboard'

describe('responsive work tabs', () => {
  const tabs = ['notes', 'drums'] as const
  it('moves focus with arrows, wraps, and jumps to ends without taking over Tab', () => {
    expect(nextWorkspaceTab(tabs, 'notes', 'ArrowRight')).toBe('drums')
    expect(nextWorkspaceTab(tabs, 'drums', 'ArrowRight')).toBe('notes')
    expect(nextWorkspaceTab(tabs, 'notes', 'ArrowLeft')).toBe('drums')
    expect(nextWorkspaceTab(tabs, 'drums', 'Home')).toBe('notes')
    expect(nextWorkspaceTab(tabs, 'notes', 'End')).toBe('drums')
    expect(nextWorkspaceTab(tabs, 'notes', 'Tab')).toBeNull()
    expect(nextWorkspaceTab([], 'notes', 'ArrowRight')).toBeNull()
  })
})

describe('coordinated workspace menus', () => {
  it('replaces the open menu, toggles its own trigger, and dismisses outside', () => {
    expect(nextWorkspaceMenu('project', 'export')).toBe('export')
    expect(nextWorkspaceMenu('export', 'export')).toBeNull()
    expect(nextWorkspaceMenu('settings', null)).toBeNull()
  })
})
