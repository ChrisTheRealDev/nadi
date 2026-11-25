import { describe, expect, it } from 'vitest'
import { createInitialFirstSoundProgress } from './firstSound'
import { createInitialCourseProgress } from './courseProgress'
import { createInitialProgress, defaultSettings } from './progress'
import { createProjectContent, projectProjectionFromContent } from './projectModel'
import {
  STORAGE_KEYS,
  clearFirstSoundProgress,
  clearProgress,
  loadFirstSoundProgress,
  loadCourseProgress,
  loadProgress,
  loadSettings,
  saveFirstSoundProgress,
  saveCourseProgress,
  saveProgress,
  saveSettings,
  type StorageLike,
} from './storage'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('local persistence', () => {
  it('stores Session 1 separately from Session 3', () => {
    const storage = new MemoryStorage()
    const firstSound = createInitialFirstSoundProgress('first')
    const harmony = createInitialProgress('harmony')
    expect(saveFirstSoundProgress(storage, firstSound)).toBe(true)
    expect(saveProgress(storage, harmony)).toBe(true)
    expect(loadFirstSoundProgress(storage).updatedAt).toBe('first')
    expect(loadProgress(storage).updatedAt).toBe('harmony')
    expect(clearFirstSoundProgress(storage)).toBe(true)
    expect(storage.getItem(STORAGE_KEYS.firstSound)).toBeNull()
    expect(storage.getItem(STORAGE_KEYS.progress)).not.toBeNull()
  })

  it('round-trips a valid checkpoint shape', () => {
    const storage = new MemoryStorage()
    const progress = createInitialProgress('t0')
    expect(saveProgress(storage, progress)).toBe(true)
    expect(loadProgress(storage)).toEqual(progress)
    expect(clearProgress(storage)).toBe(true)
    expect(storage.getItem(STORAGE_KEYS.progress)).toBeNull()
  })

  it('round-trips the v2 course event model', () => {
    const storage = new MemoryStorage()
    const course = createInitialCourseProgress('course-time')
    course.project.melodyEvents.push({
      id: 'note-1', pitch: 69, startTick: 0, durationTicks: 480, velocity: 76,
      trackId: 'melody', patternId: 'melody-a', source: 'draw',
    })
    course.project.nextMelodyEventId = 2
    course.project.content = createProjectContent(course.project)
    Object.assign(course.project, projectProjectionFromContent(course.project.content))
    expect(saveCourseProgress(storage, course)).toBe(true)
    expect(loadCourseProgress(storage)).toEqual(course)
  })

  it('prefers v2 course data and falls back to retained v1 data', () => {
    const storage = new MemoryStorage()
    const legacy = {
      version: 1,
      sessions: {},
      project: {
        melodyA: [['A', 'A'], [], [], []], melodyB: [[], [], [], []], velocities: [72, 72, 72, 72],
        chords: [], chordLevel: 72, melodyLevel: 78, reverb: 12,
      },
      updatedAt: 'legacy',
    }
    storage.setItem(STORAGE_KEYS.legacyCourse, JSON.stringify(legacy))
    expect(loadCourseProgress(storage).project.melodyEvents).toHaveLength(2)

    const current = createInitialCourseProgress('current')
    storage.setItem(STORAGE_KEYS.course, JSON.stringify(current))
    expect(loadCourseProgress(storage).updatedAt).toBe('current')

    storage.setItem(STORAGE_KEYS.course, '{bad-json')
    expect(loadCourseProgress(storage).updatedAt).toBe('legacy')

    storage.setItem(STORAGE_KEYS.course, JSON.stringify({ version: 2 }))
    expect(loadCourseProgress(storage).updatedAt).toBe('legacy')
  })

  it('recovers safely from malformed JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.progress, '{not-json')
    storage.setItem(STORAGE_KEYS.settings, '[]')
    expect(loadProgress(storage).stage).toBe('welcome')
    expect(loadSettings(storage)).toEqual(defaultSettings)
  })

  it('merges known settings and rejects unknown enum values', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ theme: 'neon', textSize: 'large', showNoteNames: false }),
    )
    expect(loadSettings(storage)).toMatchObject({
      theme: 'midnight',
      textSize: 'large',
      showNoteNames: false,
    })
    expect(saveSettings(storage, defaultSettings)).toBe(true)
  })

  it('reports storage write failures without throwing', () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(saveProgress(broken, createInitialProgress())).toBe(false)
    expect(saveSettings(broken, defaultSettings)).toBe(false)
    expect(clearProgress(broken)).toBe(false)
  })

  it('uses safe defaults when browser storage cannot be read', () => {
    const blocked: StorageLike = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(loadProgress(blocked).stage).toBe('welcome')
    expect(loadSettings(blocked)).toEqual(defaultSettings)
  })
})
