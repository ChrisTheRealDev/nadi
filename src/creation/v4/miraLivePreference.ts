const key = 'nadi.mira.groq-live'
let sessionChoice: boolean | null = null

// Only a UI preference, never a credential. Survives project remounts and tab reloads.
export function groqLivePreference(): boolean {
  try {
    const stored = sessionStorage.getItem(key)
    if (stored === 'on' || stored === 'off') return stored === 'on'
  } catch { /* Keep the in-memory choice if browser storage is unavailable. */ }
  return sessionChoice ?? true
}
export function rememberGroqLivePreference(enabled: boolean) {
  sessionChoice = enabled
  try { sessionStorage.setItem(key, enabled ? 'on' : 'off') } catch { /* In-memory fallback. */ }
}
