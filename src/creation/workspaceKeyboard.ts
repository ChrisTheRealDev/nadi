import type { StudioPanelId } from './workspacePreferencesV2'

/** Return the tab reached by the APG horizontal-tab keys, without wrapping focus on Tab. */
export function nextWorkspaceTab(tabs: readonly StudioPanelId[], current: StudioPanelId, key: string): StudioPanelId | null {
  if (!tabs.length) return null
  const index = Math.max(0, tabs.indexOf(current))
  if (key === 'Home') return tabs[0]
  if (key === 'End') return tabs[tabs.length - 1]
  if (key === 'ArrowRight') return tabs[(index + 1) % tabs.length]
  if (key === 'ArrowLeft') return tabs[(index - 1 + tabs.length) % tabs.length]
  return null
}

/** One open top-level menu at a time; selecting its trigger toggles it. */
export function nextWorkspaceMenu(current: string | null, trigger: string | null): string | null {
  return trigger === current ? null : trigger
}
