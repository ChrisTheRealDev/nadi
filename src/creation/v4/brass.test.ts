import { describe, expect, it } from 'vitest'
import { createStudioProject, decodeStudioProject, compileArrangement } from './model'
import { addTrack } from './operations'
import { soundById, isAcousticSound, BRASS_SAMPLES } from './sounds'
import { studioMidi } from './audio'

describe('version-one brass sounds', () => {
  it.each(['french-horn', 'trumpet'] as const)('preserves %s notes exactly through sound change and project roundtrip', sound => {
    const project = createStudioProject()
    project.patterns[0].notes = [{ id: 'offgrid', pitch: 60, startTick: 73, durationTicks: 2033, velocity: 79 }]
    const changed = structuredClone(project)
    changed.tracks[0].soundId = sound
    expect(changed.patterns).toEqual(project.patterns)
    expect(changed.tracks[0]).toMatchObject({ soundId: sound, soundVersion: 1 })
    expect(decodeStudioProject(JSON.parse(JSON.stringify(changed)))).toEqual(changed)
    expect(compileArrangement(changed)[0]).toMatchObject({ pitch: 60, startTick: 73, durationTicks: 2033, soundId: sound })
    expect(isAcousticSound(sound)).toBe(true)
    expect(soundById(sound)).toMatchObject({ category: 'Brass', sampled: true, program: sound === 'trumpet' ? 56 : 60 })
  })
  it('exports both distinct GM programs on independently owned tracks', () => {
    let project = addTrack(createStudioProject(), 'french-horn')
    project = addTrack(project, 'trumpet')
    const bytes = studioMidi(project)
    expect([...bytes].some((value, index) => value === 193 && bytes[index + 1] === 60)).toBe(true)
    expect([...bytes].some((value, index) => value === 194 && bytes[index + 1] === 56)).toBe(true)
    expect(project.tracks.filter(track => track.soundId === 'french-horn')).toHaveLength(1)
    expect(project.tracks.filter(track => track.soundId === 'trumpet')).toHaveLength(1)
  })
  it('registers exact hashes and sample-specific nonempty sustain loops', () => {
    expect(BRASS_SAMPLES).toHaveLength(9)
    for (const sample of BRASS_SAMPLES) {
      expect(sample.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sample.loopStart).toBeGreaterThan(0)
      expect(sample.loopEnd).toBeGreaterThan(sample.loopStart)
    }
  })
})
