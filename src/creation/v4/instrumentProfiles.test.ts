import { describe, expect, it } from 'vitest'
import { SOUND_IDS } from './model'
import { INSTRUMENT_PROFILES, instrumentProfile, soundingToWrittenOffset } from './instrumentProfiles'

describe('performer profiles', () => {
  it('covers every available sound and sources every reference range', () => {
    expect(Object.keys(INSTRUMENT_PROFILES).sort()).toEqual([...SOUND_IDS].sort())
    for (const sound of SOUND_IDS) {
      const profile = instrumentProfile(sound)
      expect(profile.assumption.length).toBeGreaterThan(0)
      if (profile.soundingRange) {
        expect(profile.sources.length).toBeGreaterThan(0)
        expect(profile.soundingRange[0]).toBeLessThan(profile.soundingRange[1])
      }
      if (profile.kind === 'synthetic' || profile.kind === 'approximation') expect(profile.conventionalSingleLine).toBe(false)
    }
  })
  it('expresses transposition in the written-to-sounding direction for notation consumers', () => {
    expect(soundingToWrittenOffset(instrumentProfile('french-horn'))).toBe(7)
    expect(soundingToWrittenOffset(instrumentProfile('clarinet'))).toBe(2)
    expect(soundingToWrittenOffset(instrumentProfile('trumpet'))).toBe(2)
    expect(soundingToWrittenOffset(instrumentProfile('double-bass'))).toBe(12)
    expect(soundingToWrittenOffset(instrumentProfile('piano'))).toBe(0)
    expect(instrumentProfile('viola').clef).toEqual({ sign: 'C', line: 3 })
    expect(instrumentProfile('timpani').pitchedPercussion).toBe(true)
  })
})
