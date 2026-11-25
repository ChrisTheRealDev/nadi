import type { FirstSoundProgress, SessionProgress, Settings } from '../types'
import {
  createInitialFirstSoundProgress,
  normalizeFirstSoundProgress,
} from './firstSound'
import {
  createInitialCourseProgress,
  normalizeCourseProgress,
  type CourseProgress,
} from './courseProgress'
import {
  createInitialProgress,
  defaultSettings,
  mergeSettings,
  normalizeProgress,
} from './progress'

export const STORAGE_KEYS = {
  firstSound: 'nadi.session1.progress.v1',
  course: 'nadi.emotive-course.progress.v2',
  legacyCourse: 'nadi.emotive-course.progress.v1',
  progress: 'nadi.session3.progress.v1',
  settings: 'nadi.settings.v1',
  connections: 'nadi.connections.v1',
} as const

export function loadCourseProgress(storage: StorageLike): CourseProgress {
  const current = safeParse(safeRead(storage, STORAGE_KEYS.course))
  if (isCourseV2Envelope(current)) return normalizeCourseProgress(current)
  const legacy = safeParse(safeRead(storage, STORAGE_KEYS.legacyCourse))
  if (hasVersion(legacy, 1)) return normalizeCourseProgress(legacy)
  return createInitialCourseProgress()
}

export function saveCourseProgress(
  storage: StorageLike,
  progress: CourseProgress,
): boolean {
  try {
    storage.setItem(STORAGE_KEYS.course, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function loadFirstSoundProgress(storage: StorageLike): FirstSoundProgress {
  const parsed = safeParse(safeRead(storage, STORAGE_KEYS.firstSound))
  return parsed
    ? normalizeFirstSoundProgress(parsed)
    : createInitialFirstSoundProgress()
}

export function saveFirstSoundProgress(
  storage: StorageLike,
  progress: FirstSoundProgress,
): boolean {
  try {
    storage.setItem(STORAGE_KEYS.firstSound, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function clearFirstSoundProgress(storage: StorageLike): boolean {
  try {
    storage.removeItem(STORAGE_KEYS.firstSound)
    return true
  } catch {
    return false
  }
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function safeParse(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function hasVersion(value: unknown, version: number): boolean {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === version)
}

function isCourseV2Envelope(value: unknown): boolean {
  if (!hasVersion(value, 2)) return false
  const candidate = value as { project?: unknown; sessions?: unknown }
  if (!candidate.project || typeof candidate.project !== 'object' || Array.isArray(candidate.project)) return false
  if (!candidate.sessions || typeof candidate.sessions !== 'object' || Array.isArray(candidate.sessions)) return false
  const project = candidate.project as { melodyEvents?: unknown; chords?: unknown }
  return Array.isArray(project.melodyEvents) && Array.isArray(project.chords)
}

function safeRead(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function loadProgress(storage: StorageLike): SessionProgress {
  const parsed = safeParse(safeRead(storage, STORAGE_KEYS.progress))
  if (!parsed || typeof parsed !== 'object') return createInitialProgress()
  return normalizeProgress(parsed)
}

export function saveProgress(
  storage: StorageLike,
  progress: SessionProgress,
): boolean {
  try {
    storage.setItem(STORAGE_KEYS.progress, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function clearProgress(storage: StorageLike): boolean {
  try {
    storage.removeItem(STORAGE_KEYS.progress)
    return true
  } catch {
    return false
  }
}

export function loadSettings(storage: StorageLike): Settings {
  const parsed = safeParse(safeRead(storage, STORAGE_KEYS.settings))
  return parsed ? mergeSettings(parsed) : defaultSettings
}

export function saveSettings(
  storage: StorageLike,
  settings: Settings,
): boolean {
  try {
    storage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}
