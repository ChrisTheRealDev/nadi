import { useState } from 'react'

/** Small account/assignment-scoped text drafts. Never stores tokens or musical archives. */
export function usePlannerDraft<T extends string | Record<string, string | number>>(key: string, initial: T) {
  const storageKey = `nadi.planner.draft.v1:${key}`
  const [entry, setEntry] = useState<{ value: T; saved: boolean; failed: boolean }>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const value: unknown = JSON.parse(raw)
        const valid = typeof initial === 'string' ? typeof value === 'string' : value && typeof value === 'object' && Object.entries(initial).every(([field, fallback]) => typeof (value as Record<string, unknown>)[field] === typeof fallback)
        if (valid) return { value: value as T, saved: true, failed: false }
      }
    } catch { /* The live draft is still usable when storage is restricted. */ }
    return { value: initial, saved: false, failed: false }
  })
  const set = (value: T) => {
    let failed = false
    try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { failed = true }
    setEntry({ value, saved: true, failed })
  }
  const clear = (value: T = initial) => {
    let failed = false
    try { localStorage.removeItem(storageKey) } catch { failed = true }
    setEntry({ value, saved: false, failed })
  }
  return { ...entry, set, clear }
}
